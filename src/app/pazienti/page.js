"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import Modal from "@/components/Modal";
import SortableTh from "@/components/SortableTh";
import { normalizeName, todayISO, tariffaStandard, saldaContante, DEFAULT_SETTINGS, importoLordoDaOnorario, buildPsicogestAnagraficaRow, PSICOGEST_ANAGRAFICA_COLUMN_ORDER, titleCaseNomeCalendario } from "@/lib/logic";
import { rinumeraPazienteSilenzioso } from "@/lib/renumerazioneClient";
import { useRinumerazione } from "@/lib/useRinumerazione";

const TIPOLOGIE = [
  { value: "individuale", label: "Individuale" },
  { value: "coppia", label: "Coppia" },
  { value: "consulenza", label: "Consulenza" },
];
const TIPOLOGIA_LABEL = { individuale: "Individuale", coppia: "Coppia", consulenza: "Consulenza" };
const TIPOLOGIA_FROM_LABEL = { INDIVIDUALE: "individuale", COPPIA: "coppia", CONSULENZA: "consulenza" };

// Colonne nascondibili dall'utente (spunte "Colonne visibili"). "Nome in
// calendario" e la colonna azioni restano sempre visibili: servono sempre
// per identificare la riga e per agire su di essa.
const COLONNE_OPZIONALI = [
  { key: "nome", label: "Nome" },
  { key: "cognome", label: "Cognome" },
  { key: "fatturare_a", label: "Fatturare a" },
  { key: "email", label: "Email" },
  { key: "telefono", label: "Telefono" },
  { key: "indirizzo", label: "Indirizzo" },
  { key: "localita", label: "Località" },
  { key: "provincia", label: "Provincia" },
  { key: "cap", label: "CAP" },
  { key: "frequenza", label: "Frequenza" },
  { key: "giorno", label: "Giorno" },
  { key: "ora", label: "Ora" },
  { key: "alternanza_fissa", label: "Alternanza fissa" },
  { key: "codice_fiscale", label: "Codice fiscale" },
  { key: "tipologia", label: "Tipologia" },
  { key: "regime_tariffario", label: "Regime" },
  { key: "costo_unitario", label: "Tariffa €" },
  { key: "soglia_fatturazione", label: "Soglia" },
  { key: "giorni_stale_override", label: "Giorni inattività" },
  { key: "ancora_data", label: "Ancora: data" },
  { key: "ancora_valore", label: "Ancora: valore" },
  { key: "stato", label: "Stato" },
  { key: "modalita_pagamento", label: "Pagamento" },
  { key: "quota_contante_seduta", label: "Contante/seduta €" },
  { key: "contante_dovuto", label: "Contanti dovuti" },
];
const COLONNE_STORAGE_KEY = "pazienti-colonne-visibili";

function caricaColonneVisibili() {
  const tutte = Object.fromEntries(COLONNE_OPZIONALI.map((c) => [c.key, true]));
  if (typeof window === "undefined") return tutte;
  try {
    const salvate = JSON.parse(window.localStorage.getItem(COLONNE_STORAGE_KEY) || "{}");
    return { ...tutte, ...salvate };
  } catch {
    return tutte;
  }
}

