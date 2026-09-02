"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import { DEFAULT_SETTINGS } from "@/lib/logic";

export default function ImpostazioniPage() {
  const supabase = createClient();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

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
      </main>
    </div>
  );
}
