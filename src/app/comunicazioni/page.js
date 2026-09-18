"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import GoogleContactSearchButton from "@/components/GoogleContactSearchButton";
import VerificaContattiModal from "@/components/VerificaContattiModal";
import { computePatientState, computePazientiConSalto, personalizzaTesto, formatDataItaliana, DEFAULT_SETTINGS, todayISO, addDays } from "@/lib/logic";

export default function ComunicazioniPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState([]);
  const [log, setLog] = useState([]);

  const [oggetto, setOggetto] = useState("");
  const [corpoTesto, setCorpoTesto] = useState("");
  const [includiAttivi, setIncludiAttivi] = useState(true);
  const [includiSospesi, setIncludiSospesi] = useState(false);
  const [includiSalto, setIncludiSalto] = useState(false);
  const [includiFisso, setIncludiFisso] = useState(false);
  const [includiOccasionali, setIncludiOccasionali] = useState(false);
  const [salto, setSalto] = useState({}); // { patientId: {tipo, gapGiorni, intervalAtteso} } — chi ha disdetto di recente con un buco
  const [fissiIds, setFissiIds] = useState(new Set()); // id pazienti con uno slot fisso attivo
  const [deselezionati, setDeselezionati] = useState({}); // { patientId: true } = tolto a mano dall'invio
  const [selezionatiManuali, setSelezionatiManuali] = useState({}); // { patientId: true } = aggiunto a mano, a prescindere dai filtri
  const [pazienteDaAggiungere, setPazienteDaAggiungere] = useState("");

  // --- Archivio messaggi pronti ---
  const [templates, setTemplates] = useState([]);
  const [templateSelezionato, setTemplateSelezionato] = useState("");
  const [nomeNuovoModello, setNomeNuovoModello] = useState("");
  const [templateErrore, setTemplateErrore] = useState("");

  const [invioStato, setInvioStato] = useState(null); // null | 'invio' | 'fatto' | 'errore'
  const [invioErrore, setInvioErrore] = useState("");
  const [invioRisultato, setInvioRisultato] = useState(null);

  // --- Invia una prova a te stesso ---
  const [provaStato, setProvaStato] = useState(null); // null | 'invio' | 'fatto' | 'errore'
  const [provaErrore, setProvaErrore] = useState("");
  const [provaEmail, setProvaEmail] = useState("");

  // --- Destinatari extra: persone non in anagrafica pazienti ---
  const [extraNome, setExtraNome] = useState("");
  const [extraEmail, setExtraEmail] = useState("");
  const [extraErrore, setExtraErrore] = useState("");
  const [extraRecipients, setExtraRecipients] = useState([]); // [{id, nome, email}]

  const [verificaEmailAperto, setVerificaEmailAperto] = useState(false);

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
    const [{ data: p }, { data: l }, { data: slots }, { data: cancellazioni }, { data: mod }, syncRes] = await Promise.all([
      supabase.from("patients").select("id,nome,nome_calendario,fatturare_a,email,stato").order("nome_calendario"),
      supabase
        .from("email_log")
        .select("*, patients(nome_calendario,fatturare_a)")
        .order("created_at", { ascending: false })
        .limit(300),
      supabase.from("patient_slots").select("patient_id,active,interval_days").eq("active", true),
      supabase.from("cancellations").select("patient_id,cancelled_at"),
      supabase.from("message_templates").select("*").order("nome"),
      // Orizzonte ampio anche all'indietro: computePazientiConSalto deve
      // vedere l'ultimo appuntamento passato per calcolare il gap, non solo
      // i futuri usati per [data].
      fetch("/api/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: addDays(todayISO(), -90), to: addDays(todayISO(), 200) }),
      }).then((r) => r.json()),
    ]);
    const eventi = syncRes?.events || [];
    // Prossimo appuntamento di ciascuno, per personalizzare [data] — non
    // servono qui ne' cancellazioni ne' impostazioni vere (contano solo per
    // il conteggio sedute/soglia, non per prossimaData).
    const conProssimaData = (p || []).map((pat) => ({
      ...pat,
      prossimaData: computePatientState(pat, eventi, DEFAULT_SETTINGS, [], p || []).prossimaData,
    }));
    setPatients(conProssimaData);
    setSalto(Object.fromEntries(computePazientiConSalto(p || [], slots || [], eventi, cancellazioni || []).map((s) => [s.patientId, s])));
    setFissiIds(new Set((slots || []).map((s) => s.patient_id)));
    setTemplates(mod || []);
    setLog(l || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  function caricaModello(id) {
    setTemplateSelezionato(id);
    if (!id) return;
    const t = templates.find((t) => String(t.id) === String(id));
    if (!t) return;
    setOggetto(t.oggetto);
    setCorpoTesto(t.corpo_testo);
  }

  async function salvaModello() {
    setTemplateErrore("");
    if (!nomeNuovoModello.trim() || !oggetto.trim() || !corpoTesto.trim()) {
      setTemplateErrore("Serve un nome per il modello, con oggetto e testo già compilati sopra.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("message_templates")
      .insert({ user_id: user.id, nome: nomeNuovoModello.trim(), oggetto, corpo_testo: corpoTesto })
      .select()
      .single();
    if (error) {
      setTemplateErrore(error.message);
      return;
    }
    setTemplates((prev) => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)));
    setTemplateSelezionato(String(data.id));
    setNomeNuovoModello("");
  }

  async function salvaModificheModello() {
    setTemplateErrore("");
    const t = templates.find((t) => String(t.id) === String(templateSelezionato));
    if (!t) return;
    if (!oggetto.trim() || !corpoTesto.trim()) {
      setTemplateErrore("Oggetto e testo non possono essere vuoti.");
      return;
    }
    const { data, error } = await supabase
      .from("message_templates")
      .update({ oggetto, corpo_testo: corpoTesto, updated_at: new Date().toISOString() })
      .eq("id", t.id)
      .select()
      .single();
    if (error) {
      setTemplateErrore(error.message);
      return;
    }
    setTemplates((prev) => prev.map((x) => (x.id === t.id ? data : x)));
  }

  async function eliminaModelloSelezionato() {
    const t = templates.find((t) => String(t.id) === String(templateSelezionato));
    if (!t) return;
    if (!window.confirm(`Eliminare il modello "${t.nome}"?`)) return;
    const { error } = await supabase.from("message_templates").delete().eq("id", t.id);
    if (error) {
      setTemplateErrore(error.message);
      return;
    }
    setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    setTemplateSelezionato("");
  }

  function aggiungiPazienteSelezionato(id) {
    setPazienteDaAggiungere("");
    if (!id) return;
    setSelezionatiManuali((prev) => ({ ...prev, [id]: true }));
    setDeselezionati((prev) => ({ ...prev, [id]: false }));
  }

  async function inviaProva() {
    setProvaErrore("");
    if (!oggetto.trim() || !corpoTesto.trim()) {
      setProvaErrore("Scrivi prima oggetto e testo.");
      setProvaStato("errore");
      return;
    }
    setProvaStato("invio");
    try {
      const res = await fetch("/api/email/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oggetto, corpoTesto }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProvaErrore(data.error || "Errore durante l'invio di prova.");
        setProvaStato("errore");
        return;
      }
      setProvaEmail(data.email);
      setProvaStato("fatto");
    } catch (e) {
      setProvaErrore(e.message);
      setProvaStato("errore");
    }
  }

  function aggiungiExtra() {
    setExtraErrore("");
    const email = extraEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setExtraErrore("Email non valida.");
      return;
    }
    setExtraRecipients((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, nome: extraNome.trim(), email }]);
    setExtraNome("");
    setExtraEmail("");
  }

  function rimuoviExtra(id) {
    setExtraRecipients((prev) => prev.filter((e) => e.id !== id));
  }

  if (loading) return <div style={{ padding: 40 }}>Caricamento…</div>;

  const statiInclusi = new Set([...(includiAttivi ? ["attivo"] : []), ...(includiSospesi ? ["sospeso"] : [])]);
  // "Spazio fisso"/"Occasionali" restringe solo se è spuntato uno solo dei
  // due (entrambi o nessuno = nessuna restrizione di tipologia).
  const tipologiaRestrittiva = includiFisso !== includiOccasionali;
  const matchTipologia = (p) => !tipologiaRestrittiva || (includiFisso ? fissiIds.has(p.id) : !fissiIds.has(p.id));
  const daFiltri = patients.filter((p) => (statiInclusi.has(p.stato) || (includiSalto && salto[p.id])) && matchTipologia(p));
  const idsDaFiltri = new Set(daFiltri.map((p) => p.id));
  // Selezione nominale: pazienti aggiunti a mano dalla ricerca sotto,
  // sempre inclusi a prescindere dai filtri di stato/tipologia sopra.
  const aggiuntiManualmente = patients.filter((p) => selezionatiManuali[p.id] && !idsDaFiltri.has(p.id));
  const candidati = [...daFiltri, ...aggiuntiManualmente];
  const conEmail = candidati.filter((p) => p.email);
  const senzaEmail = candidati.length - conEmail.length;
  const selezionati = conEmail.filter((p) => !deselezionati[p.id]);
  const patientsNonInElenco = patients.filter((p) => !candidati.some((c) => c.id === p.id));

  const totaleDestinatari = selezionati.length + extraRecipients.length;

  async function invia() {
    if (!oggetto.trim() || !corpoTesto.trim()) {
      setInvioErrore("Oggetto e testo sono obbligatori.");
      setInvioStato("errore");
      return;
    }
    if (!totaleDestinatari) return;
    if (
      !window.confirm(
        `Confermi l'invio a ${totaleDestinatari} destinatar${totaleDestinatari === 1 ? "io" : "i"}? L'operazione non si può annullare.`
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
      const extra = extraRecipients.map((e) => {
        const valori = { nome: e.nome, data: "" };
        return {
          email: e.email,
          nome: e.nome,
          oggetto: personalizzaTesto(oggetto, valori),
          corpoTesto: personalizzaTesto(corpoTesto, valori),
        };
      });
      const res = await fetch("/api/email/broadcast-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinatari, extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInvioErrore(data.error || "Errore durante l'invio.");
        setInvioStato("errore");
        return;
      }
      setInvioRisultato(data);
      setInvioStato("fatto");
      setExtraRecipients([]);
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

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Modello:
            <select value={templateSelezionato} onChange={(e) => caricaModello(e.target.value)}>
              <option value="">— nessuno —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </label>
          {templateSelezionato && (
            <>
              <button type="button" className="btn btn-primary" onClick={salvaModificheModello}>
                Salva modifiche
              </button>
              <button type="button" className="btn btn-ghost" onClick={eliminaModelloSelezionato}>
                Elimina modello
              </button>
            </>
          )}
          <span className="muted small">|</span>
          <input
            value={nomeNuovoModello}
            onChange={(e) => setNomeNuovoModello(e.target.value)}
            placeholder="Nome nuovo modello (es. Chiusura natalizia)"
            style={{ minWidth: 240 }}
          />
          <button type="button" className="btn btn-ghost" onClick={salvaModello}>
            Salva oggetto/testo come modello
          </button>
        </div>
        {templateErrore && <div className="error-box" style={{ marginBottom: 12 }}>{templateErrore}</div>}

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
              Puoi usare <code>[nome]</code> e <code>[data]</code> (nome e prossimo appuntamento di ciascun destinatario) e{" "}
              <code>[link]</code> (diventa un bottone &quot;Prenota appuntamento&quot;, link impostabile in Impostazioni).
            </span>
          </label>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <button type="button" className="btn btn-ghost" onClick={inviaProva} disabled={provaStato === "invio"}>
            {provaStato === "invio" ? "Invio in corso…" : "Invia una prova a te stesso"}
          </button>
          {provaStato === "fatto" && <span className="muted small">Inviata a {provaEmail}.</span>}
          {provaStato === "errore" && <span className="error-box">{provaErrore}</span>}
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
          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            title="Chi ha disdetto negli ultimi 30 giorni e ora ha un buco doppio della sua cadenza abituale (o nessun appuntamento futuro), più chi è a schema libero senza alcuna data pianificata — il target più utile per un invito a prenotare un incontro intermedio."
          >
            <input type="checkbox" checked={includiSalto} onChange={(e) => setIncludiSalto(e.target.checked)} />
            Pazienti con disdetta/salto ({Object.keys(salto).length})
          </label>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
          <span className="muted small">Tipologia:</span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="Ha uno slot fisso attivo (settimanale/quindicinale/mensile)">
            <input type="checkbox" checked={includiFisso} onChange={(e) => setIncludiFisso(e.target.checked)} />
            Spazio fisso
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="Nessuno slot fisso attivo — su richiesta/occasionali">
            <input type="checkbox" checked={includiOccasionali} onChange={(e) => setIncludiOccasionali(e.target.checked)} />
            Occasionali
          </label>
          <span className="muted small" style={{ alignSelf: "center" }}>
            (nessuna delle due = tutti i tipi; una sola spuntata = solo quel tipo)
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Aggiungi un paziente specifico:
            <select value={pazienteDaAggiungere} onChange={(e) => aggiungiPazienteSelezionato(Number(e.target.value) || "")}>
              <option value="">— scegli —</option>
              {patientsNonInElenco.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome_calendario || p.fatturare_a}
                </option>
              ))}
            </select>
          </label>
          <span className="muted small">Lo aggiunge all&apos;elenco sotto a prescindere dagli altri filtri.</span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <span className="muted small">Destinatario che non è un paziente:</span>
          <input value={extraNome} onChange={(e) => setExtraNome(e.target.value)} placeholder="Nome (facoltativo)" style={{ width: 160 }} />
          <input value={extraEmail} onChange={(e) => setExtraEmail(e.target.value)} placeholder="email@esempio.it" style={{ width: 220 }} />
          <button type="button" className="btn btn-ghost" onClick={aggiungiExtra}>
            Aggiungi
          </button>
          <GoogleContactSearchButton
            title="Cerca nei Contatti Google"
            onSelect={(c) => {
              setExtraNome(c.nome || "");
              setExtraEmail(c.email?.[0] || "");
            }}
          />
        </div>
        <div style={{ marginBottom: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => setVerificaEmailAperto(true)}>
            Verifica email pazienti su Google Contacts
          </button>
        </div>
        {extraErrore && <div className="error-box" style={{ marginBottom: 8 }}>{extraErrore}</div>}
        {extraRecipients.length > 0 && (
          <ul style={{ marginTop: 0, marginBottom: 12 }}>
            {extraRecipients.map((e) => (
              <li key={e.id} className="muted small">
                {e.nome ? `${e.nome} — ` : ""}
                {e.email}{" "}
                <button type="button" className="btn btn-ghost" style={{ padding: "0 6px" }} onClick={() => rimuoviExtra(e.id)}>
                  rimuovi
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="muted small">
          {totaleDestinatari} destinatari selezionati{senzaEmail > 0 && ` (${senzaEmail} pazienti esclusi perché senza email registrata)`}.
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
                  <th style={{ textAlign: "left" }}>Tipologia</th>
                  <th style={{ textAlign: "left" }}>Segnale</th>
                </tr>
              </thead>
              <tbody>
                {candidati.map((p) => {
                  const s = salto[p.id];
                  const etichettaSalto = !s
                    ? ""
                    : s.tipo === "salto"
                    ? `Salto: ${s.gapGiorni}gg (atteso ${s.intervalAtteso}gg)`
                    : s.tipo === "nessun_futuro"
                    ? "Disdetta recente, nessun appuntamento futuro"
                    : "Schema libero, nessuna data pianificata";
                  return (
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
                      <td className="muted small">{fissiIds.has(p.id) ? "Fisso" : "Occasionale"}</td>
                      <td className="muted small">{etichettaSalto}</td>
                    </tr>
                  );
                })}
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

        <button className="btn btn-primary" onClick={invia} disabled={!totaleDestinatari || invioStato === "invio"}>
          {invioStato === "invio" ? "Invio in corso…" : `Invia a ${totaleDestinatari} destinatari`}
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

      {verificaEmailAperto && (
        <VerificaContattiModal
          fields={["email"]}
          onClose={() => setVerificaEmailAperto(false)}
          onDone={() => {
            setVerificaEmailAperto(false);
            load();
          }}
        />
      )}
    </div>
  );
}
