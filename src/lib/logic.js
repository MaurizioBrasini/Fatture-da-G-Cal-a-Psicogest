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

export function matchPatientForEvent(title, patients) {
  const norm = normalizeName(title);
  const exact = patients.find((p) => normalizeName(p.nome_calendario) === norm);
  if (exact) return { patient: exact, confidence: "esatto" };
  const candidates = patients
    .filter((p) => p.nome_calendario && norm.includes(normalizeName(p.nome_calendario)))
    .sort((a, b) => normalizeName(b.nome_calendario).length - normalizeName(a.nome_calendario).length);
  if (candidates.length) return { patient: candidates[0], confidence: "parziale" };
  return null;
}

// events: [{data: 'YYYY-MM-DD', titolo: '...'}]
export function computePatientState(patient, events, settings) {
  const matched = events.filter((e) => {
    const m = matchPatientForEvent(e.titolo, [patient]);
    return !!m;
  });
  const oggi = todayISO();
  const passate = matched.filter((e) => e.data <= oggi);
  const future = matched.filter((e) => e.data > oggi);

  const usati = passate
    .filter((e) => !patient.ancora_data || e.data >= patient.ancora_data)
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

export function formatCodice(lettera, numero, fatturare) {
  return `${lettera}${numero}${fatturare ? " fatturare" : ""}`;
}

// Riconosce un codice scritto in nota, sia nel vecchio formato usato finora
// a mano (np/npa/nf/pc, in un ordine o nell'altro, es. "Np 3", "3 nf",
// "NpA4"), sia nel nuovo formato che scriverà l'app da qui in avanti
// (es. "R4", "A5 fatturare", "S2") — utile per capire quanto testo
// "vecchio" togliere quando si sovrascrive una nota già scritta in
// precedenza (a mano o dall'app in un giro precedente).
const VECCHIO_CODICE_REGEX = /^\s*(?:(?:np|npa|nf|pc)\s*\d+|\d+\s*(?:np|npa|nf|pc)|[ras]\d+(?:\s*fatturare)?)\.?\s*/i;

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
    const codice = formatCodice(lettera, contatore, fatturare);
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
