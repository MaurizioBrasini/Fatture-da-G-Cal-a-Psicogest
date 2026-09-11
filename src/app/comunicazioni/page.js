"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";

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

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: l }] = await Promise.all([
      supabase.from("patients").select("id,nome_calendario,fatturare_a,email,stato").order("nome_calendario"),
      supabase
        .from("email_log")
        .select("*, patients(nome_calendario,fatturare_a)")
        .order("created_at", { ascending: false })
        .limit(300),
    ]);
    setPatients(p || []);
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
      const res = await fetch("/api/email/broadcast-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oggetto, corpoTesto, patientIds: selezionati.map((p) => p.id) }),
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
              placeholder={"Gentile paziente,\n\nlo studio resterà chiuso dal ... al ...\n\nCordiali saluti,\nDr. Maurizio Brasini"}
              style={{ width: "100%", fontFamily: "inherit", fontSize: 14, padding: 8 }}
            />
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
