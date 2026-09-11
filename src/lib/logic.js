// Logica di conteggio e generazione fattura — stessa identica logica già
// validata nell'artefatto, adattata per lavorare con dati letti da Supabase.

export function normalizeName(s) {
  return (s || "")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

// Uniforma il "lettering" di nome_calendario (es. "DAVIDE S." o "MIchela M."
// -> "Davide S.") indipendentemente da come è stato digitato: prima lettera
// di ogni parola maiuscola, resto minuscolo. Due eccezioni per lo stile già
// in uso su questo campo:
// - il connettivo "e" tra due nomi di coppia (es. "Giulia e Daniel") resta
//   sempre minuscolo, mai un'iniziale;
// - le iniziali puntate, anche multiple (es. "S.", "D.L.", "P.G."), restano
//   una lettera maiuscola per segmento — split su "." e ricapitalizza ogni
//   pezzo, così "D.L." resta "D.L." e non diventa "D.l.".
export function titleCaseNomeCalendario(s) {
  return (s || "")
    .toString()
    .trim()
    .split(/\s+/)
    .map((parola) => {
      if (/^e$/i.test(parola)) return "e";
      return parola
        .split(".")
        .map((pezzo) => (pezzo ? pezzo[0].toUpperCase() + pezzo.slice(1).toLowerCase() : pezzo))
        .join(".");
    })
    .join(" ");
}

// Formatta una data ISO (YYYY-MM-DD) in italiano esteso per un testo
// scritto a mano (es. "28 settembre 2026") — usata per personalizzare le
// email in Comunicazioni con la data del prossimo appuntamento di ciascun
// destinatario.
export function formatDataItaliana(dataISO) {
  if (!dataISO) return "";
  const [y, m, d] = dataISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

// Sostituisce i segnaposto [nome] e [data] in un testo scritto da Maurizio
// (Comunicazioni) con i valori del singolo destinatario — mail merge
// minimale, senza sintassi complessa da imparare. Segnaposto non
// riconosciuti restano invariati (non c'è un elenco chiuso da rispettare).
export function personalizzaTesto(testo, { nome, data } = {}) {
  return (testo || "").replaceAll("[nome]", nome || "").replaceAll("[data]", data || "");
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const d1 = new Date(a),
    d2 = new Date(b);
  return Math.round((d2 - d1) / 86400000);
}

export function addDays(dateStr, n) {
  // Aritmetica in UTC puro: evita che il fuso orario locale (l'Italia è
  // sempre avanti rispetto a UTC) faccia "perdere" il giorno aggiunto
  // quando si ritaglia la data con toISOString().slice(0,10).
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// Converte una stringa "YYYY-MM-DD" in un vero oggetto Date a mezzanotte
// locale (non UTC, per evitare che il giorno scali indietro di uno in
// alcuni fusi orari). Serve per scrivere celle di tipo data reali nel file
// Excel — Psicogest si aspetta una data vera, non una stringa di testo.
export function toDateObj(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ---------------------------------------------------------------------
// Generatore di occorrenze per patient_slot (motore appuntamenti,
// sezione 5 di istruzioni-claude-code-appuntamenti.md): calcola le date
// reali di uno slot fisso applicando in cascata le chiusure dello stesso
// slot_key (weekday+ora) — una coppia quindicinale condivide la stessa
// lista di chiusure, quindi la cascata si propaga identica a entrambi
// senza logica differenziata per "chi tocca a chi".
// ---------------------------------------------------------------------

// patientSlot: { weekday, time_of_day, interval_days, anchor_date,
// alternanza_fissa }. closures: tutte le righe di slot_closures (vengono
// filtrate qui per weekday+time_of_day, non serve prefiltrarle prima di
// chiamare). Se il patient_slot ha alternanza_fissa (il suo turno non può
// spostarsi, es. solo 1°/3° lunedì del mese) le chiusure vengono ignorate
// del tutto per questo paziente — resta il ritmo fisso, anche se la stessa
// fascia condivisa da un altro paziente (non fisso) viene invece scalata in
// avanti normalmente: è Maurizio a decidere caso per caso cosa fare
// dell'occorrenza caduta su una data indisponibile.
// Ritorna le date reali (YYYY-MM-DD), ordinate, da oggi a oggi+orizzonteGiorni.
export function occorrenzeFuture(patientSlot, closures, orizzonteGiorni = 60, oggi = todayISO()) {
  const closureDates = patientSlot.alternanza_fissa
    ? []
    : (closures || [])
        .filter((c) => c.weekday === patientSlot.weekday && c.time_of_day === patientSlot.time_of_day)
        .map((c) => c.closure_date)
        .sort();

  const dataLimite = addDays(oggi, orizzonteGiorni);
  const risultati = [];

  let rawDate = patientSlot.anchor_date;
  // La data reale è sempre >= alla grezza (le chiusure spostano solo in
  // avanti): se la grezza supera già il limite possiamo fermarci, la reale
  // lo supererebbe comunque. Il tetto sulle iterazioni è solo un fallback
  // di sicurezza, non dovrebbe mai essere il vincolo attivo in pratica.
  for (let i = 0; i < 1000 && rawDate <= dataLimite; i++) {
    let dataReale = rawDate;
    for (const closureDate of closureDates) {
      if (closureDate <= dataReale) dataReale = addDays(dataReale, 7);
    }
    if (dataReale >= oggi && dataReale <= dataLimite) risultati.push(dataReale);
    rawDate = addDays(rawDate, patientSlot.interval_days);
  }

  return risultati;
}

// ---------------------------------------------------------------------
// Disdette/buche: rilevamento della nota "disdetto" e calcolo automatico
// dello stato di fatturazione (charged/not_charged) dalla soglia di
// preavviso di 48h.
// ---------------------------------------------------------------------

const DISDETTA_REGEX = /disdett/i; // copre "disdetto", "disdetta", "disdette"

// Converte una data+ora "locale Italia" nell'istante UTC corrispondente,
// gestendo correttamente il cambio CET/CEST (doppia conversione: si prova
// un istante, si legge come Google/Intl lo vedrebbe in Europe/Rome, e si
// corregge per la differenza) — necessario perché "updated" arriva da
// Google come timestamp UTC preciso, e va confrontato con l'orario reale
// dell'appuntamento per calcolare le 48h di preavviso, non solo la data.
function romaLocaleToUTC(dateStr, oraStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = (oraStr || "00:00").split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(guess).map((p) => [p.type, p.value]));
  const oraVista = parts.hour === "24" ? 0 : Number(parts.hour);
  const comeSeUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), oraVista, Number(parts.minute), Number(parts.second));
  const offsetMs = comeSeUTC - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

// billing_status di una disdetta: not_charged se la nota è stata scritta
// (cancelledAtISO) almeno 48h prima dell'orario reale della seduta,
// altrimenti charged (include le "buche", cioè le disdette rilevate a
// ridosso o dopo l'appuntamento).
export function calcolaBillingStatus(originalDate, ora, cancelledAtISO) {
  const appuntamento = romaLocaleToUTC(originalDate, ora);
  const cancellato = new Date(cancelledAtISO);
  const preavvisoMs = appuntamento.getTime() - cancellato.getTime();
  return preavvisoMs >= 48 * 3600 * 1000 ? "not_charged" : "charged";
}

// Scandisce gli eventi alla ricerca di note "disdetto" non ancora
// registrate in `cancellations` (dedup per patient_id+data, non sul testo
// della nota — la nota resta sull'evento anche dopo la registrazione).
// Non modifica nulla: restituisce solo i candidati da mostrare in anteprima
// prima che l'utente confermi.
export function computeAggiornamentoPreview(events, patients, cancellazioniEsistenti) {
  const giaRegistrate = new Set((cancellazioniEsistenti || []).map((c) => `${c.patient_id}|${c.original_date}`));
  const risultati = [];
  for (const e of events) {
    if (!DISDETTA_REGEX.test(e.descrizione || "")) continue;
    const match = matchPatientForEvent(e.titolo, patients);
    if (!match) continue; // evento non abbinabile a nessun paziente: da gestire a mano
    const patient = match.patient;
    if (giaRegistrate.has(`${patient.id}|${e.data}`)) continue;
    const cancelledAt = e.updated || new Date().toISOString();
    const billingStatus = calcolaBillingStatus(e.data, e.ora, cancelledAt);
    risultati.push({
      eventId: e.id,
      patientId: patient.id,
      nome: patient.nome_calendario || patient.fatturare_a,
      data: e.data,
      ora: e.ora,
      cancelledAt,
      billingStatus,
    });
  }
  return risultati.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

// Bug reale 2026-09-11: computeAggiornamentoPreview scarta a monte le
// disdette già registrate in `cancellations` (giaRegistrate), assumendo
// implicitamente che l'evento sia già stato cancellato allora. Non è
// sempre vero — se l'evento è stato ricreato DOPO quella registrazione
// (es. da "Genera occorrenze future" prima che skipped_occurrences
// coprisse quella data, o da qualunque altra causa), resta un duplicato
// fisico sul calendario che "Registra disdette" non vedrà mai più, perché
// per lui è già tutto a posto — a prescindere da quante volte si riscriva
// "disdetto" sulla nota e si rilanci il controllo. Confronta invece
// DIRETTAMENTE le cancellations not_charged con il calendario reale (fonte
// di verità), a prescindere dalla nota: propone solo la pulizia
// dell'evento fisico, la disdetta è già registrata correttamente.
export function computeDuplicatiDaRipulire(events, patients, cancellazioniNotCharged) {
  const risultati = [];
  for (const c of cancellazioniNotCharged || []) {
    const patient = patients.find((p) => p.id === c.patient_id);
    if (!patient) continue;
    const eventoReale = events.find(
      (e) => e.data === c.original_date && matchPatientForEvent(e.titolo, patients)?.patient.id === patient.id
    );
    if (!eventoReale) continue;
    risultati.push({
      eventId: eventoReale.id,
      patientId: patient.id,
      nome: patient.nome_calendario || patient.fatturare_a,
      data: c.original_date,
      ora: eventoReale.ora,
    });
  }
  return risultati.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

// Elenco "da confermare" per l'invio del link di riprenotazione: pazienti
// con una disdetta registrata (in `cancellations`, qualunque billing_status:
// anche una buca addebitata va comunque riprenotata) per cui NON risulta
// già un'email di riprenotazione mandata con successo DOPO quella disdetta
// (confronto sui timestamp `created_at`, non un flag — così una disdetta
// successiva alla stessa persona ricompare come nuovo "da confermare" anche
// se una email precedente era già stata inviata). Un solo candidato per
// paziente, con la disdetta più recente. Pazienti senza email non compaiono
// (niente da mandare). Non scrive nulla: solo l'elenco da mostrare prima
// della conferma.
export function computeRiprenotazioniPendenti(cancellazioni, patients, emailRiprenotazioneInviate) {
  const patientsById = Object.fromEntries((patients || []).map((p) => [p.id, p]));
  const ultimoInvioOkPerPaziente = {};
  for (const riga of emailRiprenotazioneInviate || []) {
    const attuale = ultimoInvioOkPerPaziente[riga.patient_id];
    if (!attuale || riga.created_at > attuale) ultimoInvioOkPerPaziente[riga.patient_id] = riga.created_at;
  }
  const perPaziente = {};
  for (const c of cancellazioni || []) {
    const patient = patientsById[c.patient_id];
    if (!patient || !patient.email) continue;
    const ultimoInvio = ultimoInvioOkPerPaziente[c.patient_id];
    if (ultimoInvio && ultimoInvio >= c.created_at) continue; // già mandata dopo questa disdetta
    const esistente = perPaziente[c.patient_id];
    if (!esistente || c.original_date > esistente.data) {
      perPaziente[c.patient_id] = {
        patientId: c.patient_id,
        nome: patient.nome_calendario || patient.fatturare_a,
        email: patient.email,
        data: c.original_date,
        billingStatus: c.billing_status,
      };
    }
  }
  return Object.values(perPaziente).sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
}

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
  } else if (count > 0 && count >= soglia) stato = "pronto";
  else if (count > 0 && ultimaData && daysBetween(ultimaData, oggi) >= giorniStale) stato = "da_valutare";
  else if (count > 0) stato = "in_corso";

  return { count, soglia, ultimaData, prossimaData, usati, stato };
}

// Inverso dello scorporo qui sopra: da un onorario già scorporato del 2%
// ENPAP (il valore salvato in invoice_history) ricostruisce la tariffa
// tonda originale (es. 250€) per mostrarla nelle schermate di storico,
// senza toccare il dato salvato. Unica fonte di verità per questo calcolo:
// usata sia in storico/page.js sia in pazienti/page.js (storico paziente).
export function importoLordoDaOnorario(onorario) {
  return Math.round(onorario * 1.02 * 100) / 100;
}

export function buildInvoiceRow(patient, computed, settings, dataFattura, fatturaID, fatturaNumero) {
  const count = computed.count;

  // Tariffa tonda (es. 80€, 100€) = costo_unitario × numero sedute.
  // Da qui si scorpora l'onorario (imponibile sanitario) in modo che
  // onorario + ENPAP torni esattamente alla cifra tonda, ed eventualmente
  // il bollo (2€ fisso) si aggiunge sopra, senza toccare lo scorporo.
  const tariffa = Math.round(patient.costo_unitario * count * 100) / 100;
  const onorario = Math.round((tariffa / 1.02) * 100) / 100;
  const enpap = Math.round((tariffa - onorario) * 100) / 100;
  const bolloDovuto = tariffa > settings.bollo_soglia;
  const bollo = bolloDovuto ? 2 : 0;
  const totale = Math.round((tariffa + bollo) * 100) / 100;

  const prestazioneMap = {
    individuale: settings.prestazione_individuale,
    coppia: settings.prestazione_coppia,
    consulenza: settings.prestazione_consulenza,
  };
  const prestazioneBase = prestazioneMap[patient.tipologia] || patient.tipologia;
  // Se il paziente è in regime agevolato, lo indichiamo esplicitamente nel
  // testo della prestazione, come già fatto su Psicogest.
  const prestazione =
    patient.regime_tariffario === "agevolata" ? `${prestazioneBase} - tariffa agevolata` : prestazioneBase;
  const date = computed.usati.map((e) => e.data).sort();
  const dal = date[0] || computed.ultimaData || dataFattura;
  const al = date[date.length - 1] || computed.ultimaData || dataFattura;

  const row = {
    pazienteID: patient.codice_fiscale || "",
    // fatturaID è un numero progressivo ≥1 richiesto dal validatore di
    // Psicogest (riferimento interno al file di import, non il numero di
    // fattura definitivo). fatturaNUMERO invece è il vero numero di
    // fattura, che a quanto pare va fornito da noi (Psicogest lo suggerisce
    // ma non lo assegna in automatico durante l'import).
    fatturaID,
    fatturaTIPODOCUMENTO: "fattura",
    fatturaNUMERO: fatturaNumero,
    fatturaANNO: new Date(dataFattura).getFullYear(),
    fatturaDATA: toDateObj(dataFattura),
    fatturaMODOPAGAMENTO: patient.modalita_pagamento || "Bonifico",
    fatturaPRESTAZIONE: prestazione,
    "fatturaIMPONIBILE SANITARIO": onorario,
    fatturaONORARIO: onorario,
    fatturaENPAP: enpap,
    fatturaBOLLO: bollo,
    fatturaBOLLOACARICOPAZ: bolloDovuto ? "si" : "no",
    fatturaTOTALE: totale,
    fatturaTOTALEDAPAGARE: totale,
    fatturaNOTE: `n. ${count} sedute (${prestazione}) - dal ${dal} al ${al}`,
    // fatturaDATAPAGAMENTO va compilata solo quando il paziente ha
    // effettivamente pagato; per ora resta omessa (non stringa vuota, che
    // manderebbe in errore il parser data di Psicogest) e andrà valorizzata
    // in futuro quando implementeremo la gestione dei pagamenti.
    _onorario: onorario,
    _count: count,
    _tariffa: tariffa,
  };

  return row;
}

export const COLUMN_ORDER = [
  "pazienteID",
  "fatturaID",
  "fatturaTIPODOCUMENTO",
  "fatturaNUMERO",
  "fatturaANNO",
  "fatturaDATA",
  "fatturaMODOPAGAMENTO",
  "fatturaPRESTAZIONE",
  "fatturaIMPONIBILE SANITARIO",
  "fatturaONORARIO",
  "fatturaENPAP",
  "fatturaBOLLO",
  "fatturaBOLLOACARICOPAZ",
  "fatturaTOTALE",
  "fatturaTOTALEDAPAGARE",
  "fatturaNOTE",
  "fatturaDATAPAGAMENTO",
];

// Riga per l'import "anagrafica pazienti" di Psicogest (Strumenti → Importa,
// distinto dall'import fatture sopra) — stesse colonne/ordine del file
// d'esempio scaricato da Psicogest (Appunti/Settings/psicogest pazienti.xls).
// Psicogest deduplica per Codice Fiscale/Partita IVA, quindi è sicuro
// riesportare l'anagrafica intera ogni volta: i pazienti già presenti
// vengono semplicemente ignorati.
//
// Solo i campi che abbiamo davvero vengono valorizzati; tutto il resto (ID
// personale, indirizzo, data di nascita, dati fiscali che non teniamo, "Data
// creazione in Psicogest"...) resta fuori dall'oggetto invece di essere
// scritto come stringa vuota — stessa cautela già imparata con
// fatturaDATAPAGAMENTO in buildInvoiceRow, per non rischiare che un parser
// lato Psicogest tratti una cella vuota diversamente da una chiave assente.
export function buildPsicogestAnagraficaRow(patient) {
  const row = {
    Privato: "Privato",
    Saluto: "Gentile",
    Nome: patient.nome || "",
    Cognome: patient.cognome || "",
    Nazione: "Italia",
    "Codice Fiscale": patient.codice_fiscale || "",
    "Opposizione trasm. S.T.S.": "No",
    "Omette R.A.": "No",
    "Cliente P.A.": "No",
    Archiviato: "No",
  };
  if (patient.telefono) row["Telefono 1"] = patient.telefono;
  if (patient.email) row["Email"] = patient.email;
  if (patient.indirizzo) row["Indirizzo 1"] = patient.indirizzo;
  if (patient.localita) row["Località"] = patient.localita;
  if (patient.provincia) row["Provincia"] = patient.provincia;
  if (patient.cap) row["CAP"] = patient.cap;
  if (patient.note) row["Note"] = patient.note;
  return row;
}

export const PSICOGEST_ANAGRAFICA_COLUMN_ORDER = [
  "ID personale",
  "Privato",
  "Saluto",
  "Ragione sociale",
  "Nome",
  "Cognome",
  "Indirizzo 1",
  "Indirizzo 2",
  "Località",
  "Provincia",
  "Telefono 1",
  "Telefono 2",
  "Email",
  "Email 2",
  "Email PEC",
  "CAP",
  "Nazione",
  "Partita IVA",
  "Codice Fiscale",
  "Data nascita",
  "Luogo nascita",
  "Note",
  "Informazioni aggiuntive",
  "Opposizione trasm. S.T.S.",
  "Omette R.A.",
  "Cliente P.A.",
  "Codice dest. SDI",
  "Percentuale R.A.",
  "Percentuale Imponibile per R.A.",
  "Data creazione in Psicogest",
  "Tags",
  "Archiviato",
];

export const DEFAULT_SETTINGS = {
  soglia_default: 5,
  giorni_stale: 60,
  bollo_soglia: 77.47,
  prestazione_individuale: "psicoterapia individuale",
  prestazione_coppia: "psicoterapia di coppia",
  prestazione_consulenza: "consulenza psicologica",
  tariffa_individuale_regolare: 80,
  tariffa_individuale_agevolata: 50,
  tariffa_coppia_regolare: 100,
  tariffa_coppia_agevolata: 60,
  tariffa_consulenza_regolare: 80,
  tariffa_consulenza_agevolata: 50,
  ultimo_numero_fattura: null,
  email_mittente_nome: "Dr. Maurizio Brasini",
  email_mittente_indirizzo: "maurizio.brasini@psiconet.it",
  link_prenotazioni_online: "https://calendar.app.google/eWXK76xeVknxzeM86",
  link_comunicazioni: "https://calendar.app.google/cYP4PBewfvmv4rKV9",
};

export function tariffaStandard(tipologia, regime, settings) {
  const key = `tariffa_${tipologia}_${regime === "agevolata" ? "agevolata" : "regolare"}`;
  return settings[key] ?? 0;
}

// ---------------------------------------------------------------------
// Numerazione sedute su Google Calendar (R/A/S + numero progressivo)
// ---------------------------------------------------------------------

// Lettera del codice, dedotta dai dati che il paziente ha già in anagrafica
// (nessun dato nuovo da inserire a mano): S ha priorità perché uno stato
// "sospeso" prevale sul regime tariffario.
export function letteraCodice(patient) {
  if (patient.stato === "sospeso") return "S";
  return patient.regime_tariffario === "agevolata" ? "A" : "R";
}

// contanteDovuto (facoltativo): quando il paziente ha un saldo contanti non
// fatturato ancora da saldare, viene aggiunto in coda al codice — es.
// "R3 (deve 150€)" — così resta visibile su Google Calendar senza doverlo
// scrivere/cancellare a mano ad ogni seduta.
export function formatCodice(lettera, numero, fatturare, contanteDovuto) {
  const base = `${lettera}${numero}${fatturare ? " fatturare" : ""}`;
  return contanteDovuto > 0 ? `${base} (deve ${formatEuro(contanteDovuto)}€)` : base;
}

function formatEuro(n) {
  const arrotondato = Math.round(n * 100) / 100;
  return Number.isInteger(arrotondato) ? String(arrotondato) : arrotondato.toFixed(2).replace(".", ",");
}

// Riconosce un codice scritto in nota, sia nel vecchio formato usato finora
// a mano (np/npa/nf/pc, in un ordine o nell'altro, es. "Np 3", "3 nf",
// "NpA4"), sia nel nuovo formato che scriverà l'app da qui in avanti
// (es. "R4", "A5 fatturare", "S2", con l'eventuale "(deve 150€)" in coda)
// — utile per capire quanto testo "vecchio" togliere quando si sovrascrive
// una nota già scritta in precedenza (a mano o dall'app in un giro
// precedente).
const VECCHIO_CODICE_REGEX = /^\s*(?:(?:np|npa|nf|pc)\s*\d+|\d+\s*(?:np|npa|nf|pc)|[ras]\d+(?:\s*fatturare)?)\s*(?:\(deve\s*[\d.,]+\s*€?\))?\.?\s*/i;

export function stripCodiceEsistente(descrizione) {
  return (descrizione || "").replace(VECCHIO_CODICE_REGEX, "");
}

export function buildNuovaDescrizione(descrizioneOriginale, codice) {
  const resto = stripCodiceEsistente(descrizioneOriginale).trim();
  return resto ? `${codice} ${resto}` : codice;
}

// Dati tutti gli eventi del calendario (di qualunque paziente, passati e
// futuri), restituisce solo quelli abbinati a questo specifico paziente,
// dalla sua ancora_data in poi, in ordine cronologico — la stessa identica
// logica di abbinamento già usata per il conteggio (matchPatientForEvent),
// solo senza il filtro "solo sedute passate" che usa computePatientState.
// allPatients (facoltativo): vedi nota su computePatientState — l'intera
// anagrafica serve per disambiguare correttamente, ricade su [patient] se
// omesso.
export function eventiDiPazienteOrdinati(patient, allEvents, allPatients) {
  const roster = allPatients || [patient];
  return allEvents
    .filter((e) => !patient.ancora_data || e.data >= patient.ancora_data)
    .filter((e) => matchPatientForEvent(e.titolo, roster)?.patient === patient)
    .sort((a, b) => {
      if (a.data !== b.data) return a.data < b.data ? -1 : 1;
      return (a.ora || "") < (b.ora || "") ? -1 : (a.ora || "") > (b.ora || "") ? 1 : 0;
    });
}

// Riconoscimento "largo" di un possibile vecchio codice manuale non ancora
// coperto da VECCHIO_CODICE_REGEX — usato SOLO per la prova a vuoto di
// controllo (mai per decidere cosa scrivere): lettere+numero o numero+lettere
// nelle primissime posizioni della nota, es. "NF2", "3pc", "Ctr 4". Limitato a
// 3 lettere (la sigla più lunga già in uso, "npa", ne ha 3) per non prendere
// per un codice normali parole italiane brevi come "Deve" (4 lettere).
const POSSIBILE_CODICE_REGEX = /^\s*(?:[a-zA-Z]{1,3}\s*\d{1,3}\b|\d{1,3}\s*[a-zA-Z]{1,3}\b)/;

// Parole italiane comuni, brevi (≤3 lettere), che possono comparire a inizio
// nota seguite da un numero in una frase normale (es. "Ore 15", "Dal 3") —
// escluse esplicitamente perché altrimenti il pattern sopra le scambierebbe
// per un codice.
const PAROLE_COMUNI_ESCLUSE = new Set([
  "il", "lo", "la", "un", "e", "di", "da", "in", "su", "al", "ai", "dal",
  "dai", "col", "coi", "che", "chi", "ore", "ora", "sig", "dr",
]);

// Applica stripCodiceEsistente a una nota e segnala se il testo sembra
// contenere un codice all'inizio (pattern lettere+numero o numero+lettere)
// che però non è stato riconosciuto/rimosso — utile per una prova a vuoto
// (sola lettura) su tutto lo storico prima di fidarsi ciecamente di
// "Rinumera tutti" su note mai controllate.
export function analizzaNotaPerAudit(descrizioneOriginale) {
  const originale = descrizioneOriginale || "";
  const dopoStrip = stripCodiceEsistente(originale);
  const primaParola = (originale.match(/^\s*([a-zA-Z]+)/) || [])[1];
  const sembraParolaComune = primaParola && PAROLE_COMUNI_ESCLUSE.has(primaParola.toLowerCase());
  const sembraCodiceNonRiconosciuto =
    dopoStrip === originale && POSSIBILE_CODICE_REGEX.test(originale) && !sembraParolaComune;
  return { originale, dopoStrip, cambiata: dopoStrip !== originale, sospetta: sembraCodiceNonRiconosciuto };
}

// Calcola, per un paziente, il piano di aggiornamento delle note calendario:
// una riga per ciascun evento (passato non ancora fatturato + futuro già
// generato), con il codice che dovrebbe avere. Per i pazienti NON sospesi,
// il conteggio riparte da 1 ("fatturare") ogni volta che raggiunge la
// soglia — una proiezione che assume che la fattura verrà confermata subito
// dopo quella seduta. Per i pazienti sospesi, accumula senza mai azzerarsi
// (nessuna fatturazione periodica prevista per loro).
// allPatients (facoltativo): vedi nota su computePatientState — l'intera
// anagrafica serve per disambiguare correttamente, ricade su [patient] se
// omesso.
export function computeRinumerazione(patient, allEvents, settings, allPatients) {
  const lettera = letteraCodice(patient);
  const soglia = patient.soglia_fatturazione || settings.soglia_default;
  const eventi = eventiDiPazienteOrdinati(patient, allEvents, allPatients);

  let contatore = patient.ancora_valore || 0;
  const piano = [];

  for (const ev of eventi) {
    contatore += 1;
    const fatturare = lettera !== "S" && contatore >= soglia;
    const codice = formatCodice(lettera, contatore, fatturare, patient.contante_dovuto);
    const descrizioneNuova = buildNuovaDescrizione(ev.descrizione, codice);
    piano.push({
      id: ev.id,
      data: ev.data,
      ora: ev.ora,
      titolo: ev.titolo,
      numero: contatore,
      fatturare,
      codice,
      descrizioneOriginale: ev.descrizione || "",
      descrizioneNuova,
      cambia: descrizioneNuova !== (ev.descrizione || ""),
    });
    if (fatturare) contatore = 0; // riparte da 1 alla seduta successiva
  }

  return piano;
}

// ---------------------------------------------------------------------
// Prenotazioni online (Google Calendar Appointment Schedule): riconoscimento
// e abbinamento delle prenotazioni fatte dal link "Prenotazioni online dr.
// Brasini" — usato per supervisioni/consulenze estemporanee, pazienti fuori
// schema che riprenotano prima del prossimo appuntamento pianificato, e
// primi colloqui di nuovi pazienti (sezione C del piano di lavoro, vedi
// memoria "appuntamenti-engine-spec"). Questi eventi NON generano mai un
// patient_slot: restano sempre singole occorrenze isolate da abbinare/
// contare, mai una base per generare automaticamente occorrenze future.
// ---------------------------------------------------------------------

export const BOOKING_TITLE_REGEX = /^Prenotazioni online dr\.\s*Brasini/i;
// colorId "3" = Uva/Grape ("vinaccia") — Maurizio lo usa apposta per notare
// a colpo d'occhio, su Google Calendar, quali appuntamenti sono arrivati dal
// link di prenotazione invece che decisi da lui; resta permanente anche dopo
// la riconciliazione (mai confuso col bottone confermato/da confermare, che
// va disattivato per questi eventi).
export const BOOKING_COLOR_ID = "3";

// Estrae nome ed email di chi ha prenotato dalla descrizione che Google
// scrive in automatico sull'evento ("<b>Prenotato da</b>\nNome\nemail").
export function parseBookingInfo(descrizione) {
  const testo = (descrizione || "").replace(/<[^>]+>/g, "\n");
  const righe = testo.split("\n").map((r) => r.trim()).filter(Boolean);
  const idx = righe.findIndex((r) => /prenotato da/i.test(r));
  if (idx < 0) return { nome: null, email: null };
  const nome = righe[idx + 1] || null;
  const possibileEmail = righe[idx + 2] || null;
  return { nome, email: possibileEmail && possibileEmail.includes("@") ? possibileEmail.toLowerCase() : null };
}

function tokenizzaNome(s) {
  return normalizeName(s).split(" ").filter(Boolean);
}

// Abbina chi ha prenotato online (nome libero + email) a un paziente già in
// anagrafica, usando nome/cognome VERI (non l'abbreviazione nome_calendario,
// che chi prenota non conosce) più l'email se già salvata su un paziente da
// una riconciliazione precedente. confidence: "forte" (email combacia, o
// nome E cognome combaciano su un unico paziente), "debole" (un solo token —
// solo nome o solo cognome — combacia su un unico paziente), "ambiguo" (più
// candidati, nessuna scelta automatica), null (nessun candidato).
export function matchBookingToPatient(bookerNome, bookerEmail, patients) {
  const emailNorm = (bookerEmail || "").trim().toLowerCase();
  if (emailNorm) {
    const perEmail = patients.filter((p) => (p.email || "").trim().toLowerCase() === emailNorm);
    if (perEmail.length === 1) return { patient: perEmail[0], confidence: "forte", candidati: [] };
  }

  const tokens = tokenizzaNome(bookerNome);
  if (!tokens.length) return { patient: null, confidence: null, candidati: [] };

  const scored = patients
    .map((p) => {
      const nomeTok = tokenizzaNome(p.nome);
      const cognomeTok = tokenizzaNome(p.cognome);
      const haNome = nomeTok.length > 0 && nomeTok.every((t) => tokens.includes(t));
      const haCognome = cognomeTok.length > 0 && cognomeTok.every((t) => tokens.includes(t));
      return { patient: p, haNome, haCognome };
    })
    .filter((s) => s.haNome || s.haCognome);

  const forti = scored.filter((s) => s.haNome && s.haCognome);
  if (forti.length === 1) return { patient: forti[0].patient, confidence: "forte", candidati: [] };
  if (forti.length > 1) return { patient: null, confidence: "ambiguo", candidati: forti.map((s) => s.patient) };
  if (scored.length === 1) return { patient: scored[0].patient, confidence: "debole", candidati: [] };
  if (scored.length > 1) return { patient: null, confidence: "ambiguo", candidati: scored.map((s) => s.patient) };
  return { patient: null, confidence: null, candidati: [] };
}

// Scandisce gli eventi alla ricerca delle prenotazioni online (titolo +
// eventualmente colore), le abbina se possibile e le classifica in 4 gruppi:
// "pronte" (paziente trovato E nome_calendario già impostato: pronte a
// rinominare+rinumerare), "inAttesa" (paziente trovato ma nome_calendario
// ancora da scegliere), "ambigue" (più candidati, scelta manuale), "nuove"
// (nessun paziente esistente combacia). Non scrive nulla: la correzione del
// colore e le scritture vere restano a carico della route chiamante.
export function computePrenotazioniPreview(events, patients) {
  const righe = events
    .filter((e) => BOOKING_TITLE_REGEX.test(e.titolo || ""))
    .map((e) => {
      const { nome: bookerNome, email: bookerEmail } = parseBookingInfo(e.descrizione);
      const match = matchBookingToPatient(bookerNome, bookerEmail, patients);
      return {
        eventId: e.id,
        data: e.data,
        ora: e.ora,
        titoloAttuale: e.titolo,
        colorId: e.colorId,
        bookerNome,
        bookerEmail,
        patientId: match.patient?.id || null,
        patientNome: match.patient ? match.patient.nome_calendario || null : null,
        confidence: match.confidence,
        candidati: (match.candidati || []).map((p) => ({
          id: p.id,
          nome: p.nome_calendario || `${p.nome || ""} ${p.cognome || ""}`.trim(),
        })),
      };
    })
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  return {
    pronte: righe.filter((r) => r.patientId && r.patientNome),
    inAttesa: righe.filter((r) => r.patientId && !r.patientNome),
    ambigue: righe.filter((r) => !r.patientId && r.confidence === "ambiguo"),
    nuove: righe.filter((r) => !r.patientId && r.confidence !== "ambiguo"),
  };
}

// ---------------------------------------------------------------------
// Chiusure/indisponibilità (ferie, mezze giornate, weekend lunghi): quando
// Maurizio stesso non è disponibile, le occorrenze future degli slot fissi
// coinvolti slittano in avanti (occorrenzeFuture già lo fa); quando è il
// paziente a disdire, invece, NON deve scattare nessuno slittamento — resta
// tutto com'è, si applica solo il normale flusso "Registra disdette".
// ---------------------------------------------------------------------

// Trova le chiusure DA REGISTRARE per una finestra continua da
// dataInizio+oraInizio a dataFine+oraFine (es. "da lunedì 23 ore 7 a
// domenica 29 ore 22"): non "ogni fascia il cui orario nominale rientra
// nella finestra" (bug reale 2026-09-10 — vedi sotto), ma SOLO le fasce per
// cui esiste già un appuntamento VERO sul calendario che cade dentro la
// finestra. Un paziente il cui slot orario rientrerebbe teoricamente nella
// finestra ma che quel giorno non ha nessun appuntamento reale (perché ha
// disdetto per conto suo in un momento qualsiasi prima d'ora — disdetta del
// paziente, mai motivo di slittamento) NON viene toccato: la sua fascia non
// entra nemmeno nel calcolo. Una riga per ogni (fascia, data) con un vero
// conflitto — una coppia alternata che condivide la stessa fascia in
// scadenza a settimane diverse può quindi generare più righe sulla stessa
// fascia, una per ciascuna data realmente occupata nella finestra.
//
// Bug reale scoperto testando con Maurizio: chiudendo "giovedì dalle 14:30"
// la versione precedente (che guardava solo l'orario nominale della fascia)
// coinvolgeva anche pazienti il cui vero appuntamento quel giorno non
// esisteva affatto (avevano già disdetto loro, per conto proprio, in
// momenti diversi e scollegati) — solo chi aveva DAVVERO un appuntamento
// nella finestra (e chi condivide la sua stessa fascia, es. l'altro membro
// di un'alternanza) deve essere coinvolto.
export function rilevaConflittiChiusura(patientSlots, patients, allEvents, { dataInizio, oraInizio, dataFine, oraFine, note }) {
  const slotByPatientId = Object.fromEntries((patientSlots || []).filter((s) => s.active).map((s) => [s.patient_id, s]));
  const viste = new Set();
  const conflitti = [];

  for (const e of allEvents || []) {
    if (e.data < dataInizio || e.data > dataFine) continue;
    const ora = e.ora || "";
    if (e.data === dataInizio && oraInizio && ora < oraInizio) continue;
    if (e.data === dataFine && oraFine && ora >= oraFine) continue;

    const match = matchPatientForEvent(e.titolo, patients);
    if (!match) continue;
    const slot = slotByPatientId[match.patient.id];
    if (!slot) continue; // paziente senza slot fisso (fuori schema/consulenza): fuori da questo meccanismo

    const chiave = `${slot.weekday}|${slot.time_of_day}|${e.data}`;
    if (viste.has(chiave)) continue;
    viste.add(chiave);
    conflitti.push({
      weekday: slot.weekday,
      time_of_day: slot.time_of_day,
      closure_date: e.data,
      note: note || null,
      eventId: e.id,
      patientId: match.patient.id,
      nome: match.patient.nome_calendario,
      ora: e.ora,
    });
  }
  return conflitti;
}

// Dato l'insieme di chiusure aggiornato (comprese quelle appena proposte) e
// gli eventi reali del calendario, trova — SOLO per gli slot fissi la cui
// fascia weekday+ora è davvero coinvolta dalle chiusure appena proposte
// (`nuoveFasce`) — gli eventi già creati che non corrispondono più alle
// date corrette ricalcolate: "daCancellare" se ancora "da confermare"
// (colorId "6", mai stati confermati col paziente), "daVerificare" se hanno
// un altro colore (già confermati, o prenotati online) — questi ultimi non
// vanno MAI proposti per la cancellazione automatica, solo segnalati perché
// Maurizio li gestisca a mano. Segnala anche gli slot con alternanza_fissa
// coinvolti, perché lì lo slittamento non si applica.
// IMPORTANTE: qualunque slot la cui fascia NON è in nuoveFasce va escluso a
// monte, non solo "non ricalcolato" — il suo occorrenzeFuture è
// matematicamente identico con o senza questa chiusura (il filtro closures
// dentro occorrenzeFuture è per weekday+time_of_day), quindi ricontrollarlo
// qui non potrebbe mai trovare un'incoerenza dovuta a QUESTA chiusura — solo
// scarti storici preesistenti e non correlati tra anchor_date/interval_days
// e il calendario reale (bug reale scoperto 2026-09-10: chiudendo un solo
// giorno/fascia, la prima versione proponeva la cancellazione di eventi di
// pazienti/date completamente estranei, su settimane diverse, solo perché
// il loro ricalcolo "da zero" non coincideva col calendario per altri
// motivi — niente a che vedere con la chiusura appena inserita).
export function computeImpattoChiusura(patientSlots, patients, allEvents, closures, nuoveChiusure, orizzonteGiorni, oggi) {
  const patientsById = Object.fromEntries(patients.map((p) => [p.id, p]));
  const nuoveFasce = new Set((nuoveChiusure || []).map((c) => `${c.weekday}|${c.time_of_day}`));
  const dataLimite = addDays(oggi, orizzonteGiorni);
  const daCancellare = [];
  const daVerificare = [];
  const alternanzaCoinvolta = [];

  for (const slot of patientSlots || []) {
    if (!slot.active) continue;
    if (!nuoveFasce.has(`${slot.weekday}|${slot.time_of_day}`)) continue;
    const patient = patientsById[slot.patient_id];
    if (!patient || !patient.nome_calendario) continue;

    if (slot.alternanza_fissa) {
      alternanzaCoinvolta.push({ patientId: patient.id, nome: patient.nome_calendario });
      continue;
    }

    const dateCorrette = new Set(occorrenzeFuture(slot, closures, orizzonteGiorni, oggi));
    const eventiPaziente = allEvents.filter(
      (e) =>
        e.data > oggi &&
        e.data <= dataLimite &&
        matchPatientForEvent(e.titolo, patients)?.patient.id === patient.id
    );
    for (const ev of eventiPaziente) {
      if (dateCorrette.has(ev.data)) continue;
      const riga = { eventId: ev.id, patientId: patient.id, nome: patient.nome_calendario, data: ev.data, ora: ev.ora, colorId: ev.colorId };
      // Solo "da confermare" (mandarino) entra in proposta di cancellazione
      // automatica: mai toccati in automatico gli eventi già confermati col
      // paziente (colore di default) o prenotati online (vinaccia) — quelli
      // vanno sempre e solo segnalati per la gestione manuale di Maurizio.
      if (ev.colorId === "6") daCancellare.push(riga);
      else daVerificare.push(riga);
    }
  }

  return { daCancellare, daVerificare, alternanzaCoinvolta };
}

// Date attese (occorrenzeFuture) per ogni slot fisso attivo che NON hanno
// già un evento reale sul calendario. Bug reale 2026-09-11 (Alessandra C.,
// Flavia e Edoardo, Clara e Christian ricomparsi più volte): prima
// qualunque data "assente" veniva proposta per la creazione automatica,
// senza distinguere "non è mai esistita" da "esisteva ed è stata cancellata
// direttamente su Google Calendar, senza passare da nessun flusso
// dell'app" — quest'ultimo caso NON va mai ricreato in automatico, è quasi
// sempre una disdetta reale mai registrata. Serve quindi un terzo insieme,
// `generatedSet` (patient_id|data di ogni occorrenza MAI creata da "Genera
// occorrenze future", a prescindere da cosa ne è stato poi), per
// distinguere le due situazioni:
// - "mancanti": mai generata prima — sicura da proporre.
// - "anomale": generata in passato, ora assente, MAI esplicitamente
//   skippata — sospetta, va segnalata per una decisione esplicita
//   (ricreare, o confermare che è una disdetta e va lasciata libera).
// Una data skippata (skippedSet) è sempre esclusa da entrambi gli insiemi,
// qualunque sia la sua storia: è già stata gestita.
export function computeOccorrenzeDaGenerare(slots, patients, events, closures, skippedSet, generatedSet, giorniAvanti, oggi) {
  const patientsById = Object.fromEntries(patients.map((p) => [p.id, p]));
  const mancanti = [];
  const anomale = [];

  for (const slot of slots || []) {
    if (!slot.active) continue;
    const patient = patientsById[slot.patient_id];
    if (!patient || !patient.nome_calendario) continue;

    const date = occorrenzeFuture(slot, closures, giorniAvanti, oggi);
    const eventoDiQuestoPaziente = (e) => matchPatientForEvent(e.titolo, patients)?.patient.id === patient.id;
    const eventoRecente = events
      .filter((e) => eventoDiQuestoPaziente(e) && e.ora)
      .sort((a, b) => (a.data < b.data ? 1 : -1))[0];
    const durataMinuti = eventoRecente?.durataMinuti || 60;
    const ora = slot.time_of_day.slice(0, 5);
    const nome = patient.nome_calendario || patient.fatturare_a;

    const dateMancanti = [];
    for (const d of date) {
      if (d <= oggi) continue;
      if (events.some((e) => e.data === d && eventoDiQuestoPaziente(e))) continue; // presente, niente da fare
      if (skippedSet.has(`${patient.id}|${d}`)) continue; // esplicitamente gestita
      if (generatedSet.has(`${patient.id}|${d}`)) {
        anomale.push({ patientId: patient.id, nome, data: d, ora, durataMinuti });
      } else {
        dateMancanti.push(d);
      }
    }
    if (dateMancanti.length) mancanti.push({ patientId: patient.id, nome, ora, durataMinuti, date: dateMancanti });
  }

  return { mancanti, anomale };
}

// ---------------------------------------------------------------------
// Quota in contanti non fatturata (es. paziente che paga 60€ in fattura +
// 10€ a parte in contanti, mai su Psicogest) — si accumula da sola ad ogni
// fattura confermata, ed è saldabile anche parzialmente.
// ---------------------------------------------------------------------

// Quanto si aggiunge al saldo dovuto quando si conferma una fattura di
// "sedute" sessioni per un paziente con una quota_contante_seduta fissa.
export function accumulaContante(dovutoAttuale, quotaContanteSeduta, sedute) {
  return Math.round(((dovutoAttuale || 0) + (quotaContanteSeduta || 0) * sedute) * 100) / 100;
}

// Sottrae un incasso (anche parziale) dal saldo dovuto, senza mai andare
// sotto zero.
export function saldaContante(dovutoAttuale, importoPagato) {
  return Math.max(0, Math.round(((dovutoAttuale || 0) - (importoPagato || 0)) * 100) / 100);
}
