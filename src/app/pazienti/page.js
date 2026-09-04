"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import { normalizeName, todayISO, tariffaStandard, DEFAULT_SETTINGS } from "@/lib/logic";

const TIPOLOGIE = [
  { value: "individuale", label: "Individuale" },
  { value: "coppia", label: "Coppia" },
  { value: "consulenza", label: "Consulenza" },
];
const TIPOLOGIA_LABEL = { individuale: "Individuale", coppia: "Coppia", consulenza: "Consulenza" };
const TIPOLOGIA_FROM_LABEL = { INDIVIDUALE: "individuale", COPPIA: "coppia", CONSULENZA: "consulenza" };

function SortableTh({ label, sortKey, sort, setSort }) {
  const active = sort.key === sortKey;
  return (
    <th
      onClick={() => setSort((s) => (s.key === sortKey ? { key: sortKey, dir: s.dir === "asc" ? "desc" : "asc" } : { key: sortKey, dir: "asc" }))}
      style={{ cursor: "pointer", userSelect: "none" }}
    >
      {label} {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
    </th>
  );
}

function sortRows(list, sort) {
  const arr = [...list];
  const getVal = (p) => {
    switch (sort.key) {
      case "nome_calendario": return (p.nome_calendario || "").toUpperCase();
      case "fatturare_a": return (p.fatturare_a || "").toUpperCase();
      case "tipologia": return p.tipologia || "";
      case "regime_tariffario": return p.regime_tariffario || "regolare";
      case "costo_unitario": return p.costo_unitario || 0;
      case "soglia_fatturazione": return p.soglia_fatturazione || 0;
      case "ancora_data": return p.ancora_data || "";
      case "stato": return p.stato || "";
      default: return "";
    }
  };
  // A parità di valore sulla chiave scelta, ordina in secondo luogo per
  // nome (alfabetico) — utile soprattutto per "Regime", dove i pazienti si
  // dividono solo in due gruppi.
  const nomeOrdinamento = (p) => (p.fatturare_a || p.nome_calendario || "").toUpperCase();
  arr.sort((a, b) => {
    const va = getVal(a), vb = getVal(b);
    if (va < vb) return sort.dir === "asc" ? -1 : 1;
    if (va > vb) return sort.dir === "asc" ? 1 : -1;
    const na = nomeOrdinamento(a), nb = nomeOrdinamento(b);
    if (na < nb) return -1;
    if (na > nb) return 1;
    return 0;
  });
  return arr;
}

export default function PazientiPage() {
  const supabase = createClient();
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [sort, setSort] = useState({ key: "fatturare_a", dir: "asc" });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: s }] = await Promise.all([
      supabase.from("patients").select("*").order("id"),
      supabase.from("settings").select("*").maybeSingle(),
    ]);
    setPatients(data || []);
    if (s) setSettings(s);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const [saveStatus, setSaveStatus] = useState("");

  async function updateTipologiaORegime(id, field, value) {
    const p = patients.find((pp) => pp.id === id);
    const nextTipologia = field === "tipologia" ? value : p.tipologia;
    const nextRegime = field === "regime_tariffario" ? value : p.regime_tariffario;
    const nuovaTariffa = tariffaStandard(nextTipologia, nextRegime, settings);
    setPatients((ps) => ps.map((pp) => (pp.id === id ? { ...pp, [field]: value, costo_unitario: nuovaTariffa } : pp)));
    await supabase.from("patients").update({ [field]: value, costo_unitario: nuovaTariffa }).eq("id", id);
  }

  function updateLocal(id, field, value) {
    setPatients((ps) => ps.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }

  async function updateField(id, field, value) {
    setPatients((ps) => ps.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
    await supabase.from("patients").update({ [field]: value }).eq("id", id);
  }

  async function persistField(id, field, value) {
    await supabase.from("patients").update({ [field]: value }).eq("id", id);
  }

  async function saveAll() {
    setSaveStatus("Salvataggio…");
    for (const p of patients) {
      const { id, ...fields } = p;
      await supabase.from("patients").update(fields).eq("id", id);
    }
    setSaveStatus("Tutto salvato ✓");
    setTimeout(() => setSaveStatus(""), 2500);
  }

  async function addPatient() {
    const { data: userData } = await supabase.auth.getUser();
    const nextMonday = new Date();
    nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));
    const { data } = await supabase
      .from("patients")
      .insert({
        user_id: userData.user.id,
        tipologia: "individuale",
        regime_tariffario: "regolare",
        costo_unitario: tariffaStandard("individuale", "regolare", settings),
        soglia_fatturazione: 5,
        modalita_pagamento: "Bonifico",
        ancora_data: nextMonday.toISOString().slice(0, 10),
        ancora_valore: 0,
      })
      .select()
      .single();
    if (data) setPatients((ps) => [...ps, data]);
  }

  async function removePatient(id, label) {
    if (!window.confirm(`Eliminare definitivamente "${label || "questo paziente"}"? L'operazione non si può annullare.`)) return;
    setPatients((ps) => ps.filter((p) => p.id !== id));
    await supabase.from("patients").delete().eq("id", id);
  }

  function exportAnagrafica() {
    const rows = patients.map((p) => ({
      "Nome calendario": p.nome_calendario,
      "Fatturare a": p.fatturare_a,
      "Codice fiscale": p.codice_fiscale,
      Tipologia: TIPOLOGIA_LABEL[p.tipologia] || p.tipologia,
      Regime: p.regime_tariffario === "agevolata" ? "Agevolata" : "Regolare",
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
        const cf = String(row["Codice fiscale"] || row["Codice Fiscale"] || "").trim().toUpperCase();
        const existing =
          (cf && patients.find((p) => p.codice_fiscale && p.codice_fiscale === cf)) ||
          patients.find((p) => normalizeName(p.fatturare_a || p.nome_calendario) === key);
        const tipologia = TIPOLOGIA_FROM_LABEL[String(row["Tipologia"] || "").toUpperCase()] || (existing ? existing.tipologia : "individuale");
        const regime = String(row["Regime"] || "").trim().toUpperCase() === "AGEVOLATA" ? "agevolata" : (existing ? existing.regime_tariffario : "regolare");
        const rawGiorniStale = row["Giorni inattività"];
        const rawSoglia = row["Soglia fatturazione"];
        const rawTariffa = row["Tariffa"];

        if (existing) {
          const patch = {
            nome_calendario: nomeCal || existing.nome_calendario,
            fatturare_a: fatturareA,
            tipologia,
            regime_tariffario: regime,
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
            regime_tariffario: regime,
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

  const filtered = sortRows(
    patients
      .filter((p) => normalizeName((p.nome_calendario || "") + " " + (p.fatturare_a || "")).includes(normalizeName(query)))
      .filter((p) => !onlyIncomplete || !p.nome_calendario || !p.codice_fiscale),
    sort
  );

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
            {saveStatus && <span className="muted small" style={{ alignSelf: "center" }}>{saveStatus}</span>}
            <button className="btn btn-primary" onClick={saveAll}>Salva tutte le modifiche</button>
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
                <SortableTh label="Nome in calendario" sortKey="nome_calendario" sort={sort} setSort={setSort} />
                <SortableTh label="Fatturare a" sortKey="fatturare_a" sort={sort} setSort={setSort} />
                <th>Codice fiscale</th>
                <SortableTh label="Tipologia" sortKey="tipologia" sort={sort} setSort={setSort} />
                <SortableTh label="Regime" sortKey="regime_tariffario" sort={sort} setSort={setSort} />
                <SortableTh label="Tariffa €" sortKey="costo_unitario" sort={sort} setSort={setSort} />
                <SortableTh label="Soglia" sortKey="soglia_fatturazione" sort={sort} setSort={setSort} />
                <th>Giorni inattività</th>
                <SortableTh label="Ancora: data" sortKey="ancora_data" sort={sort} setSort={setSort} />
                <th>Ancora: valore</th>
                <SortableTh label="Stato" sortKey="stato" sort={sort} setSort={setSort} />
                <th>Pagamento</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input value={p.nome_calendario || ""} placeholder="manca" className={!p.nome_calendario ? "input-missing" : ""} onChange={(e) => updateLocal(p.id, "nome_calendario", e.target.value)} onBlur={(e) => persistField(p.id, "nome_calendario", e.target.value)} />
                  </td>
                  <td><input value={p.fatturare_a || ""} onChange={(e) => updateLocal(p.id, "fatturare_a", e.target.value)} onBlur={(e) => persistField(p.id, "fatturare_a", e.target.value)} /></td>
                  <td>
                    <input
                      className={!p.codice_fiscale ? "input-missing" : ""}
                      value={p.codice_fiscale || ""}
                      placeholder="manca"
                      onChange={(e) => updateLocal(p.id, "codice_fiscale", e.target.value.toUpperCase())}
                      onBlur={(e) => persistField(p.id, "codice_fiscale", e.target.value.toUpperCase())}
                    />
                  </td>
                  <td>
                    <select value={p.tipologia} onChange={(e) => updateTipologiaORegime(p.id, "tipologia", e.target.value)}>
                      {TIPOLOGIE.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={p.regime_tariffario || "regolare"} onChange={(e) => updateTipologiaORegime(p.id, "regime_tariffario", e.target.value)}>
                      <option value="regolare">Regolare</option>
                      <option value="agevolata">Agevolata</option>
                    </select>
                  </td>
                  <td><input type="number" step="0.01" className="num" value={p.costo_unitario} onChange={(e) => updateLocal(p.id, "costo_unitario", e.target.value)} onBlur={(e) => persistField(p.id, "costo_unitario", parseFloat(e.target.value) || 0)} /></td>
                  <td><input type="number" className="num" value={p.soglia_fatturazione} onChange={(e) => updateLocal(p.id, "soglia_fatturazione", e.target.value)} onBlur={(e) => persistField(p.id, "soglia_fatturazione", parseInt(e.target.value) || 5)} /></td>
                  <td><input type="number" className="num" placeholder="def." value={p.giorni_stale_override || ""} onChange={(e) => updateLocal(p.id, "giorni_stale_override", e.target.value)} onBlur={(e) => persistField(p.id, "giorni_stale_override", parseInt(e.target.value) || null)} /></td>
                  <td><input type="date" value={p.ancora_data || ""} onChange={(e) => updateField(p.id, "ancora_data", e.target.value)} /></td>
                  <td><input type="number" className="num" value={p.ancora_valore} onChange={(e) => updateLocal(p.id, "ancora_valore", e.target.value)} onBlur={(e) => persistField(p.id, "ancora_valore", parseInt(e.target.value) || 0)} /></td>
                  <td>
                    <select value={p.stato} onChange={(e) => updateField(p.id, "stato", e.target.value)} title="In sospeso: continua a contare le sedute ma non segnala mai come pronto per la fattura">
                      <option value="attivo">Attivo</option>
                      <option value="sospeso">In sospeso</option>
                    </select>
                  </td>
                  <td>
                    <select value={p.modalita_pagamento} onChange={(e) => updateField(p.id, "modalita_pagamento", e.target.value)}>
                      <option>Bonifico</option><option>Contante</option><option>Paypal</option><option>Carta</option>
                    </select>
                  </td>
                  <td><button className="btn-icon" onClick={() => removePatient(p.id, p.fatturare_a || p.nome_calendario)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
