"use client";
import { useState } from "react";
import Modal from "@/components/Modal";
import { todayISO } from "@/lib/logic";
import { segnaRoutine } from "@/lib/routineChecklist";

// Estratto da Pazienti (era build-in solo li') perche' serve anche dalla
// Dashboard: "Rinumera tutti" deve poter partire da entrambe le pagine senza
// duplicare stato/logica/modale in due punti che potrebbero disallinearsi.
// Un solo posto che gestisce anteprima -> conferma -> scrittura a blocchi;
// chi lo usa mette solo <>{renumerazioneModal}</> nel proprio JSX e chiama
// apriRinumerazione(null per tutti, o un patientId per uno solo).

const RENUM_CHUNK_SIZE = 15;

export function useRinumerazione({ onRinumeraTuttiCompletato } = {}) {
  const [renumStep, setRenumStep] = useState(null); // null | 'loading' | 'preview' | 'writing' | 'done' | 'error'
  const [renumTarget, setRenumTarget] = useState(null); // id paziente, o null = tutti
  const [renumGiorni, setRenumGiorni] = useState(90);
  const [renumData, setRenumData] = useState(null);
  const [renumWriteResult, setRenumWriteResult] = useState(null);
  const [renumError, setRenumError] = useState("");
  const [renumProgress, setRenumProgress] = useState(null);

  async function caricaAnteprimaRinumerazione(patientId, giorni) {
    setRenumStep("loading");
    setRenumError("");
    try {
      const res = await fetch("/api/calendar/renumber-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, giorniAvanti: giorni }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRenumError(data.error || "Errore nel calcolo dell'anteprima.");
        setRenumStep("error");
        return;
      }
      setRenumData(data.pazienti || []);
      setRenumStep("preview");
    } catch (e) {
      setRenumError(e.message);
      setRenumStep("error");
    }
  }

  function apriRinumerazione(patientId) {
    setRenumTarget(patientId);
    setRenumGiorni(90);
    setRenumData(null);
    setRenumWriteResult(null);
    caricaAnteprimaRinumerazione(patientId, 90);
  }

  async function confermaRinumerazione() {
    setRenumStep("writing");
    const aggiornamenti = (renumData || []).flatMap((p) =>
      p.piano.map((r) => ({ id: r.id, descrizioneNuova: r.descrizioneNuova }))
    );

    const blocchi = [];
    for (let i = 0; i < aggiornamenti.length; i += RENUM_CHUNK_SIZE) {
      blocchi.push(aggiornamenti.slice(i, i + RENUM_CHUNK_SIZE));
    }

    setRenumProgress({ fatti: 0, totale: aggiornamenti.length });
    let scritti = 0;
    let falliti = 0;
    const dettagli = [];
    try {
      for (const blocco of blocchi) {
        const res = await fetch("/api/calendar/renumber-confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aggiornamenti: blocco }),
        });
        const data = await res.json();
        if (!res.ok) {
          setRenumError(data.error || "Errore durante la scrittura.");
          setRenumStep("error");
          return;
        }
        scritti += data.scritti || 0;
        falliti += data.falliti || 0;
        dettagli.push(...(data.dettagli || []));
        setRenumProgress({ fatti: scritti + falliti, totale: aggiornamenti.length });
      }
      setRenumWriteResult({ ok: falliti === 0, scritti, falliti, dettagli });
      setRenumStep("done");
      // Segna il passaggio 3 della routine di fine giornata solo per
      // "Rinumera tutti" (renumTarget nullo) — un rilancio su un singolo
      // paziente non conta come "fatto il giro di oggi". Il callback lascia
      // che chi e' gia' montato sulla Dashboard rilegga subito lo stato
      // (segnaRoutine da solo scrive in localStorage ma non aggiorna lo
      // useState della pagina chiamante).
      if (renumTarget === null) {
        segnaRoutine(todayISO(), "rinumera");
        onRinumeraTuttiCompletato?.();
      }
    } catch (e) {
      setRenumError(e.message);
      setRenumStep("error");
    }
  }

  function chiudiRinumerazione() {
    setRenumStep(null);
    setRenumTarget(null);
    setRenumData(null);
    setRenumWriteResult(null);
    setRenumError("");
    setRenumProgress(null);
  }

  const renumerazioneModal = renumStep && (
    <Modal maxWidth={640}>
      <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>Aggiorna numerazione calendario</h2>

      {renumStep === "loading" && <p>Calcolo dell&apos;anteprima in corso…</p>}

      {renumStep === "error" && (
        <>
          <p style={{ color: "crimson" }}>{renumError}</p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={chiudiRinumerazione}>Chiudi</button>
          </div>
        </>
      )}

      {renumStep === "preview" && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
            <label className="muted small">Giorni futuri da considerare:</label>
            <input
              type="number" className="num" style={{ width: 70 }}
              value={renumGiorni}
              onChange={(e) => setRenumGiorni(parseInt(e.target.value) || 90)}
            />
            <button className="btn btn-ghost" onClick={() => caricaAnteprimaRinumerazione(renumTarget, renumGiorni)}>Ricalcola</button>
          </div>

          {(!renumData || renumData.length === 0) ? (
            <p className="muted">Nessuna modifica da fare: le note sono già aggiornate.</p>
          ) : (
            renumData.map((p) => (
              <div key={p.pazienteId} style={{ marginBottom: 18 }}>
                <strong>{p.nome}</strong>
                <table style={{ width: "100%", fontSize: 13, marginTop: 4 }}>
                  <tbody>
                    {p.piano.map((r) => (
                      <tr key={r.id}>
                        <td style={{ padding: "2px 8px 2px 0", whiteSpace: "nowrap", color: "#55645D" }}>
                          {r.data}{r.ora ? ` ${r.ora}` : ""}
                        </td>
                        <td style={{ padding: "2px 8px", fontWeight: r.fatturare ? 600 : 400 }}>{r.codice}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={chiudiRinumerazione}>Annulla</button>
            {renumData && renumData.length > 0 && (
              <button className="btn btn-primary" onClick={confermaRinumerazione}>Conferma e scrivi su calendario</button>
            )}
          </div>
        </>
      )}

      {renumStep === "writing" && (
        <>
          <p>Scrittura in corso su Google Calendar…</p>
          {renumProgress && (
            <>
              <div style={{ background: "#EEF1EE", borderRadius: 6, overflow: "hidden", height: 10 }}>
                <div
                  style={{
                    width: `${Math.round((renumProgress.fatti / Math.max(renumProgress.totale, 1)) * 100)}%`,
                    background: "#3E6B4F",
                    height: "100%",
                    transition: "width 150ms ease",
                  }}
                />
              </div>
              <p className="muted small" style={{ marginTop: 6 }}>
                {renumProgress.fatti} / {renumProgress.totale} eventi aggiornati
              </p>
            </>
          )}
        </>
      )}

      {renumStep === "done" && renumWriteResult && (
        <>
          <p>
            {renumWriteResult.ok
              ? `Fatto: ${renumWriteResult.scritti} eventi aggiornati.`
              : `${renumWriteResult.scritti} eventi aggiornati, ${renumWriteResult.falliti} falliti.`}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={chiudiRinumerazione}>Chiudi</button>
          </div>
        </>
      )}
    </Modal>
  );

  return { apriRinumerazione, renumerazioneModal };
}
