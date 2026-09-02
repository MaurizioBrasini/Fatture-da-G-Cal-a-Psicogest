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
  const usati = matched
    .filter((e) => !patient.ancora_data || e.data > patient.ancora_data)
    .sort((a, b) => (a.data < b.data ? -1 : 1));

  const count = (patient.ancora_valore || 0) + usati.length;
  const ultimaData = matched.length ? matched.map((e) => e.data).sort().slice(-1)[0] : null;
  const soglia = patient.soglia_fatturazione || settings.soglia_default;
  const giorniStale = patient.giorni_stale_override || settings.giorni_stale;

  let stato = "senza_sedute";
  if (count > 0 && count >= soglia) stato = "pronto";
  else if (count > 0 && ultimaData && daysBetween(ultimaData, todayISO()) >= giorniStale) stato = "da_valutare";
  else if (count > 0) stato = "in_corso";

  return { count, soglia, ultimaData, usati, stato };
}

export function buildInvoiceRow(patient, computed, settings, dataFattura, fatturaID) {
  const count = computed.count;
  const onorario = Math.round(patient.costo_unitario * count * 100) / 100;
  const bolloDovuto = onorario > settings.bollo_soglia;
  const prestazioneMap = {
    individuale: settings.prestazione_individuale,
    coppia: settings.prestazione_coppia,
    consulenza: settings.prestazione_consulenza,
  };
  const prestazione = prestazioneMap[patient.tipologia] || patient.tipologia;
  const date = computed.usati.map((e) => e.data).sort();
  const dal = date[0] || computed.ultimaData || dataFattura;
  const al = date[date.length - 1] || computed.ultimaData || dataFattura;

  return {
    pazienteID: patient.codice_fiscale || "",
    fatturaID,
    fatturaTIPODOCUMENTO: "fattura",
    fatturaNUMERO: "",
    fatturaANNO: new Date(dataFattura).getFullYear(),
    fatturaDATA: dataFattura,
    fatturaMODOPAGAMENTO: patient.modalita_pagamento || "Bonifico",
    fatturaPRESTAZIONE: prestazione,
    "fatturaIMPONIBILE SANITARIO": onorario,
    fatturaONORARIO: onorario,
    fatturaENPAP: "",
    fatturaBOLLO: "",
    fatturaBOLLOACARICOPAZ: bolloDovuto ? "si" : "no",
    fatturaTOTALE: "",
    fatturaTOTALEDAPAGARE: "",
    fatturaNOTE: `n. ${count} sedute (${prestazione}) - dal ${dal} al ${al}`,
    fatturaDATAPAGAMENTO: "",
    _onorario: onorario,
    _count: count,
  };
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
};
