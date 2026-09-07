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

// patientSlot: { weekday, time_of_day, interval_days, anchor_date }
// closures: tutte le righe di slot_closures (vengono filtrate qui per
// weekday+time_of_day, non serve prefiltrarle prima di chiamare).
// Ritorna le date reali (YYYY-MM-DD), ordinate, da oggi a oggi+orizzonteGiorni.
export function occorrenzeFuture(patientSlot, closures, orizzonteGiorni = 60, oggi = todayISO()) {
  const closureDates = (closures || [])
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
      nome: patient.fatturare_a || patient.nome_calendario,
      data: e.data,
      ora: e.ora,
      cancelledAt,
      billingStatus,
    });
  }
  return risultati.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
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
export function computePatientState(patient, events, settings, cancellazioni = []) {
  const matched = events.filter((e) => {
    const m = matchPatientForEvent(e.titolo, [patient]);
    return !!m;
  });
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
export function eventiDiPazienteOrdinati(patient, allEvents) {
  return allEvents
    .filter((e) => !patient.ancora_data || e.data >= patient.ancora_data)
    .filter((e) => matchPatientForEvent(e.titolo, [patient]))
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
export function computeRinumerazione(patient, allEvents, settings) {
  const lettera = letteraCodice(patient);
  const soglia = patient.soglia_fatturazione || settings.soglia_default;
  const eventi = eventiDiPazienteOrdinati(patient, allEvents);

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
