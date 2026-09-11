"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import { importoLordoDaOnorario } from "@/lib/logic";

export default function StoricoPage() {
  const supabase = createClient();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const [patientsById, setPatientsById] = useState({});

  useEffect(() => {
    (async () => {
      const [{ data }, { data: patients }] = await Promise.all([
        supabase.from("invoice_history").select("*").order("data", { ascending: false }),
        supabase.from("patients").select("id, nome, cognome, nome_calendario, fatturare_a"),
      ]);
      setHistory(data || []);
      setPatientsById(Object.fromEntries((patients || []).map((p) => [p.id, p])));
      setLoading(false);
    })();
  }, [supabase]);

  // Tutto maiuscolo qui volutamente (a differenza di Pazienti/Dashboard, che
  // usano il lettering "solo iniziali"): lo storico fatture segue la
  // convenzione delle fatture vere, non quella dei contatti — richiesto da
  // Maurizio 2026-09-11.
  function nomePaziente(h) {
    const p = patientsById[h.patient_id];
    const nome = p && (p.nome || p.cognome) ? `${p.nome || ""} ${p.cognome || ""}`.trim() : p?.nome_calendario || p?.fatturare_a || h.codice_fiscale;
    return nome.toUpperCase();
  }

  // L'importo salvato (h.onorario) è l'onorario già scorporato del 2% ENPAP
  // (vedi buildInvoiceRow in logic.js): qui si ricostruisce la cifra lorda
  // tonda che Maurizio vuole vedere in questa schermata (es. 250€, non
  // 245,10€), senza toccare il dato salvato.
  function importoLordo(h) {
    return importoLordoDaOnorario(h.onorario);
  }

  if (loading) return <div style={{ padding: 40 }}>Caricamento…</div>;

  return (
    <div className="app-root">
      <Sidebar readyCount={0} />
      <main className="main">
        <header className="view-header">
          <div>
            <h1>Storico fatture</h1>
            <p className="sub">Registro dei batch confermati come caricati su Psicogest.</p>
          </div>
        </header>
        {history.length === 0 ? (
          <div className="empty-row">Nessuna fattura confermata finora.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Data</th><th>Paziente</th><th>Codice fiscale</th><th>Sedute</th><th>Importo</th><th>Note</th></tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="mono">{h.data}</td>
                  <td className="name">{nomePaziente(h)}</td>
                  <td className="mono">{h.codice_fiscale}</td>
                  <td className="mono">{h.totale_sedute}</td>
                  <td className="mono">€ {importoLordo(h)}</td>
                  <td>{h.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
