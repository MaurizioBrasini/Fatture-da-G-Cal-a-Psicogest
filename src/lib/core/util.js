// Utilità di base: normalizzazione nomi, formattazione testi, aritmetica sulle date.

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
