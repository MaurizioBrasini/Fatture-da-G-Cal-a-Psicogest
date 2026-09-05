"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import Modal from "@/components/Modal";
import SortableTh from "@/components/SortableTh";
import { normalizeName, todayISO, tariffaStandard, DEFAULT_SETTINGS } from "@/lib/logic";

const TIPOLOGIE = [
  { value: "individuale", label: "Individuale" },
  { value: "coppia", label: "Coppia" },
  { value: "consulenza", label: "Consulenza" },
];
const TIPOLOGIA_LABEL = { individuale: "Individuale", coppia: "Coppia", consulenza: "Consulenza" };
const TIPOLOGIA_FROM_LABEL = { INDIVIDUALE: "individuale", COPPIA: "coppia", CONSULENZA: "consulenza" };

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

  // --- Rinumerazione calendario (R/A/S + numero) ---
  const [renumStep, setRenumStep] = useState(null); // null | 'loading' | 'preview' | 'writing' | 'done' | 'error'
  const [renumTarget, setRenumTarget] = useState(null); // id paziente, o null = tutti
  const [renumGiorni, setRenumGiorni] = useState(90);
  const [renumData, setRenumData] = useState(null); // array [{pazienteId, nome, piano:[...]}]
  const [renumWriteResult, setRenumWriteResult] = useState(null);
  const [renumError, setRenumError] = useState("");
  const [renumProgress, setRenumProgress] = useState(null); // { fatti, totale } durante la scrittura

  // Dimensione dei blocchi di scrittura: mantiene ogni chiamata alla route
  // di conferma ben al di sotto dei limiti di durata delle funzioni
  // serverless di Vercel, ed è anche ciò che permette una barra di
  // avanzamento reale (altrimenti l'intero batch sarebbe una singola
  // chiamata "tutto o niente").
  const RENUM_CHUNK_SIZE = 15;

  // --- Storico fatture per paziente (contesto per correggere Ancora a mano) ---
  const [storicoPaziente, setStoricoPaziente] = useState(null); // { nome, rows } | null
  const [storicoLoading, setStoricoLoading] = useState(false);

  async function apriStorico(patient) {
    setStoricoLoading(true);
    setStoricoPaziente({ nome: patient.fatturare_a || patient.nome_calendario, rows: [] });
    const { data } = await supabase
      .from("invoice_history")
      .select("*")
      .eq("patient_id", patient.id)
      .order("data", { ascending: false });
    setStoricoPaziente({ nome: patient.fatturare_a || patient.nome_calendario, rows: data || [] });
    setStoricoLoading(false);
  }

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

    // Scrive a blocchi invece che in un'unica chiamata: evita di superare i
    // limiti di durata delle funzioni serverless su batch grandi (es.
    // "Rinumera tutti" con molti pazienti) e permette di mostrare
    // l'avanzamento reale invece di un'attesa cieca.
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

  // Le quattro funzioni sotto erano prima ciascuna la propria copia di
  // "aggiorna lo stato locale" / "salva su Supabase" — ora condividono le
  // stesse due funzioni di base (patchLocal / persistPatch) e si limitano a
  // decidere QUALI campi cambiano.
  function patchLocal(id, patch) {
    setPatients((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function persistPatch(id, patch) {
    await supabase.from("patients").update(patch).eq("id", id);
  }

  function updateLocal(id, field, value) {
    patchLocal(id, { [field]: value });
  }

  async function persistField(id, field, value) {
    await persistPatch(id, { [field]: value });
  }

  async function updateField(id, field, value) {
    const patch = { [field]: value };
    patchLocal(id, patch);
    await persistPatch(id, patch);
  }

  async function updateTipologiaORegime(id, field, value) {
    const p = patients.find((pp) => pp.id === id);
    const nextTipologia = field === "tipologia" ? value : p.tipologia;
    const nextRegime = field === "regime_tariffario" ? value : p.regime_tariffario;
    const patch = { [field]: value, costo_unitario: tariffaStandard(nextTipologia, nextRegime, settings) };
    patchLocal(id, patch);
    await persistPatch(id, patch);
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
            <button className="btn btn-ghost" onClick={() => apriRinumerazione(null)}>Rinumera tutti (calendario)</button>
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
                  <td>
                    <button className="btn-icon" title="Aggiorna numerazione calendario" onClick={() => apriRinumerazione(p.id)}>↻</button>
                    <button className="btn-icon" title="Storico fatture di questo paziente" onClick={() => apriStorico(p)}>§</button>
                    <button className="btn-icon" onClick={() => removePatient(p.id, p.fatturare_a || p.nome_calendario)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {renumStep && (
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
      )}

      {storicoPaziente && (
        <Modal maxWidth={560}>
          <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>
            Storico fatture — {storicoPaziente.nome}
          </h2>
          {storicoLoading ? (
            <p>Caricamento…</p>
          ) : storicoPaziente.rows.length === 0 ? (
            <p className="muted">Nessuna fattura confermata per questo paziente.</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>Data</th><th>Sedute</th><th>Onorario</th><th>Note</th></tr>
              </thead>
              <tbody>
                {storicoPaziente.rows.map((h) => (
                  <tr key={h.id}>
                    <td className="mono">{h.data}</td>
                    <td className="mono">{h.totale_sedute}</td>
                    <td className="mono">€ {h.onorario}</td>
                    <td>{h.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setStoricoPaziente(null)}>Chiudi</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