// `sort` è una pila di criteri [{ key, dir }, ...] in ordine di priorità
// (il primo è il primario) — vedi SortableTh per come si costruisce
// cliccando le intestazioni. A parità su tutti i criteri richiesti, ordina
// in ultima istanza per nome (alfabetico) come prima.
function sortRows(list, sortStack, slotsByPatientId) {
  const arr = [...list];
  const getVal = (p, key) => {
    const slot = slotsByPatientId?.[p.id];
    switch (key) {
      case "nome_calendario": return (p.nome_calendario || "").toUpperCase();
      case "nome": return (p.nome || "").toUpperCase();
      case "cognome": return (p.cognome || "").toUpperCase();
      case "fatturare_a": return (p.fatturare_a || "").toUpperCase();
      // "Su richiesta" (nessuno slot) in fondo; settimanale < quindicinale < mensile
      case "frequenza": return slot ? slot.interval_days : Infinity;
      // Lunedì..Domenica (weekday 0=Domenica va in fondo); senza slot fisso, in fondo
      case "giorno": return slot ? (slot.weekday === 0 ? 7 : slot.weekday) : Infinity;
      case "tipologia": return p.tipologia || "";
      case "regime_tariffario": return p.regime_tariffario || "regolare";
      case "costo_unitario": return p.costo_unitario || 0;
      case "soglia_fatturazione": return p.soglia_fatturazione || 0;
      case "ancora_data": return p.ancora_data || "";
      case "stato": return p.stato || "";
      case "contante_dovuto": return p.contante_dovuto || 0;
      default: return "";
    }
  };
  const nomeOrdinamento = (p) => (p.nome_calendario || p.fatturare_a || "").toUpperCase();
  arr.sort((a, b) => {
    for (const { key, dir } of sortStack) {
      const va = getVal(a, key), vb = getVal(b, key);
      if (va < vb) return dir === "asc" ? -1 : 1;
      if (va > vb) return dir === "asc" ? 1 : -1;
    }
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
  const [sort, setSort] = useState([{ key: "fatturare_a", dir: "asc" }]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const fileInputRef = useRef(null);
  const [visibleCols, setVisibleCols] = useState(() => Object.fromEntries(COLONNE_OPZIONALI.map((c) => [c.key, true])));
  const [colonnePanelOpen, setColonnePanelOpen] = useState(false);

  useEffect(() => {
    setVisibleCols(caricaColonneVisibili());
  }, []);

  function toggleColonna(key) {
    setVisibleCols((v) => {
      const next = { ...v, [key]: !v[key] };
      try {
        window.localStorage.setItem(COLONNE_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  const [slotsByPatientId, setSlotsByPatientId] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: s }, { data: slots }] = await Promise.all([
      supabase.from("patients").select("*").order("id"),
      supabase.from("settings").select("*").maybeSingle(),
      supabase.from("patient_slots").select("*").eq("active", true),
    ]);
    setPatients(data || []);
    if (s) setSettings(s);
    setSlotsByPatientId(Object.fromEntries((slots || []).map((sl) => [sl.patient_id, sl])));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const [saveStatus, setSaveStatus] = useState("");

  // --- Rinumerazione calendario (R/A/S + numero) --- logica+modale ora
  // condivise con la Dashboard, vedi src/lib/useRinumerazione.js.
  const { apriRinumerazione, renumerazioneModal } = useRinumerazione();

  // --- Storico fatture + incassi contanti per paziente (contesto per
  // correggere Ancora/saldo a mano) ---
  const [storicoPaziente, setStoricoPaziente] = useState(null); // { nome, fatture, contanti } | null
  const [storicoLoading, setStoricoLoading] = useState(false);

  async function apriStorico(patient) {
    setStoricoLoading(true);
    const nome = patient.nome_calendario || patient.fatturare_a;
    setStoricoPaziente({ nome, fatture: [], contanti: [] });
    const [{ data: fatture }, { data: contanti }] = await Promise.all([
      supabase.from("invoice_history").select("*").eq("patient_id", patient.id).order("data", { ascending: false }),
      supabase.from("contante_pagamenti").select("*").eq("patient_id", patient.id).order("data", { ascending: false }),
    ]);
    setStoricoPaziente({ nome, fatture: fatture || [], contanti: contanti || [] });
    setStoricoLoading(false);
  }

  // --- Incasso contanti (quota non fatturata, es. 10€/seduta a parte) ---
  const [contantiModal, setContantiModal] = useState(null); // { patientId, nome, dovuto, value } | null

  function apriContantiModal(patient) {
    setContantiModal({
      patientId: patient.id,
      nome: patient.nome_calendario || patient.fatturare_a,
      dovuto: patient.contante_dovuto,
      value: String(patient.contante_dovuto),
    });
  }

  async function confermaContanti() {
    const { patientId, dovuto, value } = contantiModal;
    const importoPagato = parseFloat(value.replace(",", "."));
    if (!importoPagato || importoPagato <= 0) return;
    setContantiModal(null);
    const nuovoSaldo = saldaContante(dovuto, importoPagato);
    await Promise.all([
      supabase.from("patients").update({ contante_dovuto: nuovoSaldo }).eq("id", patientId),
      supabase.from("contante_pagamenti").insert({
        user_id: (await supabase.auth.getUser()).data.user.id,
        patient_id: patientId,
        importo: importoPagato,
        data: todayISO(),
      }),
    ]);
    patchLocal(patientId, { contante_dovuto: nuovoSaldo });
    rinumeraPazienteSilenzioso(patientId).catch((e) => console.error("Rinumerazione automatica fallita:", e));
  }

  // --- Genera occorrenze future mancanti (manutenzione settimanale) ---
  const [genOccStep, setGenOccStep] = useState(null); // null | 'loading' | 'preview' | 'writing' | 'done' | 'error'
  const [genOccGiorni, setGenOccGiorni] = useState(45);
  const [genOccData, setGenOccData] = useState(null); // array [{patientId, nome, ora, durataMinuti, date:[...]}]
  const [genOccWriteResult, setGenOccWriteResult] = useState(null);
  const [genOccError, setGenOccError] = useState("");
  const [genOccProgress, setGenOccProgress] = useState(null);
  const [genOccEsclusi, setGenOccEsclusi] = useState(new Set()); // chiavi "patientId|data" deselezionate
  const [genOccAnomalie, setGenOccAnomalie] = useState([]); // [{patientId, nome, data, ora, durataMinuti}]
  const [genOccAnomalieSelezionate, setGenOccAnomalieSelezionate] = useState(new Set()); // opt-in: "sì, ricreala comunque"
  const [genOccAnomalieRisolte, setGenOccAnomalieRisolte] = useState(new Set()); // "patientId|data" confermate come disdetta, tolte dalla lista
  const GENOCC_CHUNK_SIZE = 15;

  function toggleGenOccAnomaliaRicrea(patientId, data) {
    const chiave = `${patientId}|${data}`;
    setGenOccAnomalieSelezionate((s) => {
      const next = new Set(s);
      if (next.has(chiave)) next.delete(chiave);
      else next.add(chiave);
      return next;
    });
  }

  // Conferma che una data "anomala" (generata in passato, ora assente dal
  // calendario) è davvero una disdetta e non un errore: stessa identica
  // scrittura di "Aggiungi disdetta manuale" in Registra disdette
  // (cancellations not_charged + skipped_occurrences), così non ricompare
  // mai più né qui né nell'elenco riprenotazioni.
  async function confermaCancellazioneAnomala(a) {
    const chiave = `${a.patientId}|${a.data}`;
    const candidato = {
      eventId: `manual-${a.patientId}-${a.data}-${Date.now()}`,
      patientId: a.patientId,
      nome: a.nome,
      data: a.data,
      ora: "",
      cancelledAt: new Date().toISOString(),
      billingStatus: "not_charged",
      manual: true,
    };
    const res = await fetch("/api/calendar/aggiorna-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidati: [candidato] }),
    });
    if (res.ok) {
      setGenOccAnomalieRisolte((s) => new Set(s).add(chiave));
      setGenOccAnomalieSelezionate((s) => {
        const next = new Set(s);
        next.delete(chiave);
        return next;
      });
    } else {
      const data = await res.json().catch(() => ({}));
      setGenOccError(data.error || "Errore nella conferma della cancellazione.");
    }
  }

  function toggleGenOccData(patientId, data) {
    const chiave = `${patientId}|${data}`;
    setGenOccEsclusi((s) => {
      const next = new Set(s);
      if (next.has(chiave)) next.delete(chiave);
      else next.add(chiave);
      return next;
    });
  }

  async function caricaAnteprimaGeneraOccorrenze(giorni) {
    setGenOccStep("loading");
    setGenOccError("");
    try {
      const res = await fetch("/api/calendar/genera-occorrenze-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ giorniAvanti: giorni }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenOccError(data.error || "Errore nel calcolo dell'anteprima.");
        setGenOccStep("error");
        return;
      }
      setGenOccData(data.pazienti || []);
      setGenOccEsclusi(new Set());
      setGenOccAnomalie(data.anomalie || []);
      setGenOccAnomalieSelezionate(new Set());
      setGenOccStep("preview");
    } catch (e) {
      setGenOccError(e.message);
      setGenOccStep("error");
    }
  }

  function apriGeneraOccorrenze() {
    setGenOccGiorni(45);
    setGenOccData(null);
    setGenOccWriteResult(null);
    setGenOccAnomalie([]);
    setGenOccAnomalieSelezionate(new Set());
    setGenOccAnomalieRisolte(new Set());
    caricaAnteprimaGeneraOccorrenze(45);
  }

  async function confermaGeneraOccorrenze() {
    setGenOccStep("writing");
    const eventi = (genOccData || []).flatMap((p) =>
      p.date
        .filter((data) => !genOccEsclusi.has(`${p.patientId}|${data}`))
        .map((data) => ({ patientId: p.patientId, data, ora: p.ora, durataMinuti: p.durataMinuti }))
    );
    // Anomalie per cui Maurizio ha scelto esplicitamente "ricreala comunque"
    // (default: nessuna, mai automatico) si creano come le altre.
    for (const a of genOccAnomalie) {
      if (genOccAnomalieSelezionate.has(`${a.patientId}|${a.data}`)) {
        eventi.push({ patientId: a.patientId, data: a.data, ora: a.ora, durataMinuti: a.durataMinuti });
      }
    }
    // Le date deselezionate vengono ricordate lato server (skipped_occurrences),
    // cosi' i prossimi giri non le riproporranno piu'.
    const esclusioni = (genOccData || []).flatMap((p) =>
      p.date
        .filter((data) => genOccEsclusi.has(`${p.patientId}|${data}`))
        .map((data) => ({ patientId: p.patientId, data }))
    );

    const blocchi = [];
    for (let i = 0; i < eventi.length; i += GENOCC_CHUNK_SIZE) {
      blocchi.push(eventi.slice(i, i + GENOCC_CHUNK_SIZE));
    }
    // Se non c'e' nulla da creare (tutto escluso) serve comunque un giro per
    // salvare le esclusioni.
    if (!blocchi.length && esclusioni.length) blocchi.push([]);

    setGenOccProgress({ fatti: 0, totale: eventi.length });
    let creati = 0;
    let falliti = 0;
    const dettagli = [];
    try {
      for (let i = 0; i < blocchi.length; i++) {
        const res = await fetch("/api/calendar/genera-occorrenze-confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Le esclusioni si mandano solo nella prima chiamata: repeaterle
          // in ogni blocco non farebbe danni (upsert idempotente) ma è
          // inutile.
          body: JSON.stringify({ eventi: blocchi[i], esclusioni: i === 0 ? esclusioni : [] }),
        });
        const data = await res.json();
        if (!res.ok) {
          setGenOccError(data.error || "Errore durante la scrittura.");
          setGenOccStep("error");
          return;
        }
        creati += data.creati || 0;
        falliti += data.falliti || 0;
        dettagli.push(...(data.dettagli || []));
        setGenOccProgress({ fatti: creati + falliti, totale: eventi.length });
      }
      setGenOccWriteResult({ ok: falliti === 0, creati, falliti, dettagli });
      setGenOccStep("done");
    } catch (e) {
      setGenOccError(e.message);
      setGenOccStep("error");
    }
  }

  function chiudiGeneraOccorrenze() {
    setGenOccStep(null);
    setGenOccData(null);
    setGenOccWriteResult(null);
    setGenOccError("");
    setGenOccProgress(null);
    setGenOccAnomalie([]);
    setGenOccAnomalieSelezionate(new Set());
    setGenOccAnomalieRisolte(new Set());
  }

  // --- Chiusure/indisponibilità (weekend lunghi, mezze giornate, ferie):
  // slittano in avanti le occorrenze future degli slot fissi coinvolti,
  // ripulendo prima gli eventuali eventi già creati sulle date sbagliate. ---
  const [chiuStep, setChiuStep] = useState(null); // null | 'form' | 'loading' | 'preview' | 'writing' | 'done' | 'error'
  const [chiuForm, setChiuForm] = useState({ dataInizio: "", oraInizio: "", dataFine: "", oraFine: "", note: "" });
  const [chiuAnteprima, setChiuAnteprima] = useState(null); // { nuoveChiusure, daCancellare, daVerificare, alternanzaCoinvolta }
  const [chiuEsclusi, setChiuEsclusi] = useState(new Set()); // eventId deselezionati dalla proposta di cancellazione
  const [chiuRisultato, setChiuRisultato] = useState(null);
  const [chiuError, setChiuError] = useState("");

  function apriChiusure() {
    setChiuStep("form");
    setChiuForm({ dataInizio: todayISO(), oraInizio: "", dataFine: todayISO(), oraFine: "", note: "" });
    setChiuAnteprima(null);
    setChiuEsclusi(new Set());
    setChiuRisultato(null);
    setChiuError("");
  }

  async function calcolaAnteprimaChiusura() {
    if (!chiuForm.dataInizio || !chiuForm.dataFine) return;
    setChiuStep("loading");
    setChiuError("");
    try {
      const res = await fetch("/api/calendar/chiusura-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataInizio: chiuForm.dataInizio,
          oraInizio: chiuForm.oraInizio || null,
          dataFine: chiuForm.dataFine,
          oraFine: chiuForm.oraFine || null,
          note: chiuForm.note || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChiuError(data.error || "Errore nel calcolo dell'anteprima.");
        setChiuStep("error");
        return;
      }
      setChiuAnteprima(data);
      setChiuEsclusi(new Set());
      setChiuStep("preview");
    } catch (e) {
      setChiuError(e.message);
      setChiuStep("error");
    }
  }

  async function confermaChiusura() {
    if (!chiuAnteprima) return;
    setChiuStep("writing");
    const cancellazioni = chiuAnteprima.daCancellare
      .filter((r) => !chiuEsclusi.has(r.eventId))
      .map((r) => ({ eventId: r.eventId }));
    try {
      const res = await fetch("/api/calendar/chiusura-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nuoveChiusure: chiuAnteprima.nuoveChiusure,
          cancellazioni,
          dataInizio: chiuForm.dataInizio,
          oraInizio: chiuForm.oraInizio || null,
          dataFine: chiuForm.dataFine,
          oraFine: chiuForm.oraFine || null,
          note: chiuForm.note || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChiuError(data.error || "Errore durante la scrittura.");
        setChiuStep("error");
        return;
      }
      setChiuRisultato(data);
      setChiuStep("done");
    } catch (e) {
      setChiuError(e.message);
      setChiuStep("error");
    }
  }

  function chiudiChiusure() {
    setChiuStep(null);
    setChiuAnteprima(null);
    setChiuEsclusi(new Set());
    setChiuRisultato(null);
    setChiuError("");
  }

  async function toggleAlternanzaFissa(patient, valore) {
    const slot = slotsByPatientId[patient.id];
    if (!slot) return;
    setSlotsByPatientId((s) => ({ ...s, [patient.id]: { ...s[patient.id], alternanza_fissa: valore } }));
    await supabase.from("patient_slots").update({ alternanza_fissa: valore }).eq("id", slot.id);
  }

  const FREQ_LABEL = { 7: "Settimanale", 14: "Quindicinale", 28: "Mensile" };
  const GIORNI_LABEL = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];

  // "Uscita" dalla programmazione fissa: il paziente resta attivo, torna
  // temporaneamente "su richiesta" (come un fuori-schema qualunque) finché
  // non si decide la nuova cadenza. Disattiva lo slot (dati non persi) e
  // rimuove dal calendario i SOLI appuntamenti futuri non ancora confermati
  // (segnaposto del vecchio ritmo) — quelli già confermati col paziente
  // restano, non decadono per un cambio di programmazione. Restituisce i
  // dati della risposta (null se annullato o fallito) così sia "Su
  // richiesta" (uscita e basta) sia "Cambia programmazione" (uscita seguita
  // subito da un nuovo slot) possono riusare la stessa identica chiamata.
  async function eseguiUscita(patient) {
    try {
      const res = await fetch("/api/calendar/esci-da-programmazione", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: patient.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Errore durante l'uscita dalla programmazione.");
        return null;
      }
      setSlotsByPatientId((s) => {
        const next = { ...s };
        delete next[patient.id];
        return next;
      });
      patchLocal(patient.id, { fuori_schema: true });
      return data;
    } catch (e) {
      alert(e.message);
      return null;
    }
  }

  async function passaSuRichiesta(patient) {
    const nome = patient.nome_calendario || patient.fatturare_a;
    if (!window.confirm(`Passare ${nome} a "su richiesta"? Lo slot fisso verrà disattivato e gli appuntamenti futuri NON ancora confermati verranno rimossi dal calendario — quelli già confermati col paziente restano.`)) return;
    const data = await eseguiUscita(patient);
    if (!data) return;
    const avviso = data.cancellazioniFallite?.length
      ? ` (attenzione: ${data.cancellazioniFallite.length} cancellazioni non riuscite, riprova)`
      : "";
    alert(`Fatto: ${data.cancellati} appuntamenti non confermati rimossi, ${data.mantenuti} già confermati mantenuti.${avviso}`);
  }

  // Cambio di programmazione quando il nuovo assetto è già deciso: incatena
  // Uscita (sgancio immediato dallo schema attuale, sopra) e Rientro (sotto,
  // "Nuovo slot fisso" — stesso meccanismo di un paziente che riparte da
  // zero) nella stessa interazione. Nessuna logica nuova: è la stessa cosa
  // di cliccare prima "Su richiesta" e poi "Nuovo slot fisso" un mese dopo,
  // solo fatta insieme perché qui si conosce già la destinazione.
  async function cambiaProgrammazione(patient, intervalDaysOverride) {
    const nome = patient.nome_calendario || patient.fatturare_a;
    const cadenzaAttuale = slotsByPatientId[patient.id]?.interval_days;
    if (!window.confirm(`Cambiare programmazione di ${nome}? Lo slot attuale verrà disattivato subito e gli appuntamenti futuri NON ancora confermati liberati (quelli già confermati restano) — poi scegli la prima seduta del nuovo assetto.`)) return;
    const data = await eseguiUscita(patient);
    if (!data) return;
    if (data.cancellazioniFallite?.length) {
      alert(`Attenzione: ${data.cancellazioniFallite.length} cancellazioni non riuscite, riprova più tardi.`);
    }
    apriNuovoSlot(patient, intervalDaysOverride ?? cadenzaAttuale ?? 7);
  }

  // --- Nuovo slot fisso (paziente "su richiesta" che passa a una cadenza fissa) ---
  const [nuovoSlotModal, setNuovoSlotModal] = useState(null); // { patientId, nome, intervalDays, data, ora } | null

  function apriNuovoSlot(patient, intervalDays) {
    setNuovoSlotModal({
      patientId: patient.id,
      nome: patient.nome_calendario || patient.fatturare_a,
      intervalDays,
      data: "",
      ora: "",
    });
  }

  function chiudiNuovoSlot() {
    setNuovoSlotModal(null);
  }

  async function confermaNuovoSlot() {
    const { patientId, intervalDays, data, ora } = nuovoSlotModal;
    if (!data || !ora) return;
    // Stessa convenzione già usata negli script di migrazione: mezzogiorno
    // UTC per calcolare il weekday, cosi' il cambio d'ora legale/solare non
    // fa scivolare la data di un giorno.
    const weekday = new Date(`${data}T12:00:00Z`).getUTCDay();
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("patient_slots").insert({
      user_id: userData.user.id,
      patient_id: patientId,
      weekday,
      time_of_day: `${ora}:00`,
      interval_days: intervalDays,
      anchor_date: data,
      active: true,
    });
    await supabase.from("patients").update({ fuori_schema: false }).eq("id", patientId);
    patchLocal(patientId, { fuori_schema: false });
    setNuovoSlotModal(null);
    load();
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
    const patch = { [field]: value };
    // Aggiorna la tariffa allo standard della nuova categoria SOLO se era già
    // sullo standard della categoria precedente — se il paziente ha una
    // tariffa concordata a parte (es. 60€ invece di 50€ per un individuale
    // agevolato), cambiare tipologia/regime non deve sovrascriverla in
    // silenzio: resta com'è, correggibile a mano.
    const eraTariffaStandard = p.costo_unitario === tariffaStandard(p.tipologia, p.regime_tariffario, settings);
    if (eraTariffaStandard) {
      const nextTipologia = field === "tipologia" ? value : p.tipologia;
      const nextRegime = field === "regime_tariffario" ? value : p.regime_tariffario;
      patch.costo_unitario = tariffaStandard(nextTipologia, nextRegime, settings);
    }
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
      Nome: p.nome || "",
      Cognome: p.cognome || "",
      "Fatturare a": p.fatturare_a,
      Email: p.email || "",
      Telefono: p.telefono || "",
      Indirizzo: p.indirizzo || "",
      Località: p.localita || "",
      Provincia: p.provincia || "",
      CAP: p.cap || "",
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
        const nomeCal = titleCaseNomeCalendario(String(row["Nome calendario"] || "").trim());
        const nomeCol = String(row["Nome"] || "").trim();
        const cognomeCol = String(row["Cognome"] || "").trim();
        let fatturareA = String(row["Fatturare a"] || "").trim();
        // Formato grezzo di export Psicogest: colonne separate "Nome" e "Cognome" invece di "Fatturare a"
        if (!fatturareA && nomeCol && cognomeCol) fatturareA = `${cognomeCol} ${nomeCol}`;
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
        const email = String(row["Email"] || "").trim();
        const telefono = String(row["Telefono"] || "").trim();
        const indirizzo = String(row["Indirizzo"] || "").trim();
        const localita = String(row["Località"] || "").trim();
        const provincia = String(row["Provincia"] || "").trim();
        const cap = String(row["CAP"] || "").trim();

        if (existing) {
          const patch = {
            nome_calendario: nomeCal || existing.nome_calendario,
            nome: nomeCol || existing.nome,
            cognome: cognomeCol || existing.cognome,
            fatturare_a: fatturareA,
            email: email || existing.email,
            telefono: telefono || existing.telefono,
            indirizzo: indirizzo || existing.indirizzo,
            localita: localita || existing.localita,
            provincia: provincia || existing.provincia,
            cap: cap || existing.cap,
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
            nome: nomeCol,
            cognome: cognomeCol,
            fatturare_a: fatturareA,
            email,
            telefono,
            indirizzo,
            localita,
            provincia,
            cap,
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

  // Export "anagrafica pazienti" nel formato che Psicogest stesso accetta in
  // Strumenti → Importa (distinto dall'export "Esporta anagrafica" sopra,
  // che è il roundtrip Excel per modificare in blocco i nostri dati, non un
  // formato Psicogest). Psicogest deduplica per Codice Fiscale/Partita IVA,
  // quindi si può riesportare tutta l'anagrafica ogni volta senza creare
  // doppioni: i pazienti già presenti vengono semplicemente ignorati.
  function exportPsicogestAnagrafica() {
    const esportabili = patients.filter((p) => p.nome && p.cognome && p.codice_fiscale);
    const saltati = patients.length - esportabili.length;
    if (!esportabili.length) {
      alert("Nessun paziente con Nome, Cognome e Codice fiscale tutti compilati: niente da esportare.");
      return;
    }
    const rows = esportabili.map(buildPsicogestAnagraficaRow);
    const ws = XLSX.utils.json_to_sheet(rows, { header: PSICOGEST_ANAGRAFICA_COLUMN_ORDER });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Foglio 1");
    // Psicogest accetta solo .xls dal selettore file (stessa scoperta già
    // fatta con l'import fatture).
    XLSX.writeFile(wb, `anagrafica_psicogest_${todayISO()}.xls`, { bookType: "xls" });
    if (saltati > 0) {
      alert(
        `Esportati ${esportabili.length} pazienti. ${saltati} saltati perché manca Nome, Cognome o Codice fiscale ` +
          `(es. pazienti "coppia" con un solo record per due persone — vanno gestiti a mano in Psicogest).`
      );
    }
  }

  if (loading) return <div style={{ padding: 40 }}>Caricamento…</div>;

  const filtered = sortRows(
    patients
      .filter((p) => normalizeName((p.nome_calendario || "") + " " + (p.fatturare_a || "")).includes(normalizeName(query)))
      .filter((p) => !onlyIncomplete || !p.nome_calendario || !p.codice_fiscale),
    sort,
    slotsByPatientId
  );

  return (
    <div className="app-root">
      <Sidebar readyCount={0} />
      <main className="main pazienti-main">
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
            <button className="btn btn-ghost" title="Genera un .xls nel formato che Psicogest accetta in Strumenti → Importa: i pazienti già presenti (per Codice fiscale) vengono ignorati, quindi si può riesportare tutto senza doppioni" onClick={exportPsicogestAnagrafica}>Esporta per Psicogest</button>
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
            <button className="btn btn-ghost" onClick={apriGeneraOccorrenze}>Genera occorrenze future</button>
            <button className="btn btn-ghost" onClick={apriChiusure}>Chiusure calendario</button>
          </div>
        </header>

        <div className="pazienti-toolbar">
          <input className="search" placeholder="Cerca per nome…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#55645D" }}>
            <input type="checkbox" checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} />
            Mostra solo da completare (manca nome calendario o CF)
          </label>
          <div className="colonne-picker">
            <button className="btn btn-ghost" onClick={() => setColonnePanelOpen((v) => !v)}>Colonne ▾</button>
            {colonnePanelOpen && (
              <>
                <div className="colonne-panel-backdrop" onClick={() => setColonnePanelOpen(false)} />
                <div className="colonne-panel">
                  {COLONNE_OPZIONALI.map((c) => (
                    <label key={c.key}>
                      <input type="checkbox" checked={visibleCols[c.key] !== false} onChange={() => toggleColonna(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="table-scroll">
          <table className="tbl editable">
            <thead>
              <tr>
                <SortableTh label="Nome in calendario" sortKey="nome_calendario" sort={sort} setSort={setSort} />
                {visibleCols.nome && <SortableTh label="Nome" sortKey="nome" sort={sort} setSort={setSort} />}
                {visibleCols.cognome && <SortableTh label="Cognome" sortKey="cognome" sort={sort} setSort={setSort} />}
                {visibleCols.fatturare_a && <SortableTh label="Fatturare a" sortKey="fatturare_a" sort={sort} setSort={setSort} />}
                {visibleCols.email && <th>Email</th>}
                {visibleCols.telefono && <th>Telefono</th>}
                {visibleCols.indirizzo && <th>Indirizzo</th>}
                {visibleCols.localita && <th>Località</th>}
                {visibleCols.provincia && <th>Provincia</th>}
                {visibleCols.cap && <th>CAP</th>}
                {visibleCols.frequenza && (
                  <SortableTh
                    label="Frequenza"
                    sortKey="frequenza"
                    sort={sort}
                    setSort={setSort}
                    title="Cadenza dello slot fisso, oppure 'Su richiesta' per chi prenota di volta in volta senza slot fisso"
                  />
                )}
                {visibleCols.giorno && <SortableTh label="Giorno" sortKey="giorno" sort={sort} setSort={setSort} />}
                {visibleCols.ora && <th>Ora</th>}
                {visibleCols.alternanza_fissa && <th title="Il turno di questo paziente non può spostarsi (es. solo 1°/3° del mese): le chiusure/indisponibilità non lo fanno slittare in automatico">Alternanza fissa</th>}
                {visibleCols.codice_fiscale && <th>Codice fiscale</th>}
                {visibleCols.tipologia && <SortableTh label="Tipologia" sortKey="tipologia" sort={sort} setSort={setSort} />}
                {visibleCols.regime_tariffario && <SortableTh label="Regime" sortKey="regime_tariffario" sort={sort} setSort={setSort} />}
                {visibleCols.costo_unitario && <SortableTh label="Tariffa €" sortKey="costo_unitario" sort={sort} setSort={setSort} />}
                {visibleCols.soglia_fatturazione && <SortableTh label="Soglia" sortKey="soglia_fatturazione" sort={sort} setSort={setSort} />}
                {visibleCols.giorni_stale_override && <th>Giorni inattività</th>}
                {visibleCols.ancora_data && <SortableTh label="Ancora: data" sortKey="ancora_data" sort={sort} setSort={setSort} />}
                {visibleCols.ancora_valore && <th>Ancora: valore</th>}
                {visibleCols.stato && <SortableTh label="Stato" sortKey="stato" sort={sort} setSort={setSort} />}
                {visibleCols.modalita_pagamento && <th>Pagamento</th>}
                {visibleCols.quota_contante_seduta && <th title="Quota extra a seduta non fatturata, pagata a parte in contanti (0 se non si applica)">Contante/seduta €</th>}
                {visibleCols.contante_dovuto && <SortableTh label="Contanti dovuti" sortKey="contante_dovuto" sort={sort} setSort={setSort} />}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input value={p.nome_calendario || ""} placeholder="manca" className={!p.nome_calendario ? "input-missing" : ""} onChange={(e) => updateLocal(p.id, "nome_calendario", e.target.value)} onBlur={(e) => updateField(p.id, "nome_calendario", titleCaseNomeCalendario(e.target.value))} />
                  </td>
                  {visibleCols.nome && (
                    <td><input value={p.nome || ""} onChange={(e) => updateLocal(p.id, "nome", e.target.value)} onBlur={(e) => persistField(p.id, "nome", e.target.value)} /></td>
                  )}
                  {visibleCols.cognome && (
                    <td><input value={p.cognome || ""} onChange={(e) => updateLocal(p.id, "cognome", e.target.value)} onBlur={(e) => persistField(p.id, "cognome", e.target.value)} /></td>
                  )}
                  {visibleCols.fatturare_a && (
                    <td><input value={p.fatturare_a || ""} onChange={(e) => updateLocal(p.id, "fatturare_a", e.target.value)} onBlur={(e) => persistField(p.id, "fatturare_a", e.target.value)} /></td>
                  )}
                  {visibleCols.email && (
                    <td><input type="email" value={p.email || ""} onChange={(e) => updateLocal(p.id, "email", e.target.value)} onBlur={(e) => persistField(p.id, "email", e.target.value)} /></td>
                  )}
                  {visibleCols.telefono && (
                    <td><input value={p.telefono || ""} onChange={(e) => updateLocal(p.id, "telefono", e.target.value)} onBlur={(e) => persistField(p.id, "telefono", e.target.value)} /></td>
                  )}
                  {visibleCols.indirizzo && (
                    <td><input value={p.indirizzo || ""} onChange={(e) => updateLocal(p.id, "indirizzo", e.target.value)} onBlur={(e) => persistField(p.id, "indirizzo", e.target.value)} /></td>
                  )}
                  {visibleCols.localita && (
                    <td><input value={p.localita || ""} onChange={(e) => updateLocal(p.id, "localita", e.target.value)} onBlur={(e) => persistField(p.id, "localita", e.target.value)} /></td>
                  )}
                  {visibleCols.provincia && (
                    <td><input value={p.provincia || ""} maxLength={2} style={{ width: "3.5em" }} onChange={(e) => updateLocal(p.id, "provincia", e.target.value.toUpperCase())} onBlur={(e) => persistField(p.id, "provincia", e.target.value.toUpperCase())} /></td>
                  )}
                  {visibleCols.cap && (
                    <td><input value={p.cap || ""} maxLength={5} style={{ width: "4.5em" }} onChange={(e) => updateLocal(p.id, "cap", e.target.value)} onBlur={(e) => persistField(p.id, "cap", e.target.value)} /></td>
                  )}
                  {visibleCols.frequenza && (
                    <td>
                      <select
                        value={slotsByPatientId[p.id] ? slotsByPatientId[p.id].interval_days : "richiesta"}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "richiesta") {
                            passaSuRichiesta(p);
                          } else if (slotsByPatientId[p.id]) {
                            cambiaProgrammazione(p, parseInt(v, 10));
                          } else {
                            apriNuovoSlot(p, parseInt(v, 10));
                          }
                        }}
                      >
                        <option value={7}>Settimanale</option>
                        <option value={14}>Quindicinale</option>
                        <option value={28}>Mensile</option>
                        <option value="richiesta">Su richiesta</option>
                      </select>
                    </td>
                  )}
                  {visibleCols.giorno && (
                    <td>
                      {slotsByPatientId[p.id] ? (
                        <span className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {GIORNI_LABEL[slotsByPatientId[p.id].weekday]}
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: "2px 8px", fontSize: 12 }}
                            title="Cambia giorno (esce dalla programmazione attuale e apre la scelta della prima seduta del nuovo assetto)"
                            onClick={() => cambiaProgrammazione(p)}
                          >
                            cambia
                          </button>
                        </span>
                      ) : (
                        <span className="muted mono">—</span>
                      )}
                    </td>
                  )}
                  {visibleCols.ora && (
                    <td>
                      {slotsByPatientId[p.id] ? (
                        <span className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {(slotsByPatientId[p.id].time_of_day || "").slice(0, 5)}
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: "2px 8px", fontSize: 12 }}
                            title="Cambia ora (esce dalla programmazione attuale e apre la scelta della prima seduta del nuovo assetto)"
                            onClick={() => cambiaProgrammazione(p)}
                          >
                            cambia
                          </button>
                        </span>
                      ) : (
                        <span className="muted mono">—</span>
                      )}
                    </td>
                  )}
                  {visibleCols.alternanza_fissa && (
                    <td>
                      {slotsByPatientId[p.id] ? (
                        <input
                          type="checkbox"
                          checked={!!slotsByPatientId[p.id].alternanza_fissa}
                          title="Il turno non si sposta mai in automatico per una chiusura/indisponibilità"
                          onChange={(e) => toggleAlternanzaFissa(p, e.target.checked)}
                        />
                      ) : (
                        <span className="muted mono">—</span>
                      )}
                    </td>
                  )}
                  {visibleCols.codice_fiscale && (
                  <td>
                    <input
                      className={!p.codice_fiscale ? "input-missing" : ""}
                      value={p.codice_fiscale || ""}
                      placeholder="manca"
                      onChange={(e) => updateLocal(p.id, "codice_fiscale", e.target.value.toUpperCase())}
                      onBlur={(e) => persistField(p.id, "codice_fiscale", e.target.value.toUpperCase())}
                    />
                  </td>
                  )}
                  {visibleCols.tipologia && (
                  <td>
                    <select value={p.tipologia} onChange={(e) => updateTipologiaORegime(p.id, "tipologia", e.target.value)}>
                      {TIPOLOGIE.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </td>
                  )}
                  {visibleCols.regime_tariffario && (
                  <td>
                    <select value={p.regime_tariffario || "regolare"} onChange={(e) => updateTipologiaORegime(p.id, "regime_tariffario", e.target.value)}>
                      <option value="regolare">Regolare</option>
                      <option value="agevolata">Agevolata</option>
                    </select>
                  </td>
                  )}
                  {visibleCols.costo_unitario && (
                  <td><input type="number" step="0.01" className="num" value={p.costo_unitario} onChange={(e) => updateLocal(p.id, "costo_unitario", e.target.value)} onBlur={(e) => persistField(p.id, "costo_unitario", parseFloat(e.target.value) || 0)} /></td>
                  )}
                  {visibleCols.soglia_fatturazione && (
                  <td><input type="number" className="num" value={p.soglia_fatturazione} onChange={(e) => updateLocal(p.id, "soglia_fatturazione", e.target.value)} onBlur={(e) => persistField(p.id, "soglia_fatturazione", parseInt(e.target.value) || 5)} /></td>
                  )}
                  {visibleCols.giorni_stale_override && (
                  <td><input type="number" className="num" placeholder="def." value={p.giorni_stale_override || ""} onChange={(e) => updateLocal(p.id, "giorni_stale_override", e.target.value)} onBlur={(e) => persistField(p.id, "giorni_stale_override", parseInt(e.target.value) || null)} /></td>
                  )}
                  {visibleCols.ancora_data && (
                  <td><input type="date" value={p.ancora_data || ""} onChange={(e) => updateField(p.id, "ancora_data", e.target.value)} /></td>
                  )}
                  {visibleCols.ancora_valore && (
                  <td><input type="number" className="num" value={p.ancora_valore} onChange={(e) => updateLocal(p.id, "ancora_valore", e.target.value)} onBlur={(e) => persistField(p.id, "ancora_valore", parseInt(e.target.value) || 0)} /></td>
                  )}
                  {visibleCols.stato && (
                  <td>
                    <select value={p.stato} onChange={(e) => updateField(p.id, "stato", e.target.value)} title="In sospeso: continua a contare le sedute ma non segnala mai come pronto per la fattura">
                      <option value="attivo">Attivo</option>
                      <option value="sospeso">In sospeso</option>
                    </select>
                  </td>
                  )}
                  {visibleCols.modalita_pagamento && (
                  <td>
                    <select value={p.modalita_pagamento} onChange={(e) => updateField(p.id, "modalita_pagamento", e.target.value)}>
                      <option>Bonifico</option><option>Contante</option><option>Paypal</option><option>Carta</option>
                    </select>
                  </td>
                  )}
                  {visibleCols.quota_contante_seduta && (
                  <td>
                    <input
                      type="number" step="0.01" className="num"
                      value={p.quota_contante_seduta || 0}
                      onChange={(e) => updateLocal(p.id, "quota_contante_seduta", e.target.value)}
                      onBlur={(e) => persistField(p.id, "quota_contante_seduta", parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  )}
                  {visibleCols.contante_dovuto && (
                  <td>
                    {p.contante_dovuto > 0 ? (
                      <button className="btn-small" onClick={() => apriContantiModal(p)}>€ {p.contante_dovuto}</button>
                    ) : (
                      <span className="muted mono">—</span>
                    )}
                  </td>
                  )}
                  <td>
                    <button className="btn-icon" title="Aggiorna numerazione calendario" onClick={() => apriRinumerazione(p.id)}>↻</button>
                    <button className="btn-icon" title="Storico fatture di questo paziente" onClick={() => apriStorico(p)}>§</button>
                    <button className="btn-icon" onClick={() => removePatient(p.id, p.nome_calendario || p.fatturare_a)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {renumerazioneModal}

      {genOccStep && (
        <Modal maxWidth={640}>
          <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>Genera occorrenze future</h2>

          {genOccStep === "loading" && <p>Calcolo dell&apos;anteprima in corso…</p>}

          {genOccStep === "error" && (
            <>
              <p style={{ color: "crimson" }}>{genOccError}</p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn btn-ghost" onClick={chiudiGeneraOccorrenze}>Chiudi</button>
              </div>
            </>
          )}

          {genOccStep === "preview" && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
                <label className="muted small">Orizzonte (giorni da oggi):</label>
                <input
                  type="number" className="num" style={{ width: 70 }}
                  value={genOccGiorni}
                  onChange={(e) => setGenOccGiorni(parseInt(e.target.value) || 45)}
                />
                <button className="btn btn-ghost" onClick={() => caricaAnteprimaGeneraOccorrenze(genOccGiorni)}>Ricalcola</button>
              </div>
              <p className="muted small" style={{ marginTop: -8, marginBottom: 16 }}>
                Ogni nuovo appuntamento nasce &quot;da confermare&quot; (arancione) — nessuna occorrenza già presente viene toccata o duplicata.
              </p>

              {genOccAnomalie.filter((a) => !genOccAnomalieRisolte.has(`${a.patientId}|${a.data}`)).length > 0 && (
                <div style={{ marginBottom: 16, padding: 10, border: "1px solid #C77", borderRadius: 8, background: "#FFF5F5" }}>
                  <p className="muted small" style={{ marginTop: 0 }}>
                    <strong>Date anomale</strong> — erano già state generate in passato ma ora non hanno un evento sul
                    calendario, senza essere state registrate come disdetta: probabile cancellazione fatta a mano su
                    Google Calendar. <strong>Non vengono ricreate in automatico.</strong> Per ciascuna, scegli cosa è
                    successo davvero.
                  </p>
                  {genOccAnomalie
                    .filter((a) => !genOccAnomalieRisolte.has(`${a.patientId}|${a.data}`))
                    .map((a) => {
                      const chiave = `${a.patientId}|${a.data}`;
                      return (
                        <div key={chiave} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid #F0D0D0" }}>
                          <span className="small" style={{ minWidth: 220 }}>
                            <strong>{a.nome}</strong> — {a.data} (ore {a.ora})
                          </span>
                          <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <input
                              type="checkbox"
                              checked={genOccAnomalieSelezionate.has(chiave)}
                              onChange={() => toggleGenOccAnomaliaRicrea(a.patientId, a.data)}
                            />
                            Ricreala comunque
                          </label>
                          <button className="btn-small" onClick={() => confermaCancellazioneAnomala(a)}>
                            Non è un errore: registra come disdetta
                          </button>
                        </div>
                      );
                    })}
                </div>
              )}

              {(!genOccData || genOccData.length === 0) ? (
                genOccAnomalie.length === 0 && (
                  <p className="muted">Nessuna occorrenza mancante: il calendario copre già l&apos;orizzonte scelto per tutti.</p>
                )
              ) : (
                <>
                  <p className="muted small">
                    Togli la spunta a una data se sai già che non va creata (es. una seduta che hai deciso di saltare/spostare) — viene ricordato, non te la riproporrà più ai prossimi giri.
                  </p>
                  {genOccData.map((p) => (
                    <div key={p.patientId} style={{ marginBottom: 14 }}>
                      <strong>{p.nome}</strong>{" "}
                      <span className="muted small">(ore {p.ora})</span>
                      <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
                        {p.date.map((data) => {
                          const chiave = `${p.patientId}|${data}`;
                          const esclusa = genOccEsclusi.has(chiave);
                          return (
                            <label key={data} className="small" style={{ display: "inline-flex", alignItems: "center", gap: 5, opacity: esclusa ? 0.5 : 1 }}>
                              <input type="checkbox" checked={!esclusa} onChange={() => toggleGenOccData(p.patientId, data)} />
                              {data}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                <button className="btn btn-ghost" onClick={chiudiGeneraOccorrenze}>Annulla</button>
                {((genOccData && genOccData.length > 0) || genOccAnomalieSelezionate.size > 0) && (
                  <button className="btn btn-primary" onClick={confermaGeneraOccorrenze}>Conferma e crea sul calendario</button>
                )}
              </div>
            </>
          )}

          {genOccStep === "writing" && (
            <>
              <p>Creazione eventi in corso su Google Calendar…</p>
              {genOccProgress && (
                <>
                  <div style={{ background: "#EEF1EE", borderRadius: 6, overflow: "hidden", height: 10 }}>
                    <div
                      style={{
                        width: `${Math.round((genOccProgress.fatti / Math.max(genOccProgress.totale, 1)) * 100)}%`,
                        background: "#3E6B4F",
                        height: "100%",
                        transition: "width 150ms ease",
                      }}
                    />
                  </div>
                  <p className="muted small" style={{ marginTop: 6 }}>
                    {genOccProgress.fatti} / {genOccProgress.totale} eventi creati
                  </p>
                </>
              )}
            </>
          )}

          {genOccStep === "done" && genOccWriteResult && (
            <>
              <p>
                {genOccWriteResult.ok
                  ? `Fatto: ${genOccWriteResult.creati} eventi creati.`
                  : `${genOccWriteResult.creati} eventi creati, ${genOccWriteResult.falliti} falliti.`}
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn btn-primary" onClick={chiudiGeneraOccorrenze}>Chiudi</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {chiuStep && (
        <Modal maxWidth={640}>
          <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>Chiusure calendario</h2>

          {chiuStep === "form" && (
            <>
              <p className="muted small">
                Segna una finestra continua di indisponibilità: da un giorno/ora a un altro giorno/ora (es.
                &quot;da lunedì 23 ore 7 a domenica 29 ore 22&quot;) — lascia vuoto un orario per intendere
                &quot;dall'inizio&quot;/&quot;fino a fine giornata&quot; (entrambi vuoti = giornata/e intere chiuse). Le
                occorrenze future degli slot fissi coinvolti slittano in avanti di una settimana — chi ha
                &quot;alternanza fissa&quot; non si sposta, resta a te decidere. Viene creato anche un evento
                &quot;occupato&quot; sul calendario reale, così la pagina di prenotazione online non proporrà più
                questi orari.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label className="small" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  Dal
                  <input
                    type="date"
                    value={chiuForm.dataInizio}
                    onChange={(e) => setChiuForm((f) => ({ ...f, dataInizio: e.target.value }))}
                  />
                  ore
                  <input
                    type="time"
                    value={chiuForm.oraInizio}
                    onChange={(e) => setChiuForm((f) => ({ ...f, oraInizio: e.target.value }))}
                    placeholder="inizio giornata"
                  />
                </label>
                <label className="small" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  Al
                  <input
                    type="date"
                    value={chiuForm.dataFine}
                    onChange={(e) => setChiuForm((f) => ({ ...f, dataFine: e.target.value }))}
                  />
                  ore
                  <input
                    type="time"
                    value={chiuForm.oraFine}
                    onChange={(e) => setChiuForm((f) => ({ ...f, oraFine: e.target.value }))}
                    placeholder="fine giornata"
                  />
                </label>
                <label className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  Nota (facoltativa)
                  <input
                    type="text"
                    style={{ flex: 1 }}
                    value={chiuForm.note}
                    onChange={(e) => setChiuForm((f) => ({ ...f, note: e.target.value }))}
                    placeholder="es. ferie natalizie"
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                <button className="btn btn-ghost" onClick={chiudiChiusure}>Annulla</button>
                <button
                  className="btn btn-primary"
                  disabled={!chiuForm.dataInizio || !chiuForm.dataFine || chiuForm.dataFine < chiuForm.dataInizio}
                  onClick={calcolaAnteprimaChiusura}
                >
                  Calcola anteprima
                </button>
              </div>
            </>
          )}

          {chiuStep === "loading" && <p>Calcolo dell&apos;anteprima in corso…</p>}

          {chiuStep === "error" && (
            <>
              <p style={{ color: "crimson" }}>{chiuError}</p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn btn-ghost" onClick={chiudiChiusure}>Chiudi</button>
              </div>
            </>
          )}

          {chiuStep === "preview" && chiuAnteprima && (
            <>
              {chiuAnteprima.nuoveChiusure.length === 0 ? (
                <p className="muted small">
                  Nessun appuntamento reale cade in questa finestra (chi era programmato ha già disdetto per conto
                  suo, o la chiusura è già registrata) — nessuno slittamento necessario. Confermando creo comunque
                  l&apos;evento &quot;occupato&quot; sul calendario, così la pagina di prenotazione non offre questi orari.
                </p>
              ) : (
                <>
                  <p className="muted small">
                    <strong>{chiuAnteprima.nuoveChiusure.length}</strong> appuntamenti reali coinvolti (con chi
                    condivide la loro stessa fascia). Dopo aver confermato, rilancia &quot;Genera occorrenze
                    future&quot; per creare le date corrette slittate.
                  </p>

                  {chiuAnteprima.daCancellare.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <p className="muted small" style={{ marginBottom: 4 }}>
                        <strong>Da cancellare</strong> — eventi &quot;da confermare&quot; già creati sulle date ora
                        chiuse, non più corrette (deseleziona per lasciarli):
                      </p>
                      {chiuAnteprima.daCancellare.map((r) => {
                        const escluso = chiuEsclusi.has(r.eventId);
                        return (
                          <label key={r.eventId} className="small" style={{ display: "flex", alignItems: "center", gap: 8, opacity: escluso ? 0.5 : 1 }}>
                            <input
                              type="checkbox"
                              checked={!escluso}
                              onChange={() =>
                                setChiuEsclusi((s) => {
                                  const next = new Set(s);
                                  if (next.has(r.eventId)) next.delete(r.eventId);
                                  else next.add(r.eventId);
                                  return next;
                                })
                              }
                            />
                            {r.nome} — {r.data} {r.ora}
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {chiuAnteprima.daVerificare.length > 0 && (
                    <div className="tone-warn" style={{ marginBottom: 12, padding: 10, borderRadius: 8 }}>
                      <p className="small" style={{ marginTop: 0, marginBottom: 4 }}>
                        <strong>Da verificare a mano</strong> — già confermati col paziente o prenotati online, mai
                        toccati in automatico:
                      </p>
                      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                        {chiuAnteprima.daVerificare.map((r) => (
                          <li key={r.eventId}>{r.nome} — {r.data} {r.ora}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {chiuAnteprima.alternanzaCoinvolta.length > 0 && (
                    <div className="tone-warn" style={{ marginBottom: 12, padding: 10, borderRadius: 8 }}>
                      <p className="small" style={{ margin: 0 }}>
                        <strong>Alternanza fissa</strong> — non spostati in automatico, decidi tu:{" "}
                        {chiuAnteprima.alternanzaCoinvolta.map((r) => r.nome).join(", ")}
                      </p>
                    </div>
                  )}
                </>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                <button className="btn btn-ghost" onClick={chiudiChiusure}>Annulla</button>
                <button className="btn btn-primary" onClick={confermaChiusura}>Conferma chiusura</button>
              </div>
            </>
          )}

          {chiuStep === "writing" && <p>Registrazione della chiusura in corso…</p>}

          {chiuStep === "done" && chiuRisultato && (
            <>
              <p>
                {chiuRisultato.chiuse} fasce chiuse, {chiuRisultato.cancellati} eventi obsoleti cancellati
                {chiuRisultato.falliti > 0 ? `, ${chiuRisultato.falliti} falliti` : ""}.
              </p>
              <p className={chiuRisultato.bloccoCreato ? "muted small" : "small"} style={!chiuRisultato.bloccoCreato ? { color: "crimson" } : undefined}>
                {chiuRisultato.bloccoCreato
                  ? "Evento \"occupato\" creato sul calendario: la pagina di prenotazione online non proporrà più questi orari."
                  : `Attenzione: l'evento "occupato" sul calendario NON è stato creato (${chiuRisultato.bloccoErrore}) — la pagina di prenotazione potrebbe ancora proporre questi orari, crealo a mano.`}
              </p>
              <p className="muted small">Ora vai su &quot;Genera occorrenze future&quot; per creare le date corrette.</p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn btn-primary" onClick={chiudiChiusure}>Chiudi</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {nuovoSlotModal && (
        <Modal maxWidth={420}>
          <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>
            Nuovo slot fisso — {nuovoSlotModal.nome}
          </h2>
          <p className="muted small">
            {FREQ_LABEL[nuovoSlotModal.intervalDays]}, a partire dalla prima seduta che scegli qui sotto — le
            successive verranno generate con la stessa cadenza, giorno della settimana e orario (via &quot;Genera
            occorrenze future&quot;).
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <label className="muted small" style={{ flex: 1 }}>
              Data prima seduta
              <input
                type="date"
                style={{ display: "block", width: "100%", marginTop: 4 }}
                value={nuovoSlotModal.data}
                onChange={(e) => setNuovoSlotModal((m) => ({ ...m, data: e.target.value }))}
              />
            </label>
            <label className="muted small" style={{ flex: 1 }}>
              Ora
              <input
                type="time"
                style={{ display: "block", width: "100%", marginTop: 4 }}
                value={nuovoSlotModal.ora}
                onChange={(e) => setNuovoSlotModal((m) => ({ ...m, ora: e.target.value }))}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={chiudiNuovoSlot}>Annulla</button>
            <button className="btn btn-primary" disabled={!nuovoSlotModal.data || !nuovoSlotModal.ora} onClick={confermaNuovoSlot}>
              Crea slot fisso
            </button>
          </div>
        </Modal>
      )}

      {storicoPaziente && (
        <Modal maxWidth={560}>
          <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>
            Storico — {storicoPaziente.nome}
          </h2>
          {storicoLoading ? (
            <p>Caricamento…</p>
          ) : (
            <>
              <h3 className="sub-heading" style={{ margin: "0 0 8px", fontSize: 14 }}>Fatture</h3>
              {storicoPaziente.fatture.length === 0 ? (
                <p className="muted">Nessuna fattura confermata per questo paziente.</p>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr><th>Data</th><th>Sedute</th><th>Importo</th><th>Note</th></tr>
                  </thead>
                  <tbody>
                    {storicoPaziente.fatture.map((h) => (
                      <tr key={h.id}>
                        <td className="mono">{h.data}</td>
                        <td className="mono">{h.totale_sedute}</td>
                        <td className="mono">€ {importoLordoDaOnorario(h.onorario)}</td>
                        <td>{h.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h3 className="sub-heading" style={{ margin: "20px 0 8px", fontSize: 14 }}>Incassi contanti (quota non fatturata)</h3>
              {storicoPaziente.contanti.length === 0 ? (
                <p className="muted">Nessun incasso contanti registrato per questo paziente.</p>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr><th>Data</th><th>Importo</th></tr>
                  </thead>
                  <tbody>
                    {storicoPaziente.contanti.map((h) => (
                      <tr key={h.id}>
                        <td className="mono">{h.data}</td>
                        <td className="mono">€ {h.importo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setStoricoPaziente(null)}>Chiudi</button>
          </div>
        </Modal>
      )}

      {contantiModal && (
        <Modal maxWidth={400}>
          <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>Contanti ricevuti</h2>
          <p className="muted small">
            {contantiModal.nome} — saldo dovuto: <strong>€ {contantiModal.dovuto}</strong>. Indica quanto ha
            effettivamente portato (puoi modificare l&apos;importo per un pagamento parziale).
          </p>
          <input
            type="number"
            step="0.01"
            className="num"
            autoFocus
            style={{ width: "100%", boxSizing: "border-box", marginTop: 8 }}
            value={contantiModal.value}
            onChange={(e) => setContantiModal((m) => ({ ...m, value: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") confermaContanti();
              if (e.key === "Escape") setContantiModal(null);
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setContantiModal(null)}>Annulla</button>
            <button
              className="btn btn-primary"
              disabled={!contantiModal.value || parseFloat(contantiModal.value.replace(",", ".")) <= 0}
              onClick={confermaContanti}
            >
              Conferma incasso
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
