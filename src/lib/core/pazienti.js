// Abbinamento evento→paziente e stato di conteggio sedute di un paziente.
import { daysBetween, normalizeName, todayISO } from "./util.js";

// Colore calendario per le occorrenze generate di un paziente tipologia
// "altro" (richiesta di Maurizio 2026-09-22: riunioni ricorrenti/pseudo-
// pazienti che occupano solo uno slot) — "8" Graphite (grigio), mai usato
// altrove (default=confermato, "6" mandarino=da confermare, "3" vinaccia=
// prenotato online): si distingue a vista dagli appuntamenti con pazienti
// veri, e per costruzione non è mai "6" — quindi computeImpattoChiusura/
// esci-da-programmazione non lo propongono mai per la cancellazione
// automatica, solo per la verifica manuale.
export const ALTRO_TIPOLOGIA_COLOR_ID = "8";

// Toglie un'eventuale iniziale di cognome finale ("Francesca F." ->
// "Francesca", "Giovanni D.L." -> "Giovanni") — serve per riconoscere note
// storiche scritte PRIMA che il nome calendario di un paziente venisse
// uniformato al formato "Nome C." (es. pulizia fatta da Maurizio a
// posteriori su più pazienti insieme, non solo su chi ne aveva davvero
// bisogno). Non tocca nomi di coppia ("Nome1 e Nome2"): il pattern richiede
// un token corto (1-6 caratteri, lettere/punti) staccato da uno spazio a
// fine stringa, cosa che un secondo nome proprio normalmente non è.
function baseSenzaInizialeCognome(nome) {
  return normalizeName((nome || "").replace(/\s+[A-Za-zÀ-ÿ.]{1,6}\.?\s*$/, ""));
}

export function matchPatientForEvent(title, patients) {
  const norm = normalizeName(title);
  const exact = patients.find((p) => normalizeName(p.nome_calendario) === norm);
  if (exact) return { patient: exact, confidence: "esatto" };
  const candidates = patients
    .filter((p) => p.nome_calendario && norm.includes(normalizeName(p.nome_calendario)))
    .sort((a, b) => normalizeName(b.nome_calendario).length - normalizeName(a.nome_calendario).length);
  if (candidates.length) return { patient: candidates[0], confidence: "parziale" };

  // Titolo "corto": prova a riconoscerlo come lo stesso paziente scritto
  // senza l'iniziale del cognome, ma SOLO se è l'unico paziente la cui base
  // coincide — se più pazienti condividono la stessa base (es. due
  // "Francesca" diverse, disambiguate solo dall'iniziale), non si indovina.
  const deboli = patients.filter((p) => p.nome_calendario && baseSenzaInizialeCognome(p.nome_calendario) === norm);
  if (deboli.length === 1) return { patient: deboli[0], confidence: "debole" };

  return null;
}

// events: [{data: 'YYYY-MM-DD', titolo: '...'}]
// cancellazioni: righe di `cancellations` per questo paziente (o per tutti,
// vengono filtrate qui) — una data con billing_status='not_charged' non
// conta come seduta, indipendentemente dal fatto che l'evento sia ancora
// fisicamente presente a calendario o già stato rimosso (il pulsante
// "Registra disdette" lo rimuove, ma il conteggio non deve dipendere da
// quel dettaglio implementativo).
// allPatients (facoltativo): l'intera anagrafica, usata per l'abbinamento
// invece del solo `patient` — matchPatientForEvent usa l'ambiguità tra TUTTI
// i pazienti per scartare i match "deboli" quando più di uno condivide la
// stessa base del nome (es. "Francesco All./Man./Mer.", collisioni reali
// trovate il 2026-09-08). Se omesso, ricade sul solo `patient` — comodo per
// i test e gli script one-off dove l'ambiguità non è in gioco, ma i
// chiamanti reali dell'app devono sempre passare l'anagrafica completa.
export function computePatientState(patient, events, settings, cancellazioni = [], allPatients) {
  const roster = allPatients || [patient];
  const matched = events.filter((e) => matchPatientForEvent(e.titolo, roster)?.patient === patient);
  const oggi = todayISO();
  const passate = matched.filter((e) => e.data <= oggi);
  const future = matched.filter((e) => e.data > oggi);

  const nonAddebitate = new Set(
    (cancellazioni || [])
      .filter((c) => c.patient_id === patient.id && c.billing_status === "not_charged")
      .map((c) => c.original_date)
  );

  const usati = passate
    .filter((e) => !patient.ancora_data || e.data >= patient.ancora_data)
    .filter((e) => !nonAddebitate.has(e.data))
    .sort((a, b) => (a.data < b.data ? -1 : 1));

  const count = (patient.ancora_valore || 0) + usati.length;
  const ultimaData = passate.length ? passate.map((e) => e.data).sort().slice(-1)[0] : null;
  const prossimaData = future.length ? future.map((e) => e.data).sort()[0] : null;
  const soglia = patient.soglia_fatturazione || settings.soglia_default;
  const giorniStale = patient.giorni_stale_override || settings.giorni_stale;

  let stato = "senza_sedute";
  if (patient.stato === "sospeso") {
    stato = count > 0 ? "sospeso" : "senza_sedute";
  } else if (patient.stato === "non_fatturato") {
    // Pro bono, supervisioni gratuite, o uno pseudo-paziente che occupa solo
    // uno slot (es. una riunione ricorrente) — mai "pronto per la fattura"
    // né segnalato come "da valutare" per inattività: non c'è una cadenza di
    // fatturazione da rispettare (richiesta di Maurizio 2026-09-22). A
    // differenza di "sospeso", resta visibile anche a zero sedute contate:
    // è spesso lo stato appena impostato la prima volta (nessun evento
    // ancora abbinato), e Maurizio deve poterlo comunque vedere in Dashboard
    // per confermare che è configurato bene (bug reale 2026-09-22: appena
    // creato spariva del tutto, "senza_sedute" non ha una sezione visibile).
    stato = "non_fatturato";
  } else if (patient.stato === "concluso") {
    // Percorso chiuso (es. dopo il primo incontro): mai "in corso" né "da
    // valutare" per inattività. A fine rapporto la soglia non conta: con
    // almeno una seduta non fatturata è sempre "pronto" (richiesta di
    // Maurizio 2026-09-20 — quasi immancabilmente si fattura). Sotto soglia
    // la Dashboard chiede una conferma esplicita prima di generare il file.
    stato = count > 0 ? "pronto" : "senza_sedute";
  } else if (count > 0 && count >= soglia) stato = "pronto";
  else if (count > 0 && ultimaData && daysBetween(ultimaData, oggi) >= giorniStale) stato = "da_valutare";
  else if (count > 0) stato = "in_corso";

  return { count, soglia, ultimaData, prossimaData, usati, stato };
}
