"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import Modal from "@/components/Modal";
import SortableTh from "@/components/SortableTh";
import {
  computePatientState,
  buildInvoiceRow,
  COLUMN_ORDER,
  DEFAULT_SETTINGS,
  todayISO,
  daysBetween,
  addDays,
  accumulaContante,
  matchPatientForEvent,
  BOOKING_COLOR_ID,
} from "@/lib/logic";
import { rinumeraPazienteSilenzioso } from "@/lib/renumerazioneClient";
import { leggiRoutine, segnaRoutine } from "@/lib/routineChecklist";

function sortPatients(list, computed, sort) {
  const arr = [...list];
  arr.sort((a, b) => {
    let va, vb;
    if (sort.key === "nome") {
      va = (a.nome_calendario || a.fatturare_a || "").toUpperCase();
      vb = (b.nome_calendario || b.fatturare_a || "").toUpperCase();
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
  const [fromDate, setFromDate] = useState(() => addDays(todayISO(), -120));
  const [toDate, setToDate] = useState(todayISO());
  const [fromHour, setFromHour] = useState("");
  const [toHour, setToHour] = useState("");
  const [cancellazioni, setCancellazioni] = useState([]);

  // --- Routine di fine giornata (checklist persistita per oggi) ---
  const [routine, setRoutine] = useState(() => leggiRoutine(todayISO()));
  useEffect(() => {
    setRoutine(leggiRoutine(todayISO()));
  }, []);
  function segna(step, valore = true) {
    setRoutine(segnaRoutine(todayISO(), step, valore));
  }

  // --- Modale numero fattura (sostituisce window.prompt) ---
  const [numeroModal, setNumeroModal] = useState(null); // null | { patientIds, value }

  // --- Modale "Registra disdette" (nota "disdetto" -> cancellations) ---
  const [aggStep, setAggStep] = useState(null); // null | 'loading' | 'preview' | 'writing' | 'done' | 'error'
  const [aggCandidati, setAggCandidati] = useState(null);
  const [aggEsclusi, setAggEsclusi] = useState({}); // { eventId: true } = deselezionato in anteprima
  const [aggRisultato, setAggRisultato] = useState(null);
  const [aggErrore, setAggErrore] = useState("");
  // Form "Aggiungi disdetta manuale": per un evento già eliminato a mano da
  // Google Calendar (mai passato dalla scansione delle note "disdetto").
  // Sempre "non addebitata" — vedi commento su aggiungiDisdettaManuale.
  const [manPatientId, setManPatientId] = useState("");
  const [manData, setManData] = useState("");

  // --- Modale "Prenotazioni online da riconciliare" ---
  const [prenStep, setPrenStep] = useState(null); // null | 'loading' | 'preview' | 'writing' | 'done' | 'error'
  const [prenData, setPrenData] = useState(null); // { pronte, inAttesa, ambigue, nuove }
  // { eventId: "" | "<patientId>" | "__new__" } — un unico select per riga
  // decide sia il paziente sia se trattarla come nuovo paziente; "" =
  // ancora non decisa, saltata alla conferma (sostituisce la spunta).
  const [prenScelte, setPrenScelte] = useState({});
  const [prenRisultato, setPrenRisultato] = useState(null);
  const [prenErrore, setPrenErrore] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: s }, { data: pb }, { data: cc }, { data: canc }] = await Promise.all([
      supabase.from("patients").select("*").order("id"),
      supabase.from("settings").select("*").maybeSingle(),
      supabase.from("pending_batch").select("*").maybeSingle(),
      supabase.from("calendar_cache").select("*").maybeSingle(),
      supabase.from("cancellations").select("patient_id, original_date, billing_status"),
    ]);
    setPatients(p || []);
    if (s) setSettings(s);
    setPendingBatch(pb || null);
    setCancellazioni(canc || []);
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
      segna("sync");
    } catch (e) {
      setSyncError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  // Trova l'evento reale (id + colorId) della prossima seduta pianificata di
  // un paziente, per il bottone confermato/da confermare — stessa logica di
  // abbinamento già usata da computePatientState, ma serve l'oggetto evento
  // intero (non solo la data) per poterlo modificare su Google Calendar.
  // Abbinamento sull'intera lista pazienti (non un array con il solo
  // paziente): matchPatientForEvent usa il confronto con TUTTI i pazienti
  // per scartare i match "deboli" ambigui (es. due pazienti che condividono
  // lo stesso nome di battesimo) — passare qui un singolo paziente
  // disattiverebbe quella disambiguazione e rischierebbe di abbinare
  // l'evento di un altro paziente.
  function prossimoEvento(patient, prossimaData) {
    if (!prossimaData) return null;
    return (
      events.find((e) => e.data === prossimaData && matchPatientForEvent(e.titolo, patients)?.patient.id === patient.id) ||
      null
    );
  }

  async function toggleConferma(eventId, eraConfermato) {
    const nuovoConfermato = !eraConfermato;
    const nuoviEventi = events.map((e) => (e.id === eventId ? { ...e, colorId: nuovoConfermato ? null : "6" } : e));
    setEvents(nuoviEventi);
    try {
      const res = await fetch("/api/calendar/toggle-conferma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, confermato: nuovoConfermato }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore sconosciuto");
      // Aggiorna anche la cache persistita (calendar_cache): altrimenti, senza
      // un nuovo "Sync", ricaricando la pagina lo stato confermato/da
      // confermare tornerebbe quello vecchio letto dalla cache.
      if (eventsMeta) {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
          await supabase.from("calendar_cache").upsert({
            user_id: userData.user.id,
            from_date: eventsMeta.from,
            to_date: eventsMeta.to,
            from_hour: fromHour || null,
            to_hour: toHour || null,
            events: nuoviEventi,
            fetched_at: eventsMeta.fetchedAt,
          });
        }
      }
    } catch (e) {
      // rollback ottimistico se la scrittura su Google Calendar fallisce
      setEvents((prev) => prev.map((ev) => (ev.id === eventId ? { ...ev, colorId: eraConfermato ? null : "6" } : ev)));
      alert("Errore nel cambiare lo stato dell'appuntamento: " + e.message);
    }
  }

  const computed = useMemo(() => {
    const map = {};
    patients.forEach((p) => {
      map[p.id] = computePatientState(p, events, settings, cancellazioni, patients);
    });
    return map;
  }, [patients, events, settings, cancellazioni]);

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

  function generateBatch(patientIds) {
    if (!patientIds.length) return;
    const suggerito = settings.ultimo_numero_fattura ? String(settings.ultimo_numero_fattura) : "";
    setNumeroModal({ patientIds, value: suggerito });
  }

  async function confermaNumeroModal() {
    const { patientIds, value } = numeroModal;
    const numeroPartenza = parseInt(value, 10);
    if (!numeroPartenza || numeroPartenza < 1) return;
    setNumeroModal(null);
    await eseguiGenerazioneBatch(patientIds, numeroPartenza);
  }

  async function eseguiGenerazioneBatch(patientIds, numeroPartenza) {
    const dataFattura = todayISO();
    let fid = 1;
    let numero = numeroPartenza;
    const rows = patientIds.map((id) => {
      const p = patients.find((pp) => pp.id === id);
      const c = computed[id];
      return buildInvoiceRow(p, c, settings, dataFattura, fid++, numero++);
    });

    const exportRows = rows.map(({ _onorario, _count, _tariffa, ...r }) => r);
    const ws = XLSX.utils.json_to_sheet(exportRows, { header: COLUMN_ORDER });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Foglio1");
    // Psicogest accetta solo .xls dal selettore file (il test con .xlsx è
    // stato scartato: l'interfaccia stessa lo rifiuta).
    XLSX.writeFile(wb, `import_fatture_${dataFattura}.xls`, { bookType: "xls" });

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
    const pazientiConContanteAggiornato = [];
    for (const id of pendingBatch.patient_ids) {
      const p = patients.find((pp) => pp.id === id);
      const c = computed[id];
      const lastDate = c.usati.length ? c.usati[c.usati.length - 1].data : c.ultimaData || pendingBatch.data_fattura;
      // L'ancora deve puntare al primo giorno NON ancora fatturato (confronto
      // >= in computePatientState), quindi il giorno dopo l'ultima seduta
      // inclusa in questa fattura — non la data della seduta stessa, altrimenti
      // verrebbe ricontata al giro successivo.
      const nuovaAncora = addDays(lastDate, 1);
      const patch = { ancora_data: nuovaAncora, ancora_valore: 0 };
      if (p.quota_contante_seduta > 0) {
        const row = pendingBatch.rows[pendingBatch.patient_ids.indexOf(id)];
        patch.contante_dovuto = accumulaContante(p.contante_dovuto, p.quota_contante_seduta, row._count);
        pazientiConContanteAggiornato.push(id);
      }
      await supabase.from("patients").update(patch).eq("id", id);
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

    // Ricorda il numero successivo suggerito per il prossimo batch, in base
    // al più alto fatturaNUMERO effettivamente usato in questo giro.
    const numeriUsati = pendingBatch.rows.map((r) => Number(r.fatturaNUMERO)).filter((n) => !isNaN(n) && n > 0);
    if (numeriUsati.length) {
      const prossimoNumero = Math.max(...numeriUsati) + 1;
      await supabase
        .from("settings")
        .update({ ultimo_numero_fattura: prossimoNumero })
        .eq("user_id", pendingBatch.user_id);
      setSettings((prev) => ({ ...prev, ultimo_numero_fattura: prossimoNumero }));
    }

    setPendingBatch(null);
    load();

    // Aggiorna subito la nota calendario dei pazienti il cui saldo contanti è
    // cambiato, così il tag "(deve X€)" è già corretto senza dover premere
    // "Rinumera" a mano. Se fallisce non blocca nulla: la fattura è già
    // confermata e resta valida comunque.
    for (const id of pazientiConContanteAggiornato) {
      rinumeraPazienteSilenzioso(id).catch((e) => console.error("Rinumerazione automatica fallita:", e));
    }
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

  // --- Registra disdette (nota "disdetto" -> cancellations, preview+conferma) ---
  async function apriRegistraDisdette() {
    setAggStep("loading");
    setAggErrore("");
    setAggEsclusi({});
    setAggRisultato(null);
    try {
      const res = await fetch("/api/calendar/aggiorna-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setAggErrore(data.error || "Errore nel calcolo dell'anteprima.");
        setAggStep("error");
        return;
      }
      setAggCandidati(data.candidati || []);
      setAggStep("preview");
      // Se non c'è nulla da registrare, il passaggio è comunque "fatto":
      // l'utente ha controllato, non c'era nessuna disdetta da gestire oggi.
      if (!data.candidati?.length) segna("disdette");
    } catch (e) {
      setAggErrore(e.message);
      setAggStep("error");
    }
  }

  async function confermaRegistraDisdette() {
    const daConfermare = (aggCandidati || []).filter((c) => !aggEsclusi[c.eventId]);
    if (!daConfermare.length) return;
    setAggStep("writing");
    try {
      const res = await fetch("/api/calendar/aggiorna-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidati: daConfermare }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAggErrore(data.error || "Errore durante la registrazione.");
        setAggStep("error");
        return;
      }
      setAggRisultato(data);
      setAggStep("done");
      segna("disdette");
      load();
    } catch (e) {
      setAggErrore(e.message);
      setAggStep("error");
    }
  }

  function chiudiRegistraDisdette() {
    setAggStep(null);
    setAggCandidati(null);
    setAggEsclusi({});
    setAggRisultato(null);
    setAggErrore("");
    setManPatientId("");
    setManData("");
  }

  // Sovrascrive l'esito automatico (regola delle 48h) calcolato in anteprima
  // per una riga già trovata dalla scansione — es. un ricovero senza
  // preavviso che comunque non va addebitato.
  function cambiaEsitoDisdetta(eventId, nuovoBilling) {
    setAggCandidati((prev) => (prev || []).map((c) => (c.eventId === eventId ? { ...c, billingStatus: nuovoBilling } : c)));
  }

  // Aggiunge a mano una disdetta NON ADDEBITATA il cui evento è già stato
  // eliminato dall'utente direttamente su Google Calendar (non più
  // trovabile dalla scansione, che legge gli eventi live). Nessun evento da
  // cancellare al momento della conferma (`manual: true`), solo la riga in
  // `cancellations`.
  //
  // Solo "non addebitata" ha senso qui: il conteggio/numerazione (Rinumera)
  // legge SEMPRE gli eventi live da calendario, non la tabella
  // `cancellations` — una seduta "addebitata" (buca da pagare) deve restare
  // fisicamente sul calendario o sparirà dalla numerazione anche se questa
  // riga dice che va pagata. Se un evento da addebitare è già stato
  // cancellato per errore, va ricreato sul calendario prima di Rinumera,
  // altrimenti quella seduta non verrà contata.
  function aggiungiDisdettaManuale() {
    if (!manPatientId || !manData) return;
    const patient = patients.find((p) => String(p.id) === manPatientId);
    if (!patient) return;
    const giaPresente = (aggCandidati || []).some((c) => c.patientId === patient.id && c.data === manData);
    if (giaPresente) {
      setAggErrore("C'è già una riga per questo paziente in questa data.");
      return;
    }
    const nuova = {
      eventId: `manual-${patient.id}-${manData}-${Date.now()}`,
      patientId: patient.id,
      nome: patient.nome_calendario || patient.fatturare_a,
      data: manData,
      ora: "",
      cancelledAt: new Date().toISOString(),
      billingStatus: "not_charged",
      manual: true,
    };
    setAggCandidati((prev) => [...(prev || []), nuova].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0)));
    setAggErrore("");
    setManPatientId("");
    setManData("");
  }

  // --- Prenotazioni online (link "Prenotazioni online dr. Brasini") ---
  async function apriPrenotazioni() {
    setPrenStep("loading");
    setPrenErrore("");
    setPrenScelte({});
    setPrenRisultato(null);
    try {
      const res = await fetch("/api/calendar/prenotazioni-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setPrenErrore(data.error || "Errore nel calcolo dell'anteprima.");
        setPrenStep("error");
        return;
      }
      setPrenData(data);
      setPrenStep("preview");
    } catch (e) {
      setPrenErrore(e.message);
      setPrenStep("error");
    }
  }

  function chiudiPrenotazioni() {
    setPrenStep(null);
    setPrenData(null);
    setPrenScelte({});
    setPrenRisultato(null);
    setPrenErrore("");
  }

  function capitalizzaParola(w) {
    return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w;
  }

  // Scelta di default per il select di una riga "da gestire": il paziente
  // proposto se c'è (forte/debole), "__new__" se non c'è nessun candidato
  // (nessuna ambiguità: è chiaramente nuovo), altrimenti vuota — un
  // ambiguo richiede sempre una scelta attiva, mai indovinata.
  function prenScelteDefault(r) {
    if (r.patientId) return String(r.patientId);
    if (r.confidence !== "ambiguo") return "__new__";
    return "";
  }

  async function confermaPrenotazioni() {
    const tutte = [...(prenData?.pronte || []), ...(prenData?.ambigue || []), ...(prenData?.nuove || [])];
    const selezionate = tutte
      .map((r) => ({ r, scelta: prenScelte[r.eventId] ?? prenScelteDefault(r) }))
      .filter((x) => x.scelta);

    const abbinamenti = selezionate
      .filter((x) => x.scelta !== "__new__")
      .map((x) => ({ eventId: x.r.eventId, patientId: Number(x.scelta), bookerEmail: x.r.bookerEmail }));
    const nuovi = selezionate.filter((x) => x.scelta === "__new__").map((x) => x.r);

    if (!abbinamenti.length && !nuovi.length) return;
    setPrenStep("writing");
    try {
      const { data: userData } = await supabase.auth.getUser();
      for (const r of nuovi) {
        const parti = (r.bookerNome || "").trim().split(/\s+/).filter(Boolean).map(capitalizzaParola);
        const { error } = await supabase.from("patients").insert({
          user_id: userData.user.id,
          nome: parti[0] || "",
          cognome: parti.slice(1).join(" "),
          email: r.bookerEmail || "",
        });
        if (error) throw new Error("Errore nell'aggiungere " + r.bookerNome + ": " + error.message);
      }

      let esito = { riconnessi: 0, rinumerati: 0, falliti: 0 };
      if (abbinamenti.length) {
        const res = await fetch("/api/calendar/prenotazioni-confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ abbinamenti }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Errore durante la riconnessione.");
        esito = data;
      }

      setPrenRisultato({ ...esito, nuovi: nuovi.length });
      setPrenStep("done");
      load();
    } catch (e) {
      setPrenErrore(e.message);
      setPrenStep("error");
    }
  }

  if (loading) return <div style={{ padding: 40 }}>Caricamento…</div>;

  const readyIds = groups.pronto.map((p) => p.id);
  const chosenIds = readyIds.filter((id) => selected[id] !== false);
  const disabled = !!pendingBatch;

  return (
    <div className="app-root">
      <Sidebar readyCount={groups.pronto.length} />
      <main className="main">
        <div className="section" style={{ padding: "14px 18px", marginBottom: 18 }}>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: 15.5, fontWeight: 500, margin: "0 0 12px" }}>
            Routine di fine giornata
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="checkbox" checked={!!routine.disdette} onChange={() => segna("disdette", !routine.disdette)} />
              <span className="small" style={{ flex: 1, textDecoration: routine.disdette ? "line-through" : "none", color: routine.disdette ? "var(--ink-soft)" : "var(--ink)" }}>
                1. Registra disdette
              </span>
              <button className="btn-small" onClick={apriRegistraDisdette}>Apri</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="checkbox" checked={!!routine.sync} onChange={() => segna("sync", !routine.sync)} />
              <span className="small" style={{ flex: 1, textDecoration: routine.sync ? "line-through" : "none", color: routine.sync ? "var(--ink-soft)" : "var(--ink)" }}>
                2. Aggiorna dal calendario
              </span>
              <button className="btn-small" onClick={handleSync} disabled={syncing}>
                {syncing ? "Lettura…" : "Fai ora"}
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="checkbox" checked={!!routine.rinumera} onChange={() => segna("rinumera", !routine.rinumera)} />
              <span className="small" style={{ flex: 1, textDecoration: routine.rinumera ? "line-through" : "none", color: routine.rinumera ? "var(--ink-soft)" : "var(--ink)" }}>
                3. Rinumera tutti (pagina Pazienti)
              </span>
              <Link href="/pazienti" className="btn-small" style={{ textDecoration: "none", display: "inline-block" }}>
                Vai a Pazienti
              </Link>
            </div>
          </div>
          {groups.pronto.length > 0 && (
            <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
              + {groups.pronto.length} {groups.pronto.length === 1 ? "paziente pronto" : "pazienti pronti"} per la fattura qui sotto.
            </p>
          )}
        </div>

        <div className="section" style={{ padding: "14px 18px", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <h2 style={{ fontFamily: "Georgia, serif", fontSize: 15.5, fontWeight: 500, margin: 0 }}>
                Prenotazioni online da riconciliare
              </h2>
              <p className="muted small" style={{ margin: "4px 0 0" }}>
                Appuntamenti presi dal link &quot;Prenotazioni online dr. Brasini&quot; (colore vinaccia) — supervisioni/
                consulenze estemporanee, disdette riprenotate, primi colloqui.
              </p>
            </div>
            <button className="btn-small" onClick={apriPrenotazioni}>Controlla</button>
          </div>
        </div>

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
          <div className="header-actions">
            <button className="btn btn-primary" onClick={apriRegistraDisdette}>
              Registra disdette
            </button>
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
                            <div className="name">{p.nome_calendario || p.fatturare_a}</div>
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
                        <td className="name">{p.nome_calendario || p.fatturare_a}</td>
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
                        <td className="name">{p.nome_calendario || p.fatturare_a}</td>
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
                  const evProssimo = prossimoEvento(p, c.prossimaData);
                  const confermato = !!evProssimo && !evProssimo.colorId;
                  return (
                    <tr key={p.id}>
                      <td className="name">{p.nome_calendario || p.fatturare_a}</td>
                      <td className="mono">{p.tipologia}</td>
                      <td className="mono">{c.count} / {c.soglia}</td>
                      <td className="mono">{c.ultimaData || "—"}</td>
                      <td className="mono">
                        {c.prossimaData || "—"}
                        {evProssimo && evProssimo.colorId === BOOKING_COLOR_ID ? (
                          <span
                            className="muted small"
                            title="Prenotato online — colore vinaccia riservato, non toccato dal bottone confermato/da confermare"
                            style={{ marginLeft: 8 }}
                          >
                            prenotato online
                          </span>
                        ) : (
                          evProssimo && (
                            <button
                              type="button"
                              onClick={() => toggleConferma(evProssimo.id, confermato)}
                              title={confermato ? "Confermato — clicca per segnare da confermare" : "Da confermare — clicca per confermare"}
                              style={{
                                marginLeft: 8,
                                border: "none",
                                borderRadius: 4,
                                padding: "2px 6px",
                                fontSize: 11,
                                cursor: "pointer",
                                color: "#fff",
                                background: confermato ? "#4285f4" : "#e67c00",
                              }}
                            >
                              {confermato ? "confermato" : "da confermare"}
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {numeroModal && (
        <Modal maxWidth={420}>
          <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>Numero fattura</h2>
          <p className="muted small">
            Numero della prima fattura di questo gruppo ({numeroModal.patientIds.length}{" "}
            {numeroModal.patientIds.length === 1 ? "paziente" : "pazienti"}). Verifica che corrisponda a quello
            suggerito da Psicogest prima di confermare.
          </p>
          <input
            type="number"
            className="num"
            autoFocus
            style={{ width: "100%", boxSizing: "border-box", marginTop: 8 }}
            value={numeroModal.value}
            onChange={(e) => setNumeroModal((m) => ({ ...m, value: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") confermaNumeroModal();
              if (e.key === "Escape") setNumeroModal(null);
            }}
          />
          {settings.ultimo_numero_fattura &&
            parseInt(numeroModal.value, 10) > 0 &&
            parseInt(numeroModal.value, 10) < settings.ultimo_numero_fattura && (
              <p style={{ color: "crimson", fontSize: 13, marginBottom: 0 }}>
                Attenzione: è più basso dell&apos;ultimo numero usato ({settings.ultimo_numero_fattura}) — potrebbe
                essere un doppione.
              </p>
            )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setNumeroModal(null)}>Annulla</button>
            <button
              className="btn btn-primary"
              disabled={!numeroModal.value || parseInt(numeroModal.value, 10) < 1}
              onClick={confermaNumeroModal}
            >
              Conferma e genera Excel
            </button>
          </div>
        </Modal>
      )}

      {aggStep && (
        <Modal maxWidth={640}>
          <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>Registra disdette</h2>

          {aggStep === "loading" && <p>Ricerca delle note &quot;disdetto&quot; in corso…</p>}

          {aggStep === "error" && (
            <>
              <p style={{ color: "crimson" }}>{aggErrore}</p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn btn-ghost" onClick={chiudiRegistraDisdette}>Chiudi</button>
              </div>
            </>
          )}

          {aggStep === "preview" && (
            <>
              {aggErrore && <p style={{ color: "crimson" }}>{aggErrore}</p>}
              {(!aggCandidati || aggCandidati.length === 0) ? (
                <p className="muted">Nessuna disdetta nuova trovata dalla scansione delle note.</p>
              ) : (
                <>
                  <p className="muted small">
                    L&apos;esito (addebitata/non addebitata) è calcolato dalla regola delle 48h di preavviso, ma è
                    <strong> modificabile riga per riga</strong> prima di confermare. <strong>Non addebitata</strong>{" "}
                    rimuove l&apos;evento dal calendario per liberare lo slot e non conta la seduta;{" "}
                    <strong>addebitata</strong> (buca) lascia l&apos;evento invariato e conta la seduta. Deseleziona
                    una riga per lasciarla da gestire a mano.
                  </p>
                  <table style={{ width: "100%", fontSize: 13, marginTop: 8 }}>
                    <thead>
                      <tr>
                        <th></th>
                        <th style={{ textAlign: "left" }}>Data</th>
                        <th style={{ textAlign: "left" }}>Paziente</th>
                        <th style={{ textAlign: "left" }}>Esito</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aggCandidati.map((c) => (
                        <tr key={c.eventId}>
                          <td>
                            <input
                              type="checkbox"
                              checked={!aggEsclusi[c.eventId]}
                              onChange={() =>
                                setAggEsclusi((prev) => ({ ...prev, [c.eventId]: !prev[c.eventId] }))
                              }
                            />
                          </td>
                          <td className="mono" style={{ whiteSpace: "nowrap" }}>
                            {c.data}{c.ora ? ` ${c.ora}` : ""}
                          </td>
                          <td>
                            {c.nome}
                            {c.manual && <span className="muted small"> (manuale, evento già eliminato)</span>}
                          </td>
                          <td>
                            {c.manual ? (
                              <span>Non addebitata</span>
                            ) : (
                              <select value={c.billingStatus} onChange={(e) => cambiaEsitoDisdetta(c.eventId, e.target.value)}>
                                <option value="not_charged">Non addebitata — rimuove l&apos;evento</option>
                                <option value="charged">Addebitata (buca) — evento invariato</option>
                              </select>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <div style={{ marginTop: 16, padding: 10, border: "1px solid var(--border)", borderRadius: 8 }}>
                <p className="muted small" style={{ marginTop: 0 }}>
                  Aggiungi disdetta <strong>non addebitata</strong> manuale — solo per un appuntamento già eliminato
                  a mano da Google Calendar (la scansione delle note non può più trovarlo). Serve solo a registrare
                  che quella seduta non va pagata: il conteggio/numerazione non dipende da questa tabella.
                  <br />
                  <strong>Attenzione</strong>: se invece un appuntamento da <em>addebitare</em> (una buca da pagare)
                  è stato cancellato per errore da calendario, non aggiungerlo qui — ricrea l&apos;evento sul
                  calendario a quella data/ora prima di lanciare &quot;Rinumera&quot;, altrimenti quella seduta
                  sparisce dalla numerazione e dal conteggio della fattura.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <select value={manPatientId} onChange={(e) => setManPatientId(e.target.value)} style={{ minWidth: 180 }}>
                    <option value="">Paziente…</option>
                    {[...patients]
                      .sort((a, b) => (a.nome_calendario || "").localeCompare(b.nome_calendario || ""))
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.nome_calendario || p.fatturare_a}</option>
                      ))}
                  </select>
                  <input type="date" value={manData} onChange={(e) => setManData(e.target.value)} />
                  <button className="btn-small" onClick={aggiungiDisdettaManuale} disabled={!manPatientId || !manData}>
                    Aggiungi (non addebitata)
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                <button className="btn btn-ghost" onClick={chiudiRegistraDisdette}>Annulla</button>
                {aggCandidati && aggCandidati.filter((c) => !aggEsclusi[c.eventId]).length > 0 && (
                  <button className="btn btn-primary" onClick={confermaRegistraDisdette}>
                    Conferma e registra
                  </button>
                )}
              </div>
            </>
          )}

          {aggStep === "writing" && <p>Registrazione in corso…</p>}

          {aggStep === "done" && aggRisultato && (
            <>
              <p>
                {aggRisultato.ok
                  ? `Fatto: ${aggRisultato.registrati} disdette registrate.`
                  : `${aggRisultato.registrati} registrate, ${aggRisultato.falliti} fallite.`}
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn btn-primary" onClick={chiudiRegistraDisdette}>Chiudi</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {prenStep && (
        <Modal maxWidth={760}>
          <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>Prenotazioni online da riconciliare</h2>

          {prenStep === "loading" && <p>Ricerca delle prenotazioni online in corso…</p>}

          {prenStep === "error" && (
            <>
              <p style={{ color: "crimson" }}>{prenErrore}</p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn btn-ghost" onClick={chiudiPrenotazioni}>Chiudi</button>
              </div>
            </>
          )}

          {prenStep === "preview" && prenData && (() => {
            const daGestire = [...prenData.pronte, ...prenData.ambigue, ...prenData.nuove];
            const opzioniPazienti = [...patients]
              .filter((p) => p.nome_calendario)
              .sort((a, b) => a.nome_calendario.localeCompare(b.nome_calendario));
            const coloreCorrettoCount = [
              ...prenData.pronte, ...prenData.inAttesa, ...prenData.ambigue, ...prenData.nuove,
            ].filter((r) => r.coloreCorretto).length;
            const numDaAgire = daGestire.filter((r) => (prenScelte[r.eventId] ?? prenScelteDefault(r))).length;
            return (
              <>
                {prenErrore && <p style={{ color: "crimson" }}>{prenErrore}</p>}
                {coloreCorrettoCount > 0 && (
                  <p className="muted small">Colore vinaccia corretto in automatico su {coloreCorrettoCount} evento{coloreCorrettoCount === 1 ? "" : "i"}.</p>
                )}

                {daGestire.length === 0 && prenData.inAttesa.length === 0 ? (
                  <p className="muted">Nessuna prenotazione online da gestire al momento.</p>
                ) : (
                  <>
                    {daGestire.length > 0 && (
                      <>
                        <p className="muted small" style={{ marginBottom: 4 }}>
                          Per ciascuna scegli il paziente giusto (già proposto quando c&apos;è un solo candidato),
                          oppure <strong>＋ Nuovo paziente</strong> se non è ancora in elenco — aggiungo nome/cognome/
                          email, il resto lo compili tu. Lascia su &quot;non ancora deciso&quot; per saltarla per ora.
                          Confermando rinomino solo il titolo dell&apos;evento (colore vinaccia invariato, nessun altro
                          appuntamento toccato) e rilancio subito Rinumera.
                        </p>
                        <table style={{ width: "100%", fontSize: 13, marginBottom: 12 }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: "left" }}>Data</th>
                              <th style={{ textAlign: "left" }}>Prenotato da</th>
                              <th style={{ textAlign: "left" }}>Paziente</th>
                            </tr>
                          </thead>
                          <tbody>
                            {daGestire.map((r) => (
                              <tr key={r.eventId}>
                                <td className="mono" style={{ whiteSpace: "nowrap" }}>{r.data}{r.ora ? ` ${r.ora}` : ""}</td>
                                <td>
                                  {r.bookerNome}
                                  {r.candidati?.length > 0 && (
                                    <div className="muted small">possibili: {r.candidati.map((c) => c.nome).join(", ")}</div>
                                  )}
                                </td>
                                <td>
                                  <select
                                    value={prenScelte[r.eventId] ?? prenScelteDefault(r)}
                                    onChange={(e) => setPrenScelte((prev) => ({ ...prev, [r.eventId]: e.target.value }))}
                                  >
                                    <option value="">-- non ancora deciso --</option>
                                    <option value="__new__">＋ Nuovo paziente</option>
                                    {opzioniPazienti.map((p) => (
                                      <option key={p.id} value={p.id}>{p.nome_calendario}</option>
                                    ))}
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}

                    {prenData.inAttesa.length > 0 && (
                      <div>
                        <p className="muted small" style={{ marginBottom: 4 }}>
                          <strong>In attesa</strong> — paziente già in anagrafica, manca solo il nome calendario
                          (impostalo in Pazienti, poi torna qui a riconnettere).
                        </p>
                        <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
                          {prenData.inAttesa.map((r) => {
                            const p = patients.find((pp) => pp.id === r.patientId);
                            return (
                              <li key={r.eventId}>
                                {r.bookerNome} ({r.data}) → {p ? `${p.nome || ""} ${p.cognome || ""}`.trim() : `paziente #${r.patientId}`}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </>
                )}

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                  <button className="btn btn-ghost" onClick={chiudiPrenotazioni}>Chiudi</button>
                  {numDaAgire > 0 && (
                    <button className="btn btn-primary" onClick={confermaPrenotazioni}>
                      Conferma ({numDaAgire})
                    </button>
                  )}
                </div>
              </>
            );
          })()}

          {prenStep === "writing" && <p>Riconnessione in corso…</p>}

          {prenStep === "done" && prenRisultato && (
            <>
              <p>
                {prenRisultato.ok
                  ? `Fatto: ${prenRisultato.riconnessi} riconnessi, ${prenRisultato.rinumerati} pazienti rinumerati, ${prenRisultato.nuovi} nuovi aggiunti a Pazienti.`
                  : `${prenRisultato.riconnessi} riconnessi, ${prenRisultato.falliti} falliti, ${prenRisultato.nuovi} nuovi aggiunti.`}
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn btn-primary" onClick={chiudiPrenotazioni}>Chiudi</button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
