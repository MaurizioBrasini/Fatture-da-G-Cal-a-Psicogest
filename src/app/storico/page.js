"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import RigeneraFattureModal from "@/components/RigeneraFattureModal";
import { importoLordoDaOnorario, DEFAULT_SETTINGS } from "@/lib/logic";

export default function StoricoPage() {
  const supabase = createClient();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const [patientsById, setPatientsById] = useState({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [selected, setSelected] = useState({});
  const [rigenera, setRigenera] = useState(false);

  const load = useCallback(async () => {
    const [{ data }, { data: patients }, { data: s }] = await Promise.all([
      supabase.from("invoice_history").select("*").order("data", { ascending: false }),
      supabase.from("patients").select("*"),
      supabase.from("settings").select("*").maybeSingle(),
    ]);
    setHistory(data || []);
    setPatientsById(Object.fromEntries((patients || []).map((p) => [p.id, p])));
    if (s) setSettings(s);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

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

  const selezionate = history.filter((h) => selected[h.id]);

  // Aggiorna le righe dello storico dopo aver rifatto l'Excel. Se la colonna
  // "numero" non esiste ancora (schema_addendum16 non eseguito) riprova senza:
  // il file è già stato scaricato, non deve andare perso per questo.
  async function aggiornaStorico(aggiornamenti) {
    let numeroNonSalvato = false;
    for (const { id, numero, patch } of aggiornamenti) {
      let { error } = await supabase.from("invoice_history").update({ ...patch, numero }).eq("id", id);
      if (error) {
        numeroNonSalvato = true;
        ({ error } = await supabase.from("invoice_history").update(patch).eq("id", id));
        if (error) throw error;
      }
    }
    setRigenera(false);
    setSelected({});
    await load();
    if (numeroNonSalvato) {
      window.alert("Excel scaricato e storico aggiornato, ma il numero di fattura non è stato salvato: esegui schema_addendum16.sql su Supabase.");
    }
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
          {history.length > 0 && (
            <button className="btn btn-primary" disabled={!selezionate.length} onClick={() => setRigenera(true)}>
              Rigenera Excel{selezionate.length ? ` (${selezionate.length})` : ""}
            </button>
          )}
        </header>
        {history.length === 0 ? (
          <div className="empty-row">Nessuna fattura confermata finora.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>N.</th><th>Data</th><th>Paziente</th><th>Codice fiscale</th><th>Sedute</th><th>Importo</th><th>Note</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!selected[h.id]}
                      onChange={() => setSelected((s) => ({ ...s, [h.id]: !s[h.id] }))}
                    />
                  </td>
                  <td className="mono">{h.numero || "—"}</td>
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
      {rigenera && (
        <RigeneraFattureModal
          fatture={selezionate}
          patientsById={patientsById}
          settings={settings}
          nomePaziente={nomePaziente}
          onClose={() => setRigenera(false)}
          onDone={aggiornaStorico}
        />
      )}
    </div>
  );
}
