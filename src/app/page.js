"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import {
  computePatientState,
  buildInvoiceRow,
  COLUMN_ORDER,
  DEFAULT_SETTINGS,
  todayISO,
  daysBetween,
} from "@/lib/logic";

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

function sortPatients(list, computed, sort) {
  const arr = [...list];
  arr.sort((a, b) => {
    let va, vb;
    if (sort.key === "nome") {
      va = (a.fatturare_a || a.nome_calendario || "").toUpperCase();
      vb = (b.fatturare_a || b.nome_calendario || "").toUpperCase();
    } else if (sort.key === "tipologia") {
      va = a.tipologia || "";
      vb = b.tipologia || "";
    } else if (sort.key === "ultimaData") {
      va = computed[a.id]?.ultimaData || "";
      vb = computed[b.id]?.ultimaData || "";
    } else if (sort.key === "prossimaData") {
      va = computed[a.id]?.prossimaData || "";
      vb = computed[b.id]?.prossimaData || "";
    } else if (sort.key === "sedute") {
      va = computed[a.id]?.count || 0;
      vb = computed[b.id]?.count || 0;
    }
    if (va < vb) return sort.dir === "asc" ? -1 : 1;
    if (va > vb) return sort.dir === "asc" ? 1 : -1;
    return 0;
  });
  return arr;
}

