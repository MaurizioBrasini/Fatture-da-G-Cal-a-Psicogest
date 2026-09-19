"use client";
// Gestione delle chiusure/indisponibilità del calendario (weekend lunghi,
// mezze giornate, ferie): elenco delle chiusure registrate, registrazione di
// una nuova, modifica ed eliminazione. Le occorrenze future degli slot fissi
// coinvolti slittano in avanti, ripulendo prima gli eventuali eventi già
// creati sulle date sbagliate — ogni scrittura passa da un'anteprima. Si apre
// dalla pagina Disponibilità. Le occorrenze corrette non vengono create qui:
// vanno rigenerate da "Genera occorrenze future" nella pagina Pazienti.

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { todayISO } from "@/lib/logic";

// "2026-12-24" -> "24/12/2026"
function dataIT(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function descrizioneFinestra(c) {
  const inizio = dataIT(c.dataInizio) + (c.oraInizio ? ` ore ${c.oraInizio}` : "");
  const fine = dataIT(c.dataFine) + (c.oraFine ? ` ore ${c.oraFine}` : "");
  return c.dataInizio === c.dataFine && !c.oraInizio && !c.oraFine ? inizio : `${inizio} → ${fine}`;
}

export default function ChiusureCalendarioModal({ onClose }) {
  const [chiuStep, setChiuStep] = useState("lista"); // 'lista' | 'form' | 'loading' | 'preview' | 'writing' | 'done' | 'error'
  const [chiuForm, setChiuForm] = useState({ dataInizio: "", oraInizio: "", dataFine: "", oraFine: "", note: "" });
  const [chiuAnteprima, setChiuAnteprima] = useState(null); // nuova: { nuoveChiusure, daCancellare, ... } — modifica/elimina: { righeFinali, tenute, rimosse, aggiunte, daCancellare, ... }
  const [chiuEsclusi, setChiuEsclusi] = useState(new Set()); // eventId deselezionati dalla proposta di cancellazione
  const [chiuRisultato, setChiuRisultato] = useState(null);
  const [chiuError, setChiuError] = useState("");
  // Elenco delle chiusure già registrate, e chiusura su cui si sta lavorando
  // (chiuEditId) con l'azione in corso ('modifica' | 'elimina'). chiuEditId
  // null = si sta registrando una chiusura nuova.
  const [chiuLista, setChiuLista] = useState(null); // null = in caricamento
  const [chiuListaAvviso, setChiuListaAvviso] = useState("");
  const [chiuEditId, setChiuEditId] = useState(null);
  const [chiuAzione, setChiuAzione] = useState(null);

  async function caricaListaChiusure() {
    setChiuLista(null);
    setChiuListaAvviso("");
    try {
      const res = await fetch("/api/calendar/chiusure");
      const data = await res.json();
      if (!res.ok) {
        setChiuError(data.error || "Errore nel caricare le chiusure.");
        setChiuStep("error");
        return;
      }
      setChiuLista(data.chiusure);
      if (data.recuperoErrore) {
        setChiuListaAvviso(
          `Non sono riuscito a leggere le chiusure già presenti sul calendario Google (${data.recuperoErrore}): l'elenco potrebbe essere incompleto.`
        );
      }
    } catch (e) {
      setChiuError(e.message);
      setChiuStep("error");
    }
  }

  // Torna all'elenco (e lo ricarica), azzerando qualunque operazione a metà.
  function tornaAllElenco() {
    setChiuStep("lista");
    setChiuAnteprima(null);
    setChiuEsclusi(new Set());
    setChiuRisultato(null);
    setChiuError("");
    setChiuEditId(null);
    setChiuAzione(null);
    caricaListaChiusure();
  }

  useEffect(() => {
    caricaListaChiusure();
  }, []);

  function nuovaChiusura() {
    setChiuEditId(null);
    setChiuAzione(null);
    setChiuForm({ dataInizio: todayISO(), oraInizio: "", dataFine: todayISO(), oraFine: "", note: "" });
    setChiuStep("form");
  }

  function modificaChiusura(c) {
    setChiuEditId(c.id);
    setChiuAzione("modifica");
    setChiuForm({
      dataInizio: c.dataInizio,
      oraInizio: c.oraInizio || "",
      dataFine: c.dataFine,
      oraFine: c.oraFine || "",
      note: c.note || "",
    });
    setChiuStep("form");
  }

  function eliminaChiusura(c) {
    const form = {
      dataInizio: c.dataInizio,
      oraInizio: c.oraInizio || "",
      dataFine: c.dataFine,
      oraFine: c.oraFine || "",
      note: c.note || "",
    };
    setChiuEditId(c.id);
    setChiuAzione("elimina");
    setChiuForm(form);
    calcolaAnteprimaChiusura({ id: c.id, azione: "elimina", form });
  }

  // override: usato da eliminaChiusura, che deve calcolare l'anteprima subito,
  // prima che lo stato React (chiuEditId/chiuAzione/chiuForm) sia aggiornato.
  async function calcolaAnteprimaChiusura(override) {
    const form = override?.form || chiuForm;
    const editId = override ? override.id : chiuEditId;
    const azione = override ? override.azione : chiuAzione;
    if (!form.dataInizio || !form.dataFine) return;
    setChiuStep("loading");
    setChiuError("");
    try {
      const res = await fetch(editId ? "/api/calendar/chiusura-modifica-preview" : "/api/calendar/chiusura-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editId ? { id: editId, azione } : {}),
          dataInizio: form.dataInizio,
          oraInizio: form.oraInizio || null,
          dataFine: form.dataFine,
          oraFine: form.oraFine || null,
          note: form.note || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChiuError(data.error || "Errore nel calcolo dell'anteprima.");
        setChiuStep("error");
        return;
      }
      setChiuAnteprima(data);
      setChiuEsclusi(new Set());
      setChiuStep("preview");
    } catch (e) {
      setChiuError(e.message);
      setChiuStep("error");
    }
  }

  async function confermaChiusura() {
    if (!chiuAnteprima) return;
    setChiuStep("writing");
    const cancellazioni = chiuAnteprima.daCancellare
      .filter((r) => !chiuEsclusi.has(r.eventId))
      .map((r) => ({ eventId: r.eventId }));
    try {
      const res = await fetch(chiuEditId ? "/api/calendar/chiusura-modifica-confirm" : "/api/calendar/chiusura-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(chiuEditId
            ? { id: chiuEditId, azione: chiuAzione, righeFinali: chiuAnteprima.righeFinali }
            : { nuoveChiusure: chiuAnteprima.nuoveChiusure }),
          cancellazioni,
          dataInizio: chiuForm.dataInizio,
          oraInizio: chiuForm.oraInizio || null,
          dataFine: chiuForm.dataFine,
          oraFine: chiuForm.oraFine || null,
          note: chiuForm.note || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChiuError(data.error || "Errore durante la scrittura.");
        setChiuStep("error");
        return;
      }
      setChiuRisultato(data);
      setChiuStep("done");
    } catch (e) {
      setChiuError(e.message);
      setChiuStep("error");
    }
  }

  return (
    <Modal maxWidth={640}>
      <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>
        {chiuEditId && chiuAzione === "modifica" ? "Modifica chiusura" : chiuEditId && chiuAzione === "elimina" ? "Elimina chiusura" : "Chiusure calendario"}
      </h2>

      {chiuStep === "lista" && (
        <>
          {chiuLista === null ? (
            <p>Caricamento delle chiusure…</p>
          ) : (
            <>
              {chiuListaAvviso && (
                <div className="tone-warn" style={{ marginBottom: 12, padding: 10, borderRadius: 8 }}>
                  <p className="small" style={{ margin: 0 }}>{chiuListaAvviso}</p>
                </div>
              )}
              {chiuLista.length === 0 ? (
                <p className="muted small">Nessuna chiusura in corso o futura.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {chiuLista.map((c) => (
                    <div
                      key={c.id}
                      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid rgba(128,128,128,0.25)" }}
                    >
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div>{descrizioneFinestra(c)}</div>
                        <div className="muted small">
                          {c.note || "senza nota"} · {c.fasceChiuse} {c.fasceChiuse === 1 ? "fascia" : "fasce"} chiuse
                          {!c.haEventoGoogle && " · evento \"occupato\" mancante sul calendario"}
                        </div>
                      </div>
                      <button className="btn btn-ghost" onClick={() => modificaChiusura(c)}>Modifica</button>
                      <button className="btn btn-ghost" onClick={() => eliminaChiusura(c)}>Elimina</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                <button className="btn btn-ghost" onClick={onClose}>Chiudi</button>
                <button className="btn btn-primary" onClick={nuovaChiusura}>+ Nuova chiusura</button>
              </div>
            </>
          )}
        </>
      )}

      {chiuStep === "form" && (
        <>
          <p className="muted small">
            Segna una finestra continua di indisponibilità: da un giorno/ora a un altro giorno/ora (es.
            &quot;da lunedì 23 ore 7 a domenica 29 ore 22&quot;) — lascia vuoto un orario per intendere
            &quot;dall'inizio&quot;/&quot;fino a fine giornata&quot; (entrambi vuoti = giornata/e intere chiuse). Le
            occorrenze future degli slot fissi coinvolti slittano in avanti di una settimana — chi ha
            &quot;alternanza fissa&quot; non si sposta, resta a te decidere. Viene creato anche un evento
            &quot;occupato&quot; sul calendario reale, così la pagina di prenotazione online non proporrà più
            questi orari.
            {chiuEditId && " Modificando, l'evento \"occupato\" viene ricreato con le nuove date."}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label className="small" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              Dal
              <input
                type="date"
                value={chiuForm.dataInizio}
                onChange={(e) => setChiuForm((f) => ({ ...f, dataInizio: e.target.value }))}
              />
              ore
              <input
                type="time"
                value={chiuForm.oraInizio}
                onChange={(e) => setChiuForm((f) => ({ ...f, oraInizio: e.target.value }))}
                placeholder="inizio giornata"
              />
            </label>
            <label className="small" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              Al
              <input
                type="date"
                value={chiuForm.dataFine}
                onChange={(e) => setChiuForm((f) => ({ ...f, dataFine: e.target.value }))}
              />
              ore
              <input
                type="time"
                value={chiuForm.oraFine}
                onChange={(e) => setChiuForm((f) => ({ ...f, oraFine: e.target.value }))}
                placeholder="fine giornata"
              />
            </label>
            <label className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Nota (facoltativa)
              <input
                type="text"
                style={{ flex: 1 }}
                value={chiuForm.note}
                onChange={(e) => setChiuForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="es. ferie natalizie"
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={tornaAllElenco}>Indietro</button>
            <button
              className="btn btn-primary"
              disabled={!chiuForm.dataInizio || !chiuForm.dataFine || chiuForm.dataFine < chiuForm.dataInizio}
              onClick={() => calcolaAnteprimaChiusura()}
            >
              Calcola anteprima
            </button>
          </div>
        </>
      )}

      {chiuStep === "loading" && <p>Calcolo dell&apos;anteprima in corso…</p>}

      {chiuStep === "error" && (
        <>
          <p style={{ color: "crimson" }}>{chiuError}</p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={onClose}>Chiudi</button>
          </div>
        </>
      )}

      {chiuStep === "preview" && chiuAnteprima && (
        <>
          {chiuEditId ? (
            <div className="muted small" style={{ marginBottom: 12 }}>
              {chiuAzione === "elimina" ? (
                <p style={{ marginTop: 0 }}>
                  Elimini la chiusura <strong>{descrizioneFinestra(chiuForm)}</strong>
                  {chiuForm.note ? ` (${chiuForm.note})` : ""}: viene cancellato l&apos;evento &quot;occupato&quot; dal
                  calendario (la pagina di prenotazione tornerà a proporre quegli orari) e si liberano{" "}
                  <strong>{chiuAnteprima.rimosse.length}</strong> fasce chiuse.
                </p>
              ) : (
                <p style={{ marginTop: 0 }}>
                  Nuova finestra: <strong>{descrizioneFinestra(chiuForm)}</strong>
                  {chiuForm.note ? ` (${chiuForm.note})` : ""}. Fasce chiuse: <strong>{chiuAnteprima.tenute}</strong>{" "}
                  restano, <strong>{chiuAnteprima.rimosse.length}</strong> si liberano,{" "}
                  <strong>{chiuAnteprima.aggiunte.length}</strong> nuove.
                </p>
              )}
              {chiuAnteprima.rimosse.length > 0 && (
                <p style={{ margin: "4px 0" }}>
                  Liberate:{" "}
                  {chiuAnteprima.rimosse
                    .map((r) => `${dataIT(r.closure_date)} ${r.time_of_day.slice(0, 5)}`)
                    .join(", ")}
                </p>
              )}
              <p style={{ marginBottom: 0 }}>
                Dopo aver confermato, vai su &quot;Genera occorrenze future&quot; nella pagina Pazienti. Le date
                liberate possono comparire tra le &quot;anomale&quot; (create in passato e poi cancellate dalla
                chiusura): scegli di ricrearle. Gli eventi &quot;da confermare&quot; già cancellati dalla chiusura
                originale non tornano da soli.
              </p>
            </div>
          ) : chiuAnteprima.nuoveChiusure.length === 0 ? (
            <p className="muted small">
              Nessun appuntamento reale cade in questa finestra (chi era programmato ha già disdetto per conto
              suo, o la chiusura è già registrata) — nessuno slittamento necessario. Confermando creo comunque
              l&apos;evento &quot;occupato&quot; sul calendario, così la pagina di prenotazione non offre questi orari.
            </p>
          ) : (
            <p className="muted small">
              <strong>{chiuAnteprima.nuoveChiusure.length}</strong> appuntamenti reali coinvolti (con chi
              condivide la loro stessa fascia). Dopo aver confermato, vai su &quot;Genera occorrenze
              future&quot; nella pagina Pazienti per creare le date corrette slittate.
            </p>
          )}

          {(chiuEditId || chiuAnteprima.nuoveChiusure.length > 0) && (
            <>
              {chiuAnteprima.daCancellare.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p className="muted small" style={{ marginBottom: 4 }}>
                    <strong>Da cancellare</strong> — eventi &quot;da confermare&quot; già creati sulle date ora
                    chiuse, non più corrette (deseleziona per lasciarli):
                  </p>
                  {chiuAnteprima.daCancellare.map((r) => {
                    const escluso = chiuEsclusi.has(r.eventId);
                    return (
                      <label key={r.eventId} className="small" style={{ display: "flex", alignItems: "center", gap: 8, opacity: escluso ? 0.5 : 1 }}>
                        <input
                          type="checkbox"
                          checked={!escluso}
                          onChange={() =>
                            setChiuEsclusi((s) => {
                              const next = new Set(s);
                              if (next.has(r.eventId)) next.delete(r.eventId);
                              else next.add(r.eventId);
                              return next;
                            })
                          }
                        />
                        {r.nome} — {r.data} {r.ora}
                      </label>
                    );
                  })}
                </div>
              )}

              {chiuAnteprima.daVerificare.length > 0 && (
                <div className="tone-warn" style={{ marginBottom: 12, padding: 10, borderRadius: 8 }}>
                  <p className="small" style={{ marginTop: 0, marginBottom: 4 }}>
                    <strong>Da verificare a mano</strong> — già confermati col paziente o prenotati online, mai
                    toccati in automatico:
                  </p>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {chiuAnteprima.daVerificare.map((r) => (
                      <li key={r.eventId}>{r.nome} — {r.data} {r.ora}</li>
                    ))}
                  </ul>
                </div>
              )}

              {chiuAnteprima.alternanzaCoinvolta.length > 0 && (
                <div className="tone-warn" style={{ marginBottom: 12, padding: 10, borderRadius: 8 }}>
                  <p className="small" style={{ margin: 0 }}>
                    <strong>Alternanza fissa</strong> — non spostati in automatico, decidi tu:{" "}
                    {chiuAnteprima.alternanzaCoinvolta.map((r) => r.nome).join(", ")}
                  </p>
                </div>
              )}
            </>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={tornaAllElenco}>Annulla</button>
            <button className="btn btn-primary" onClick={confermaChiusura}>
              {chiuAzione === "elimina" ? "Conferma eliminazione" : chiuEditId ? "Conferma modifica" : "Conferma chiusura"}
            </button>
          </div>
        </>
      )}

      {chiuStep === "writing" && (
        <p>
          {chiuAzione === "elimina"
            ? "Eliminazione della chiusura in corso…"
            : chiuEditId
              ? "Modifica della chiusura in corso…"
              : "Registrazione della chiusura in corso…"}
        </p>
      )}

      {chiuStep === "done" && chiuRisultato && chiuEditId && (
        <>
          <p>
            {chiuRisultato.azione === "elimina"
              ? "Chiusura eliminata."
              : `Chiusura modificata: ${chiuRisultato.fasceChiuse} fasce chiuse.`}{" "}
            {chiuRisultato.cancellati} eventi obsoleti cancellati
            {chiuRisultato.falliti > 0 ? `, ${chiuRisultato.falliti} falliti` : ""}.
          </p>
          {chiuRisultato.vecchioEventoErrore && (
            <p className="small" style={{ color: "crimson" }}>
              Attenzione: il vecchio evento &quot;occupato&quot; NON è stato cancellato dal calendario (
              {chiuRisultato.vecchioEventoErrore}) — cancellalo a mano, altrimenti resta un blocco duplicato.
            </p>
          )}
          <p className="muted small">Ora vai su &quot;Genera occorrenze future&quot; nella pagina Pazienti per creare le date corrette.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={tornaAllElenco}>Torna all&apos;elenco</button>
            <button className="btn btn-primary" onClick={onClose}>Chiudi</button>
          </div>
        </>
      )}

      {chiuStep === "done" && chiuRisultato && !chiuEditId && (
        <>
          <p>
            {chiuRisultato.chiuse} fasce chiuse, {chiuRisultato.cancellati} eventi obsoleti cancellati
            {chiuRisultato.falliti > 0 ? `, ${chiuRisultato.falliti} falliti` : ""}.
          </p>
          <p className={chiuRisultato.bloccoCreato ? "muted small" : "small"} style={!chiuRisultato.bloccoCreato ? { color: "crimson" } : undefined}>
            {chiuRisultato.bloccoCreato
              ? "Evento \"occupato\" creato sul calendario: la pagina di prenotazione online non proporrà più questi orari."
              : `Attenzione: l'evento "occupato" sul calendario NON è stato creato (${chiuRisultato.bloccoErrore}) — la pagina di prenotazione potrebbe ancora proporre questi orari, crealo a mano.`}
          </p>
          <p className="muted small">Ora vai su &quot;Genera occorrenze future&quot; nella pagina Pazienti per creare le date corrette.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={tornaAllElenco}>Torna all&apos;elenco</button>
            <button className="btn btn-primary" onClick={onClose}>Chiudi</button>
          </div>
        </>
      )}
    </Modal>
  );
}
