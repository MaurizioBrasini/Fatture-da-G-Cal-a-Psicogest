"use client";
import { useState } from "react";
import * as XLSX from "xlsx";
import Modal from "@/components/Modal";
import { buildInvoiceRow, COLUMN_ORDER, todayISO } from "@/lib/logic";

// Le fatture storiche non hanno il periodo in una colonna dedicata: sta solo
// nella nota ("... dal 2026-08-03 al 2026-08-31" oppure "... il 2026-08-03").
function periodoDaNota(note) {
  const n = note || "";
  const range = n.match(/dal (\d{4}-\d{2}-\d{2}) al (\d{4}-\d{2}-\d{2})/);
  if (range) return { dal: range[1], al: range[2] };
  const singolo = n.match(/il (\d{4}-\d{2}-\d{2})/);
  if (singolo) return { dal: singolo[1], al: singolo[1] };
  return { dal: "", al: "" };
}

// Rifà l'Excel di import per Psicogest a partire da fatture già nello storico.
// Ricostruisce ogni riga con buildInvoiceRow usando i dati ATTUALI del
// paziente (CF, tariffa, pagamento...) e i valori di sedute/date/numero
// modificabili qui. Non tocca ancora, saldo contanti né numerazione
// successiva: la fattura era già stata contata la prima volta.
export default function RigeneraFattureModal({ fatture, patientsById, settings, nomePaziente, onClose, onDone }) {
  const [righe, setRighe] = useState(() =>
    [...fatture]
      .sort((a, b) => (a.numero || 1e9) - (b.numero || 1e9))
      .map((h) => {
        const { dal, al } = periodoDaNota(h.note);
        return {
          h,
          numero: h.numero ? String(h.numero) : "",
          data: h.data,
          count: String(h.totale_sedute),
          dal,
          al,
        };
      })
  );
  const [busy, setBusy] = useState(false);
  const [errore, setErrore] = useState("");

  function set(i, campo, valore) {
    setRighe((rs) => rs.map((r, k) => (k === i ? { ...r, [campo]: valore } : r)));
  }

  const numeri = righe.map((r) => parseInt(r.numero, 10)).filter((n) => n > 0);
  const doppioni = new Set(numeri.filter((n, i) => numeri.indexOf(n) !== i));
  const senzaPaziente = righe.filter((r) => !patientsById[r.h.patient_id]);
  const incomplete = righe.some(
    (r) => !(parseInt(r.numero, 10) > 0) || !(parseInt(r.count, 10) > 0) || !r.data
  );
  const bloccato = busy || incomplete || doppioni.size > 0 || senzaPaziente.length > 0;

  async function genera() {
    setBusy(true);
    setErrore("");
    try {
      const ordinate = [...righe].sort((a, b) => parseInt(a.numero, 10) - parseInt(b.numero, 10));
      const built = ordinate.map((r, i) => {
        const count = parseInt(r.count, 10);
        const usati = [];
        if (r.dal) usati.push({ data: r.dal });
        if (r.al && r.al !== r.dal) usati.push({ data: r.al });
        const computed = { count, usati, ultimaData: r.al || r.dal || null };
        const row = buildInvoiceRow(patientsById[r.h.patient_id], computed, settings, r.data, i + 1, parseInt(r.numero, 10));
        return { r, row };
      });

      const exportRows = built.map(({ row: { _onorario, _count, _tariffa, ...rest } }) => rest);
      const ws = XLSX.utils.json_to_sheet(exportRows, { header: COLUMN_ORDER });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Foglio1");
      XLSX.writeFile(wb, `import_fatture_rigenerate_${todayISO()}.xls`, { bookType: "xls" });

      // Lo storico deve restare coerente con il file appena scaricato.
      await onDone(
        built.map(({ r, row }) => ({
          id: r.h.id,
          numero: Number(row.fatturaNUMERO),
          patch: {
            data: r.data,
            codice_fiscale: row.pazienteID,
            totale_sedute: row._count,
            onorario: row._onorario,
            note: row.fatturaNOTE,
          },
        }))
      );
    } catch (e) {
      setErrore(e.message || String(e));
      setBusy(false);
    }
  }

  const cella = { padding: "4px 6px" };
  const inp = { padding: "5px 6px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, boxSizing: "border-box" };

  return (
    <Modal maxWidth={900}>
      <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>
        Rigenera Excel per Psicogest ({righe.length} {righe.length === 1 ? "fattura" : "fatture"})
      </h2>
      <p className="muted small">
        Le righe vengono ricostruite con i dati <strong>attuali</strong> del paziente (codice fiscale, tariffa,
        modalità di pagamento, tipologia). Correggi qui numero, data, sedute e periodo se serve. Ricorda di
        eliminare su Psicogest le vecchie versioni prima di reimportare, altrimenti risultano doppie.
        Il conteggio sedute del paziente in Dashboard non viene toccato.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr><th>Paziente</th><th>N. fattura</th><th>Data fattura</th><th>Sedute</th><th>Dal</th><th>Al</th></tr>
          </thead>
          <tbody>
            {righe.map((r, i) => {
              const n = parseInt(r.numero, 10);
              return (
                <tr key={r.h.id}>
                  <td className="name" style={cella}>
                    {nomePaziente(r.h)}
                    {!patientsById[r.h.patient_id] && (
                      <div style={{ color: "crimson", fontSize: 12 }}>paziente non più in anagrafica</div>
                    )}
                  </td>
                  <td style={cella}>
                    <input type="number" className="num" style={{ ...inp, width: 80, borderColor: doppioni.has(n) ? "crimson" : undefined }}
                      value={r.numero} onChange={(e) => set(i, "numero", e.target.value)} />
                  </td>
                  <td style={cella}>
                    <input type="date" style={inp} value={r.data} onChange={(e) => set(i, "data", e.target.value)} />
                  </td>
                  <td style={cella}>
                    <input type="number" className="num" style={{ ...inp, width: 60 }}
                      value={r.count} onChange={(e) => set(i, "count", e.target.value)} />
                  </td>
                  <td style={cella}>
                    <input type="date" style={inp} value={r.dal} onChange={(e) => set(i, "dal", e.target.value)} />
                  </td>
                  <td style={cella}>
                    <input type="date" style={inp} value={r.al} onChange={(e) => set(i, "al", e.target.value)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {doppioni.size > 0 && (
        <p style={{ color: "crimson", fontSize: 13 }}>Ci sono numeri di fattura ripetuti: correggili per procedere.</p>
      )}
      {righe.some((r) => !r.numero) && (
        <p className="muted small">
          Per le fatture emesse prima di questa funzione il numero non era salvato: digitalo a mano (lo trovi su Psicogest).
        </p>
      )}
      {errore && <p style={{ color: "crimson", fontSize: 13 }}>Errore: {errore}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Annulla</button>
        <button className="btn btn-primary" disabled={bloccato} onClick={genera}>
          {busy ? "Generazione…" : "Scarica Excel e aggiorna storico"}
        </button>
      </div>
    </Modal>
  );
}