export default function DashboardPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [pendingBatch, setPendingBatch] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventsMeta, setEventsMeta] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [selected, setSelected] = useState({});
  const [sortInCorso, setSortInCorso] = useState({ key: "nome", dir: "asc" });
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 120);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(todayISO());
  const [fromHour, setFromHour] = useState("");
  const [toHour, setToHour] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: s }, { data: pb }, { data: cc }] = await Promise.all([
      supabase.from("patients").select("*").order("id"),
      supabase.from("settings").select("*").maybeSingle(),
      supabase.from("pending_batch").select("*").maybeSingle(),
      supabase.from("calendar_cache").select("*").maybeSingle(),
    ]);
    setPatients(p || []);
    if (s) setSettings(s);
    setPendingBatch(pb || null);
    if (cc) {
      setEvents(cc.events || []);
      setEventsMeta({ from: cc.from_date, to: cc.to_date, fetchedAt: cc.fetched_at });
      setFromDate(cc.from_date);
      setToDate(cc.to_date);
      if (cc.from_hour) setFromHour(cc.from_hour);
      if (cc.to_hour) setToHour(cc.to_hour);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromDate, to: toDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore sconosciuto");
      let filtered = data.events;
      // Esclude gli eventi fuori dalla fascia oraria indicata (es. gli appuntamenti "in lista d'attesa"
      // segnati alle 7 del mattino). Gli eventi "tutto il giorno" (ora = null) passano sempre.
      if (fromHour || toHour) {
        const lo = fromHour || "00:00";
        const hi = toHour || "23:59";
        filtered = filtered.filter((e) => !e.ora || (e.ora >= lo && e.ora <= hi));
      }
      setEvents(filtered);
      const fetchedAt = new Date().toISOString();
      setEventsMeta({ from: fromDate, to: toDate, fetchedAt });
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("calendar_cache").upsert({
        user_id: userData.user.id,
        from_date: fromDate,
        to_date: toDate,
        from_hour: fromHour || null,
        to_hour: toHour || null,
        events: filtered,
        fetched_at: fetchedAt,
      });
    } catch (e) {
      setSyncError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  const computed = useMemo(() => {
    const map = {};
    patients.forEach((p) => {
      map[p.id] = computePatientState(p, events, settings);
    });
    return map;
  }, [patients, events, settings]);

  const groups = useMemo(() => {
    const g = { pronto: [], da_valutare: [], in_corso: [], senza_sedute: [], sospeso: [] };
    patients.forEach((p) => {
      const st = computed[p.id];
      if (st) g[st.stato].push(p);
    });
    return g;
  }, [patients, computed]);

  function toggleSelect(id) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function generateBatch(patientIds) {
    const dataFattura = todayISO();
    let fid = 1;
    const rows = patientIds.map((id) => {
      const p = patients.find((pp) => pp.id === id);
      const c = computed[id];
      return buildInvoiceRow(p, c, settings, dataFattura, fid++);
    });

    const exportRows = rows.map(({ _onorario, _count, ...r }) => r);
    const ws = XLSX.utils.json_to_sheet(exportRows, { header: COLUMN_ORDER });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Foglio1");
    XLSX.writeFile(wb, `import_fatture_${dataFattura}.xlsx`);

    const { data: userData } = await supabase.auth.getUser();
    const batch = {
      user_id: userData.user.id,
      data_fattura: dataFattura,
      rows,
      patient_ids: patientIds,
    };
    await supabase.from("pending_batch").upsert(batch);
    setPendingBatch(batch);
    setSelected({});
  }

  async function confirmBatch() {
    if (!pendingBatch) return;
    for (const id of pendingBatch.patient_ids) {
      const p = patients.find((pp) => pp.id === id);
      const c = computed[id];
      const lastDate = c.usati.length ? c.usati[c.usati.length - 1].data : c.ultimaData || pendingBatch.data_fattura;
      await supabase.from("patients").update({ ancora_data: lastDate, ancora_valore: 0 }).eq("id", id);
    }
    const histRows = pendingBatch.rows.map((r) => ({
      user_id: pendingBatch.user_id,
      patient_id: pendingBatch.patient_ids[pendingBatch.rows.indexOf(r)],
      data: pendingBatch.data_fattura,
      codice_fiscale: r.pazienteID,
      totale_sedute: r._count,
      onorario: r._onorario,
      note: r.fatturaNOTE,
    }));
    await supabase.from("invoice_history").insert(histRows);
    await supabase.from("pending_batch").delete().eq("user_id", pendingBatch.user_id);
    setPendingBatch(null);
    load();
  }

  async function cancelBatch() {
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("pending_batch").delete().eq("user_id", userData.user.id);
    setPendingBatch(null);
  }

  async function postponeReview(id, currentGiorniStale) {
    const input = window.prompt("Tra quanti giorni vuoi essere riavvisato per questo paziente?", "45");
    if (input === null) return;
    const extra = parseInt(input);
    if (!extra || extra <= 0) return;
    const c = computed[id];
    const giaTrascorsi = c.ultimaData ? daysBetween(c.ultimaData, todayISO()) : 0;
    const nuovaSoglia = giaTrascorsi + extra;
    await supabase.from("patients").update({ giorni_stale_override: nuovaSoglia }).eq("id", id);
    load();
  }

  async function forceClose(id) {
    await generateBatch([id]);
  }

  if (loading) return <div style={{ padding: 40 }}>Caricamento…</div>;

  const readyIds = groups.pronto.map((p) => p.id);
  const chosenIds = readyIds.filter((id) => selected[id] !== false);
  const disabled = !!pendingBatch;

  return (
    <div className="app-root">
      <Sidebar readyCount={groups.pronto.length} />
      <main className="main">
        {pendingBatch && (
          <div className="pending-banner">
            <div>
              <strong>File generato, in attesa di conferma.</strong> Hai scaricato l&apos;Excel con{" "}
              {pendingBatch.rows.length} {pendingBatch.rows.length === 1 ? "paziente" : "pazienti"} il{" "}
              {pendingBatch.data_fattura}. Caricalo su Psicogest (Strumenti → Importa fatture) e controlla che ENPAP,
              bollo e totale vengano completati come al solito; poi conferma qui sotto per azzerare il conteggio —
              solo dopo aver verificato che l&apos;import sia andato a buon fine.
            </div>
            <div className="pending-actions">
              <button className="btn btn-primary" onClick={confirmBatch}>
                Confermo, ho caricato su Psicogest
              </button>
              <button className="btn btn-ghost" onClick={cancelBatch}>
                Annulla, non ho ancora fatturato
              </button>
            </div>
          </div>
        )}

        <header className="view-header">
          <div>
            <h1>Da fatturare</h1>
            <p className="sub">Sedute contate dal calendario, confrontate con la soglia di ciascun paziente.</p>
          </div>
        </header>

        <div className="sync-bar">
          <label>
            Da
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label>
            A
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <label>
            Ora da <span className="muted small">(facoltativo)</span>
            <input type="time" value={fromHour} onChange={(e) => setFromHour(e.target.value)} />
          </label>
          <label>
            Ora a <span className="muted small">(facoltativo)</span>
            <input type="time" value={toHour} onChange={(e) => setToHour(e.target.value)} />
          </label>
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
            {syncing ? "Lettura in corso…" : "Aggiorna dal calendario"}
          </button>
          {eventsMeta && (
            <span className="muted small">ultima lettura {new Date(eventsMeta.fetchedAt).toLocaleString("it-IT")}</span>
          )}
        </div>
        {syncError && <div className="error-box">{syncError}</div>}

        <section className="section tone-ready">
          <div className="section-head">
            <h2>Pronti per la fattura ({groups.pronto.length})</h2>
          </div>
          <div className="section-body">
            {groups.pronto.length === 0 ? (
              <div className="empty-row">Nessun paziente ha ancora raggiunto la soglia.</div>
            ) : (
              <>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Paziente</th>
                      <th>Tipologia</th>
                      <th>Sedute</th>
                      <th>Ultima seduta</th>
                      <th>Importo stimato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.pronto.map((p) => {
                      const c = computed[p.id];
                      const importo = (p.costo_unitario * c.count).toFixed(2);
                      return (
                        <tr key={p.id}>
                          <td>
                            <input type="checkbox" checked={selected[p.id] !== false} onChange={() => toggleSelect(p.id)} />
                          </td>
                          <td>
                            <div className="name">{p.fatturare_a || p.nome_calendario}</div>
                            {!p.codice_fiscale && <div className="tag tag-danger">manca CF</div>}
                          </td>
                          <td className="mono">{p.tipologia}</td>
                          <td className="mono">{c.count} / {c.soglia}</td>
                          <td className="mono">{c.ultimaData || "—"}</td>
                          <td className="mono">€ {importo}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="row-actions">
                  <button
                    className="btn btn-primary"
                    disabled={
                      disabled ||
                      chosenIds.filter((id) => groups.pronto.find((p) => p.id === id)?.codice_fiscale).length === 0
                    }
                    onClick={() =>
                      generateBatch(chosenIds.filter((id) => groups.pronto.find((p) => p.id === id)?.codice_fiscale))
                    }
                  >
                    Genera file Excel per i selezionati
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="section tone-warn">
          <div className="section-head">
            <h2>Da valutare — nessuna seduta da oltre {settings.giorni_stale} giorni ({groups.da_valutare.length})</h2>
          </div>
          <div className="section-body">
            {groups.da_valutare.length === 0 ? (
              <div className="empty-row">Nessun conteggio sospeso da valutare.</div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Paziente</th>
                    <th>Sedute</th>
                    <th>Ultima seduta</th>
                    <th>Giorni fermo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {groups.da_valutare.map((p) => {
                    const c = computed[p.id];
                    return (
                      <tr key={p.id}>
                        <td className="name">{p.fatturare_a || p.nome_calendario}</td>
                        <td className="mono">{c.count} / {c.soglia}</td>
                        <td className="mono">{c.ultimaData}</td>
                        <td className="mono">{daysBetween(c.ultimaData, todayISO())}</td>
                        <td>
                          <button className="btn btn-small" disabled={disabled || !p.codice_fiscale} onClick={() => forceClose(p.id)}>
                            Chiudi e fattura ora
                          </button>{" "}
                          <button className="btn btn-small btn-ghost" disabled={disabled} onClick={() => postponeReview(p.id, p.giorni_stale_override)}>
                            Posticipa
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>In sospeso — fatturazione non automatica ({groups.sospeso.length})</h2>
          </div>
          <div className="section-body">
            {groups.sospeso.length === 0 ? (
              <div className="empty-row">Nessun paziente in sospeso.</div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Paziente</th>
                    <th>Sedute accumulate</th>
                    <th>Ultima seduta</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {groups.sospeso.map((p) => {
                    const c = computed[p.id];
                    return (
                      <tr key={p.id}>
                        <td className="name">{p.fatturare_a || p.nome_calendario}</td>
                        <td className="mono">{c.count}</td>
                        <td className="mono">{c.ultimaData}</td>
                        <td>
                          <button className="btn btn-small" disabled={disabled || !p.codice_fiscale} onClick={() => forceClose(p.id)}>
                            Fattura ora
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>In corso ({groups.in_corso.length})</h2>
          </div>
          <div className="section-body">
            <table className="tbl">
              <thead>
                <tr>
                  <SortableTh label="Paziente" sortKey="nome" sort={sortInCorso} setSort={setSortInCorso} />
                  <SortableTh label="Tipologia" sortKey="tipologia" sort={sortInCorso} setSort={setSortInCorso} />
                  <SortableTh label="Sedute" sortKey="sedute" sort={sortInCorso} setSort={setSortInCorso} />
                  <SortableTh label="Ultima seduta" sortKey="ultimaData" sort={sortInCorso} setSort={setSortInCorso} />
                  <SortableTh label="Prossima seduta" sortKey="prossimaData" sort={sortInCorso} setSort={setSortInCorso} />
                </tr>
              </thead>
              <tbody>
                {sortPatients(groups.in_corso, computed, sortInCorso).map((p) => {
                  const c = computed[p.id];
                  return (
                    <tr key={p.id}>
                      <td className="name">{p.fatturare_a || p.nome_calendario}</td>
                      <td className="mono">{p.tipologia}</td>
                      <td className="mono">{c.count} / {c.soglia}</td>
                      <td className="mono">{c.ultimaData || "—"}</td>
                      <td className="mono">{c.prossimaData || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
