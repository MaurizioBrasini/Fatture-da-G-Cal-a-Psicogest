"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import { DEFAULT_SETTINGS, todayISO, addDays } from "@/lib/logic";

export default function ImpostazioniPage() {
  const supabase = createClient();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  // --- Prova a vuoto (sola lettura) sulle note del calendario ---
  const [auditFrom, setAuditFrom] = useState("2015-01-01");
  const [auditTo, setAuditTo] = useState(() => addDays(todayISO(), 365));
  const [auditStatus, setAuditStatus] = useState(null); // null | 'loading' | 'done' | 'error'
  const [auditResult, setAuditResult] = useState(null);
  const [auditError, setAuditError] = useState("");

  async function eseguiAudit() {
    setAuditStatus("loading");
    setAuditError("");
    try {
      const res = await fetch("/api/calendar/audit-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: auditFrom, to: auditTo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuditError(data.error || "Errore durante il controllo.");
        setAuditStatus("error");
        return;
      }
      setAuditResult(data);
      setAuditStatus("done");
    } catch (e) {
      setAuditError(e.message);
      setAuditStatus("error");
    }
  }

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      let { data } = await supabase.from("settings").select("*").maybeSingle();
      if (!data) {
        const { data: created } = await supabase
          .from("settings")
          .insert({ user_id: userData.user.id, ...DEFAULT_SETTINGS })
          .select()
          .single();
        data = created;
      }
      setSettings(data);
      setLoading(false);
    })();
  }, [supabase]);

  async function set(field, value) {
    const next = { ...settings, [field]: value };
    setSettings(next);
    await supabase.from("settings").update({ [field]: value }).eq("user_id", settings.user_id);
  }

  if (loading) return <div style={{ padding: 40 }}>Caricamento…</div>;

  return (
    <div className="app-root">
      <Sidebar readyCount={0} />
      <main className="main">
        <header className="view-header">
          <div>
            <h1>Impostazioni</h1>
            <p className="sub">
              Valori di default. ENPAP, bollo e totale non vengono calcolati qui: li completa Psicogest
              all&apos;importazione, come fai già oggi a mano.
            </p>
          </div>
        </header>

        <div className="settings-grid">
          <label>
            Soglia di fatturazione predefinita (numero di sedute)
            <input type="number" className="num" value={settings.soglia_default} onChange={(e) => set("soglia_default", parseInt(e.target.value) || 5)} />
          </label>
          <label>
            Giorni di inattività prima di segnalare &quot;da valutare&quot;
            <input type="number" className="num" value={settings.giorni_stale} onChange={(e) => set("giorni_stale", parseInt(e.target.value) || 60)} />
          </label>
          <label>
            Soglia importo (€) oltre cui marcare il &quot;codice bollo&quot;
            <input type="number" className="num" value={settings.bollo_soglia} onChange={(e) => set("bollo_soglia", parseFloat(e.target.value) || 0)} />
          </label>
        </div>

        <h2 className="sub-heading">Testo prestazione per il file di import</h2>
        <div className="settings-grid">
          <label>
            Individuale
            <input value={settings.prestazione_individuale} onChange={(e) => set("prestazione_individuale", e.target.value)} />
          </label>
          <label>
            Coppia
            <input value={settings.prestazione_coppia} onChange={(e) => set("prestazione_coppia", e.target.value)} />
          </label>
          <label>
            Consulenza
            <input value={settings.prestazione_consulenza} onChange={(e) => set("prestazione_consulenza", e.target.value)} />
          </label>
        </div>

        <h2 className="sub-heading">Tariffe standard (€ a seduta)</h2>
        <p className="sub" style={{ marginBottom: 12 }}>
          Usate per compilare in automatico la tariffa quando imposti tipologia e regime di un paziente in
          "Pazienti" — resta comunque modificabile a mano per i casi valutati caso per caso.
        </p>
        <div className="settings-grid">
          <label>
            Individuale — regolare
            <input type="number" step="0.01" className="num" value={settings.tariffa_individuale_regolare} onChange={(e) => set("tariffa_individuale_regolare", parseFloat(e.target.value) || 0)} />
          </label>
          <label>
            Individuale — agevolata
            <input type="number" step="0.01" className="num" value={settings.tariffa_individuale_agevolata} onChange={(e) => set("tariffa_individuale_agevolata", parseFloat(e.target.value) || 0)} />
          </label>
          <label>
            Coppia — regolare
            <input type="number" step="0.01" className="num" value={settings.tariffa_coppia_regolare} onChange={(e) => set("tariffa_coppia_regolare", parseFloat(e.target.value) || 0)} />
          </label>
          <label>
            Coppia — agevolata
            <input type="number" step="0.01" className="num" value={settings.tariffa_coppia_agevolata} onChange={(e) => set("tariffa_coppia_agevolata", parseFloat(e.target.value) || 0)} />
          </label>
          <label>
            Consulenza — regolare
            <input type="number" step="0.01" className="num" value={settings.tariffa_consulenza_regolare} onChange={(e) => set("tariffa_consulenza_regolare", parseFloat(e.target.value) || 0)} />
          </label>
          <label>
            Consulenza — agevolata
            <input type="number" step="0.01" className="num" value={settings.tariffa_consulenza_agevolata} onChange={(e) => set("tariffa_consulenza_agevolata", parseFloat(e.target.value) || 0)} />
          </label>
        </div>

        <h2 className="sub-heading">Strumenti diagnostici</h2>
        <p className="sub" style={{ marginBottom: 12 }}>
          Prova a vuoto (sola lettura, non scrive nulla su Google): controlla le note del calendario nell&apos;intervallo
          scelto e segnala quelle che sembrano contenere un vecchio codice scritto a mano (es. &quot;Np 3&quot;) non
          riconosciuto dalla funzione di rinumerazione. Utile da lanciare una volta prima di usare &quot;Rinumera
          tutti&quot; con fiducia piena su tutto lo storico.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <label className="muted small">
            Da<br />
            <input type="date" value={auditFrom} onChange={(e) => setAuditFrom(e.target.value)} />
          </label>
          <label className="muted small">
            A<br />
            <input type="date" value={auditTo} onChange={(e) => setAuditTo(e.target.value)} />
          </label>
          <button className="btn btn-primary" onClick={eseguiAudit} disabled={auditStatus === "loading"}>
            {auditStatus === "loading" ? "Controllo in corso…" : "Controlla note calendario"}
          </button>
        </div>

        {auditStatus === "error" && <div className="error-box">{auditError}</div>}

        {auditStatus === "done" && auditResult && (
          <div>
            <p className="muted small">
              {auditResult.totaleEventi} eventi nell&apos;intervallo, {auditResult.eventiConNota} con una nota,{" "}
              <strong>{auditResult.sospette}</strong> con un possibile codice non riconosciuto
              {auditResult.troncato ? ` (mostrate le prime ${auditResult.flagged.length})` : ""}.
              <br />
              Eventi effettivamente letti: dal <strong>{auditResult.primoEvento || "—"}</strong> al{" "}
              <strong>{auditResult.ultimoEvento || "—"}</strong>
              {auditResult.ultimoEvento && auditResult.ultimoEvento < todayISO() && (
                <span style={{ color: "crimson" }}>
                  {" "}
                  — attenzione, si ferma prima di oggi: la lettura non ha coperto tutto l&apos;intervallo richiesto.
                </span>
              )}
            </p>
            {auditResult.perAnno && Object.keys(auditResult.perAnno).length > 0 && (
              <div className="table-scroll" style={{ marginBottom: 16 }}>
                <table className="tbl">
                  <thead>
                    <tr><th>Anno</th><th>Eventi</th><th>Con nota</th><th>Sospette</th></tr>
                  </thead>
                  <tbody>
                    {Object.keys(auditResult.perAnno).sort().map((anno) => (
                      <tr key={anno}>
                        <td className="mono">{anno}</td>
                        <td className="mono">{auditResult.perAnno[anno].eventi}</td>
                        <td className="mono">{auditResult.perAnno[anno].conNota}</td>
                        <td className="mono">{auditResult.perAnno[anno].sospette}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {auditResult.flagged.length > 0 && (
              <div className="table-scroll" style={{ maxHeight: 400, overflowY: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Titolo</th>
                      <th>Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditResult.flagged.map((f, i) => (
                      <tr key={i}>
                        <td className="mono">{f.data}{f.ora ? ` ${f.ora}` : ""}</td>
                        <td>{f.titolo}</td>
                        <td>{f.descrizione}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
