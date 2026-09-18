"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Modal from "@/components/Modal";

const CAMPO_LABEL = { telefono: "Telefono", email: "Email", indirizzo: "Indirizzo" };

// Verifica bulk dei pazienti contro i Contatti Google — stesso pattern
// "step state machine" già usato in Pazienti per "Genera occorrenze
// future"/"Chiusure calendario" (loading → preview con checkbox → writing
// → done), ma qui condiviso tra Pazienti e Comunicazioni tramite la prop
// `fields`, perché è la STESSA funzionalità invocata da due pagine, non
// due feature diverse.
//
// Le righe "mancante" (campo vuoto oggi) partono selezionate di default
// (sicuro riempirle, stesso criterio dello script popola-contatti-da-
// psicogest.mjs). Le righe "diverso" (valore già presente ma differisce)
// partono NON selezionate — sovrascrivere un dato già presente richiede
// conferma esplicita, per non rischiare un match sbagliato.
export default function VerificaContattiModal({ fields, onClose, onDone }) {
  const supabase = createClient();
  const [step, setStep] = useState("loading"); // loading | preview | writing | done | error
  const [righe, setRighe] = useState([]);
  const [ambigui, setAmbigui] = useState([]);
  const [errore, setErrore] = useState(null);
  const [selezionati, setSelezionati] = useState(new Set());
  const [scritti, setScritti] = useState(0);

  useEffect(() => {
    caricaAnteprima();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function caricaAnteprima() {
    setStep("loading");
    setErrore(null);
    try {
      const res = await fetch("/api/contacts/verifica-preview", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verifica fallita");

      const righeFiltrate = (data.righe || [])
        .map((r) => ({ ...r, proposte: r.proposte.filter((p) => fields.includes(p.campo)) }))
        .filter((r) => r.proposte.length > 0);

      const iniziali = new Set();
      righeFiltrate.forEach((r) =>
        r.proposte.forEach((p) => {
          if (p.tipo === "mancante") iniziali.add(`${r.patientId}|${p.campo}`);
        })
      );

      setRighe(righeFiltrate);
      setAmbigui(data.ambigui || []);
      setSelezionati(iniziali);
      setStep("preview");
    } catch (e) {
      setErrore(e.message);
      setStep("error");
    }
  }

  function toggle(patientId, campo) {
    const chiave = `${patientId}|${campo}`;
    setSelezionati((prev) => {
      const next = new Set(prev);
      if (next.has(chiave)) next.delete(chiave);
      else next.add(chiave);
      return next;
    });
  }

  async function conferma() {
    setStep("writing");
    let fatti = 0;
    for (const r of righe) {
      const daScrivere = {};
      for (const p of r.proposte) {
        if (selezionati.has(`${r.patientId}|${p.campo}`)) daScrivere[p.campo] = p.valoreProposto;
      }
      if (Object.keys(daScrivere).length === 0) continue;
      const { error } = await supabase.from("patients").update(daScrivere).eq("id", r.patientId);
      if (!error) fatti++;
    }
    setScritti(fatti);
    setStep("done");
  }

  const totaleSelezionati = selezionati.size;

  return (
    <Modal maxWidth={640}>
      <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>Verifica contatti Google</h2>

      {step === "loading" && <p>Confronto con i Contatti Google in corso…</p>}

      {step === "error" && (
        <>
          <p style={{ color: "crimson" }}>{errore}</p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={onClose}>Chiudi</button>
          </div>
        </>
      )}

      {step === "preview" && (
        <>
          {ambigui.length > 0 && (
            <div style={{ marginBottom: 16, padding: 10, border: "1px solid #C77", borderRadius: 8, background: "#FFF5F5" }}>
              <p className="muted small" style={{ margin: 0 }}>
                <strong>{ambigui.length}</strong> pazient{ambigui.length === 1 ? "e" : "i"} con più contatti Google
                candidati (nome ambiguo) — saltat{ambigui.length === 1 ? "o" : "i"}, nessuna scelta automatica:{" "}
                {ambigui.map((a) => a.nome).join(", ")}.
              </p>
            </div>
          )}

          {righe.length === 0 ? (
            <p className="muted">Nessuna differenza trovata tra i pazienti e i Contatti Google.</p>
          ) : (
            <>
              <p className="muted small">
                Le voci "mancante" (campo vuoto) sono selezionate di default. Le voci "diverso" (valore già presente)
                vanno confermate a mano, per evitare di sovrascrivere un dato corretto con un abbinamento sbagliato.
              </p>
              {righe.map((r) => (
                <div key={r.patientId} style={{ marginBottom: 14 }}>
                  <strong>{r.nome}</strong>
                  <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                    {r.proposte.map((p) => {
                      const chiave = `${r.patientId}|${p.campo}`;
                      return (
                        <label key={chiave} className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <input type="checkbox" checked={selezionati.has(chiave)} onChange={() => toggle(r.patientId, p.campo)} />
                          <span className="muted" style={{ minWidth: 70 }}>{CAMPO_LABEL[p.campo] || p.campo}</span>
                          {p.valoreAttuale ? (
                            <>
                              <span style={{ textDecoration: "line-through" }} className="muted">{p.valoreAttuale}</span>
                              {" → "}
                            </>
                          ) : (
                            <span className="muted">(vuoto) → </span>
                          )}
                          <span>{p.valoreProposto}</span>
                          <span className="muted small">({p.tipo})</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={onClose}>Annulla</button>
            {totaleSelezionati > 0 && (
              <button className="btn btn-primary" onClick={conferma}>Conferma {totaleSelezionati} modifiche</button>
            )}
          </div>
        </>
      )}

      {step === "writing" && <p>Aggiornamento pazienti in corso…</p>}

      {step === "done" && (
        <>
          <p>Fatto: {scritti} pazient{scritti === 1 ? "e" : "i"} aggiornat{scritti === 1 ? "o" : "i"}.</p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={() => onDone?.()}>Chiudi</button>
          </div>
        </>
      )}
    </Modal>
  );
}
