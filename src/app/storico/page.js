"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";

export default function StoricoPage() {
  const supabase = createClient();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("invoice_history").select("*").order("data", { ascending: false });
      setHistory(data || []);
      setLoading(false);
    })();
  }, [supabase]);

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
              <tr><th>Data</th><th>Codice fiscale</th><th>Sedute</th><th>Onorario</th><th>Note</th></tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="mono">{h.data}</td>
                  <td className="mono">{h.codice_fiscale}</td>
                  <td className="mono">{h.totale_sedute}</td>
                  <td className="mono">€ {h.onorario}</td>
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
