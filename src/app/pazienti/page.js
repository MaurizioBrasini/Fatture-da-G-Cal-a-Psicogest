"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import { normalizeName, todayISO } from "@/lib/logic";

const TIPOLOGIE = [
  { value: "individuale", label: "Individuale" },
  { value: "coppia", label: "Coppia" },
  { value: "consulenza", label: "Consulenza" },
];
const TIPOLOGIA_LABEL = { individuale: "Individuale", coppia: "Coppia", consulenza: "Consulenza" };
const TIPOLOGIA_FROM_LABEL = { INDIVIDUALE: "individuale", COPPIA: "coppia", CONSULENZA: "consulenza" };

export default function PazientiPage() {
  const supabase = createClient();
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("patients").select("*").order("id");
    setPatients(data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateField(id, field, value) {
    setPatients((ps) => ps.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
    await supabase.from("patients").update({ [field]: value }).eq("id", id);
  }

  async function addPatient() {
    const { data: userData } = await supabase.auth.getUser();
    const { data } = await supabase
      .from("patients")
      .insert({ user_id: userData.user.id, tipologia: "individuale", costo_unitario: 80, soglia_fatturazione: 5, modalita_pagamento: "Bonifico" })
      .select()
      .single();
    if (data) setPatients((ps) => [...ps, data]);
  }

  async function removePatient(id) {
    setPatients((ps) => ps.filter((p) => p.id !== id));
    await supabase.from("patients").delete().eq("id", id);
  }

  function exportAnagrafica() {
    const rows = patients.map((p) => ({
      "Nome calendario": p.nome_calendario,
      "Fatturare a": p.fatturare_a,
      "Codice fiscale": p.codice_fiscale,
      Tipologia: TIPOLOGIA_LABEL[p.tipologia] || p.tipologia,
      Tariffa: p.costo_unitario,
      "Soglia fatturazione": p.soglia_fatturazione,
      "Giorni inattività": p.giorni_stale_override || "",
      Pagamento: p.modalita_pagamento,
      "Ancora data": p.ancora_data || "",
      "Ancora valore": p.ancora_valore,
      Note: p.note || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pazienti");
    XLSX.writeFile(wb, `anagrafica_pazienti_${todayISO()}.xlsx`);
  }

  function importAnagrafica(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const { data: userData } = await supabase.auth.getUser();
      let added = 0,
        updated = 0;
      for (const row of rows) {
        const nomeCal = String(row["Nome calendario"] || "").trim();
        let fatturareA = String(row["Fatturare a"] || "").trim();
        // Formato grezzo di export Psicogest: colonne separate "Nome" e "Cognome" invece di "Fatturare a"
        if (!fatturareA) {
          const nome = String(row["Nome"] || "").trim();
          const cognome = String(row["Cognome"] || "").trim();
          if (nome && cognome) fatturareA = `${cognome} ${nome}`;
        }
        if (!nomeCal && !fatturareA) continue;
        const key = normalizeName(fatturareA || nomeCal);
        const existing = patients.find((p) => normalizeName(p.fatturare_a || p.nome_calendario) === key);
        const tipologia = TIPOLOGIA_FROM_LABEL[String(row["Tipologia"] || "").toUpperCase()] || (existing ? existing.tipologia : "individuale");
        const cf = String(row["Codice fiscale"] || row["Codice Fiscale"] || "").trim().toUpperCase();
        const rawGiorniStale = row["Giorni inattività"];
        const rawSoglia = row["Soglia fatturazione"];
        const rawTariffa = row["Tariffa"];

        if (existing) {
          const patch = {
            nome_calendario: nomeCal || existing.nome_calendario,
            fatturare_a: fatturareA,
            tipologia,
            costo_unitario: parseFloat(rawTariffa) || existing.costo_unitario,
            codice_fiscale: cf || existing.codice_fiscale,
            soglia_fatturazione: rawSoglia ? parseInt(rawSoglia) || existing.soglia_fatturazione : existing.soglia_fatturazione,
            giorni_stale_override: rawGiorniStale ? parseInt(rawGiorniStale) || existing.giorni_stale_override : existing.giorni_stale_override,
          };
          await supabase.from("patients").update(patch).eq("id", existing.id);
          updated++;
        } else {
          await supabase.from("patients").insert({
            user_id: userData.user.id,
            nome_calendario: nomeCal,
            fatturare_a: fatturareA,
            tipologia,
            costo_unitario: parseFloat(rawTariffa) || 80,
            codice_fiscale: cf,
            soglia_fatturazione: parseInt(rawSoglia) || 5,
            giorni_stale_override: parseInt(rawGiorniStale) || null,
            modalita_pagamento: String(row["Pagamento"] || "Bonifico").trim(),
          });
          added++;
        }
      }
      await load();
      alert(`Import completato: ${updated} pazienti aggiornati, ${added} nuovi aggiunti.`);
    };
    reader.readAsArrayBuffer(file);
  }

  if (loading) return <div style={{ padding: 40 }}>Caricamento…</div>;

  const filtered = patients
    .filter((p) => normalizeName((p.nome_calendario || "") + " " + (p.fatturare_a || "")).includes(normalizeName(query)))
    .filter((p) => !onlyIncomplete || !p.nome_calendario || !p.codice_fiscale);

  return (
    <div className="app-root">
      <Sidebar readyCount={0} />
      <main className="main">
        <header className="view-header">
          <div>
            <h1>Pazienti</h1>
            <p className="sub">Anagrafica usata per abbinare gli eventi del calendario e calcolare l&apos;importo.</p>
          </div>
          <div className="header-actions">
            <button className="btn btn-ghost" onClick={exportAnagrafica}>Scarica anagrafica (.xlsx)</button>
            <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>Carica anagrafica (.xlsx)</button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  importAnagrafica(e.target.files[0]);
                  e.target.value = "";
                }
              }}
            />
            <button className="btn btn-primary" onClick={addPatient}>+ Nuovo paziente</button>
          </div>
        </header>

        <input className="search" placeholder="Cerca per nome…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#55645D", marginBottom: 14, marginLeft: 16 }}>
          <input type="checkbox" checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} />
          Mostra solo da completare (manca nome calendario o CF)
        </label>

        <div className="table-scroll">
          <table className="tbl editable">
            <thead>
              <tr>
                <th>Nome in calendario</th>
                <th>Fatturare a</th>
                <th>Codice fiscale</th>
                <th>Tipologia</th>
                <th>Tariffa €</th>
                <th>Soglia</th>
                <th>Giorni inattività</th>
                <th>Ancora: data</th>
                <th>Ancora: valore</th>
                <th>Pagamento</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input value={p.nome_calendario || ""} placeholder="manca" className={!p.nome_calendario ? "input-missing" : ""} onChange={(e) => updateField(p.id, "nome_calendario", e.target.value)} />
                  </td>
                  <td><input value={p.fatturare_a || ""} onChange={(e) => updateField(p.id, "fatturare_a", e.target.value)} /></td>
                  <td>
                    <input
                      className={!p.codice_fiscale ? "input-missing" : ""}
                      value={p.codice_fiscale || ""}
                      placeholder="manca"
                      onChange={(e) => updateField(p.id, "codice_fiscale", e.target.value.toUpperCase())}
                    />
                  </td>
                  <td>
                    <select value={p.tipologia} onChange={(e) => updateField(p.id, "tipologia", e.target.value)}>
                      {TIPOLOGIE.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </td>
                  <td><input type="number" className="num" value={p.costo_unitario} onChange={(e) => updateField(p.id, "costo_unitario", parseFloat(e.target.value) || 0)} /></td>
                  <td><input type="number" className="num" value={p.soglia_fatturazione} onChange={(e) => updateField(p.id, "soglia_fatturazione", parseInt(e.target.value) || 5)} /></td>
                  <td><input type="number" className="num" placeholder="def." value={p.giorni_stale_override || ""} onChange={(e) => updateField(p.id, "giorni_stale_override", parseInt(e.target.value) || null)} /></td>
                  <td><input type="date" value={p.ancora_data || ""} onChange={(e) => updateField(p.id, "ancora_data", e.target.value)} /></td>
                  <td><input type="number" className="num" value={p.ancora_valore} onChange={(e) => updateField(p.id, "ancora_valore", parseInt(e.target.value) || 0)} /></td>
                  <td>
                    <select value={p.modalita_pagamento} onChange={(e) => updateField(p.id, "modalita_pagamento", e.target.value)}>
                      <option>Bonifico</option><option>Contante</option><option>Paypal</option><option>Carta</option>
                    </select>
                  </td>
                  <td><button className="btn-icon" onClick={() => removePatient(p.id)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
