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
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
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

export function buildInvoiceRow(patient, computed, settings, dataFattura, fatturaID) {
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
  const prestazione = prestazioneMap[patient.tipologia] || patient.tipologia;
  const date = computed.usati.map((e) => e.data).sort();
  const dal = date[0] || computed.ultimaData || dataFattura;
  const al = date[date.length - 1] || computed.ultimaData || dataFattura;

  const row = {
    pazienteID: patient.codice_fiscale || "",
    // fatturaID è un numero progressivo ≥1 richiesto dal validatore di
    // Psicogest (riferimento interno al file di import, non il numero di
    // fattura definitivo). fatturaNUMERO invece resta vuoto: quello lo
    // assegna Psicogest stesso in formato nnn/anno.
    fatturaID,
    fatturaTIPODOCUMENTO: "fattura",
    fatturaNUMERO: "",
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
};

export function tariffaStandard(tipologia, regime, settings) {
  const key = `tariffa_${tipologia}_${regime === "agevolata" ? "agevolata" : "regolare"}`;
  return settings[key] ?? 0;
}
