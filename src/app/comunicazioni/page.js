"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import { computePatientState, personalizzaTesto, formatDataItaliana, DEFAULT_SETTINGS, todayISO, addDays } from "@/lib/logic";

export default function ComunicazioniPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState([]);
  const [log, setLog] = useState([]);

  const [oggetto, setOggetto] = useState("");
  const [corpoTesto, setCorpoTesto] = useState("");
  const [includiAttivi, setIncludiAttivi] = useState(true);
  const [includiSospesi, setIncludiSospesi] = useState(false);
  const [deselezionati, setDeselezionati] = useState({}); // { patientId: true } = tolto a mano dall'invio

  const [invioStato, setInvioStato] = useState(null); // null | 'invio' | 'fatto' | 'errore'
  const [invioErrore, setInvioErrore] = useState("");
  const [invioRisultato, setInvioRisultato] = useState(null);

  // --- Riprenotazioni da confermare (disdette senza email già mandata) ---
  const [ripStato, setRipStato] = useState(null); // null | 'loading' | 'preview' | 'invio' | 'fatto' | 'errore'
  const [ripCandidati, setRipCandidati] = useState(null);
  const [ripEsclusi, setRipEsclusi] = useState({}); // { patientId: true } = tolto dall'invio
  const [ripErrore, setRipErrore] = useState("");
  const [ripRisultato, setRipRisultato] = useState(null);

  async function generaElencoRiprenotazioni() {
    setRipStato("loading");
    setRipErrore("");
    setRipEsclusi({});
    setRipRisultato(null);
    try {
      const res = await fetch("/api/email/riprenotazioni-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setRipErrore(data.error || "Errore nel calcolo dell'elenco.");
        setRipStato("errore");
        return;
      }
      setRipCandidati(data.candidati || []);
      setRipStato("preview");
    } catch (e) {
      setRipErrore(e.message);
      setRipStato("errore");
    }
  }

  async function confermaRiprenotazioni() {
    const daMandare = (ripCandidati || []).filter((c) => !ripEsclusi[c.patientId]);
    if (!daMandare.length) return;
    if (!window.confirm(`Confermi l'invio a ${daMandare.length} pazient${daMandare.length === 1 ? "e" : "i"}?`)) return;
    setRipStato("invio");
    try {
      const res = await fetch("/api/email/riprenotazioni-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidati: daMandare }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRipErrore(data.error || "Errore durante l'invio.");
        setRipStato("errore");
        return;
      }
      setRipRisultato(data);
      setRipStato("fatto");
      load();
    } catch (e) {
      setRipErrore(e.message);
      setRipStato("errore");
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: l }, syncRes] = await Promise.all([
      supabase.from("patients").select("id,nome,nome_calendario,fatturare_a,email,stato").order("nome_calendario"),
      supabase
        .from("email_log")
        .select("*, patients(nome_calendario,fatturare_a)")
        .order("created_at", { ascending: false })
        .limit(300),
      fetch("/api/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: todayISO(), to: addDays(todayISO(), 200) }),
      }).then((r) => r.json()),
    ]);
    // Prossimo appuntamento di ciascuno, per personalizzare [data] — non
    // servono qui ne' cancellazioni ne' impostazioni vere (contano solo per
    // il conteggio sedute/soglia, non per prossimaData).
    const eventiFuturi = syncRes?.events || [];
    const conProssimaData = (p || []).map((pat) => ({
      ...pat,
      prossimaData: computePatientState(pat, eventiFuturi, DEFAULT_SETTINGS, [], p || []).prossimaData,
    }));
    setPatients(conProssimaData);
    setLog(l || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div style={{ padding: 40 }}>Caricamento…</div>;

  const statiInclusi = new Set([...(includiAttivi ? ["attivo"] : []), ...(includiSospesi ? ["sospeso"] : [])]);
  const candidati = patients.filter((p) => statiInclusi.has(p.stato));
  const conEmail = candidati.filter((p) => p.email);
  const senzaEmail = candidati.length - conEmail.length;
  const selezionati = conEmail.filter((p) => !deselezionati[p.id]);

  async function invia() {
    if (!oggetto.trim() || !corpoTesto.trim()) {
      setInvioErrore("Oggetto e testo sono obbligatori.");
      setInvioStato("errore");
      return;
    }
    if (!selezionati.length) return;
    if (
      !window.confirm(
        `Confermi l'invio a ${selezionati.length} pazient${selezionati.length === 1 ? "e" : "i"}? L'operazione non si può annullare.`
      )
    )
      return;
    setInvioStato("invio");
    setInvioErrore("");
    try {
      const destinatari = selezionati.map((p) => {
        const valori = { nome: p.nome || (p.nome_calendario || "").split(" ")[0], data: formatDataItaliana(p.prossimaData) };
        return {
          patientId: p.id,
          oggetto: personalizzaTesto(oggetto, valori),
          corpoTesto: personalizzaTesto(corpoTesto, valori),
        };
      });
      const res = await fetch("/api/email/broadcast-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinatari }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInvioErrore(data.error || "Errore durante l'invio.");
        setInvioStato("errore");
        return;
      }
      setInvioRisultato(data);
      setInvioStato("fatto");
      await load();
    } catch (e) {
      setInvioErrore(e.message);
      setInvioStato("errore");
    }
  }

  // Raggruppa lo storico: i broadcast per batch_id (una riga per invio), le
  // email di riprenotazione una per una (sono singole, non ha senso raggrupparle).
  const broadcastPerBatch = {};
  const singole = [];
  for (const row of log) {
    if (row.tipo === "broadcast" && row.batch_id) {
      if (!broadcastPerBatch[row.batch_id]) {
        broadcastPerBatch[row.batch_id] = { batch_id: row.batch_id, oggetto: row.oggetto, created_at: row.created_at, ok: 0, errore: 0 };
      }
      broadcastPerBatch[row.batch_id][row.stato === "ok" ? "ok" : "errore"]++;
    } else {
      singole.push(row);
    }
  }
  const broadcasts = Object.values(broadcastPerBatch).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <div className="app-root">
      <Sidebar readyCount={0} />
      <main className="main">
        <header className="view-header">
          <div>
            <h1>Comunicazioni</h1>
            <p className="sub">Invia un&apos;email a più pazienti insieme (es. chiusura per le feste).</p>
          </div>
        </header>

        <h2 className="sub-heading" style={{ marginTop: 0 }}>Riprenotazioni da confermare</h2>
        <p className="sub" style={{ marginBottom: 12 }}>
          Elenco di chi ha disdetto senza aver ancora ricevuto il link di riprenotazione. Generalo a fine giornata o
          ogni pochi giorni, togli la spunta a chi non deve riceverlo, conferma.
        </p>
        <button className="btn btn-ghost" onClick={generaElencoRiprenotazioni} disabled={ripStato === "loading"} style={{ marginBottom: 12 }}>
          {ripStato === "loading" ? "Ricerca in corso…" : "Genera elenco"}
        </button>

        {ripStato === "errore" && <div className="error-box" style={{ marginBottom: 12 }}>{ripErrore}</div>}

        {(ripStato === "preview" || ripStato === "invio" || ripStato === "fatto") && (
          <>
            {(!ripCandidati || ripCandidati.length === 0) ? (
              <p className="muted" style={{ marginBottom: 16 }}>Nessuna disdetta in attesa di riprenotazione.</p>
            ) : (
              <>
                <div className="table-scroll" style={{ marginBottom: 12 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th></th>
                        <th style={{ textAlign: "left" }}>Data disdetta</th>
                        <th style={{ textAlign: "left" }}>Paziente</th>
                        <th style={{ textAlign: "left" }}>Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ripCandidati.map((c) => (
                        <tr key={c.patientId}>
                          <td>
                            <input
                              type="checkbox"
                              checked={!ripEsclusi[c.patientId]}
                              onChange={() => setRipEsclusi((prev) => ({ ...prev, [c.patientId]: !prev[c.patientId] }))}
                            />
                          </td>
                          <td className="mono">{c.data}</td>
                          <td>{c.nome}</td>
                          <td className="mono">{c.email}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {ripStato === "fatto" && ripRisultato ? (
                  <p className="muted small" style={{ marginBottom: 16 }}>
                    Fatto: {ripRisultato.inviate} inviate{ripRisultato.fallite > 0 && `, ${ripRisultato.fallite} fallite`}.
                  </p>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={confermaRiprenotazioni}
                    disabled={ripStato === "invio" || ripCandidati.every((c) => ripEsclusi[c.patientId])}
                    style={{ marginBottom: 16 }}
                  >
                    {ripStato === "invio" ? "Invio in corso…" : `Invia a ${ripCandidati.filter((c) => !ripEsclusi[c.patientId]).length} pazienti`}
                  </button>
                )}
              </>
            )}
          </>
        )}

        <h2 className="sub-heading">Invio a più pazienti</h2>
        <div className="settings-grid" style={{ marginBottom: 16 }}>
          <label style={{ gridColumn: "1 / -1" }}>
            Oggetto
            <input value={oggetto} onChange={(e) => setOggetto(e.target.value)} placeholder="Es. Chiusura per le festività natalizie" />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Testo
            <textarea
              rows={8}
              value={corpoTesto}
              onChange={(e) => setCorpoTesto(e.target.value)}
              placeholder={"Gentile [nome],\n\nin vista del suo prossimo appuntamento programmato del [data]...\n\nCordiali saluti,\nDr. Maurizio Brasini"}
              style={{ width: "100%", fontFamily: "inherit", fontSize: 14, padding: 8 }}
            />
            <span className="muted small">
              Puoi usare <code>[nome]</code> e <code>[data]</code> nell&apos;oggetto e nel testo: verranno sostituiti col nome e la
              prossima data di appuntamento di ciascun destinatario, uno per uno.
            </span>
          </label>
        </div>

        <h2 className="sub-heading">Destinatari</h2>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={includiAttivi} onChange={(e) => setIncludiAttivi(e.target.checked)} />
            Pazienti attivi
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={includiSospesi} onChange={(e) => setIncludiSospesi(e.target.checked)} />
            Pazienti sospesi
          </label>
        </div>

        <p className="muted small">
          {selezionati.length} destinatari selezionati{senzaEmail > 0 && ` (${senzaEmail} esclusi perché senza email registrata)`}.
          Togli la spunta a chi non deve ricevere questo invio.
        </p>

        {candidati.length > 0 && (
          <div className="table-scroll" style={{ maxHeight: 320, marginBottom: 16 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th></th>
                  <th style={{ textAlign: "left" }}>Paziente</th>
                  <th style={{ textAlign: "left" }}>Email</th>
                  <th style={{ textAlign: "left" }}>Prossimo appuntamento</th>
                </tr>
              </thead>
              <tbody>
                {candidati.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="checkbox"
                        disabled={!p.email}
                        checked={!!p.email && !deselezionati[p.id]}
                        onChange={() => setDeselezionati((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                      />
                    </td>
                    <td>{p.nome_calendario || p.fatturare_a}</td>
                    <td className={p.email ? "mono" : "muted small"}>{p.email || "manca"}</td>
                    <td className={p.prossimaData ? "" : "muted small"}>
                      {p.prossimaData ? formatDataItaliana(p.prossimaData) : "nessuno pianificato"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {invioErrore && <div className="error-box" style={{ marginBottom: 12 }}>{invioErrore}</div>}
        {invioStato === "fatto" && invioRisultato && (
          <p className="muted small" style={{ marginBottom: 12 }}>
            Fatto: {invioRisultato.inviate} inviate{invioRisultato.fallite > 0 && `, ${invioRisultato.fallite} fallite`}.
          </p>
        )}

        <button className="btn btn-primary" onClick={invia} disabled={!selezionati.length || invioStato === "invio"}>
          {invioStato === "invio" ? "Invio in corso…" : `Invia a ${selezionati.length} pazienti`}
        </button>

        <h2 className="sub-heading" style={{ marginTop: 32 }}>Storico</h2>
        {broadcasts.length === 0 && singole.length === 0 ? (
          <p className="muted">Nessun invio ancora registrato.</p>
        ) : (
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Data</th>
                  <th style={{ textAlign: "left" }}>Tipo</th>
                  <th style={{ textAlign: "left" }}>Oggetto / destinatario</th>
                  <th style={{ textAlign: "left" }}>Esito</th>
                </tr>
              </thead>
              <tbody>
                {broadcasts.map((b) => (
                  <tr key={b.batch_id}>
                    <td className="mono">{new Date(b.created_at).toLocaleString("it-IT")}</td>
                    <td>Broadcast</td>
                    <td>{b.oggetto}</td>
                    <td>
                      {b.ok} inviate{b.errore > 0 && `, ${b.errore} fallite`}
                    </td>
                  </tr>
                ))}
                {singole.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{new Date(r.created_at).toLocaleString("it-IT")}</td>
                    <td>Riprenotazione</td>
                    <td>
                      {r.patients?.nome_calendario || r.patients?.fatturare_a || r.email}
                    </td>
                    <td className={r.stato === "errore" ? "muted small" : ""} title={r.errore || ""}>
                      {r.stato === "ok" ? "Inviata" : `Errore${r.errore ? `: ${r.errore}` : ""}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
