// Fatturazione: righe Excel per Psicogest, anagrafica Psicogest, tariffe e impostazioni di default.
import { toDateObj } from "./util.js";

// Inverso dello scorporo qui sopra: da un onorario già scorporato del 2%
// ENPAP (il valore salvato in invoice_history) ricostruisce la tariffa
// tonda originale (es. 250€) per mostrarla nelle schermate di storico,
// senza toccare il dato salvato. Unica fonte di verità per questo calcolo:
// usata sia in storico/page.js sia in pazienti/page.js (storico paziente).
export function importoLordoDaOnorario(onorario) {
  return Math.round(onorario * 1.02 * 100) / 100;
}

// IBAN dello studio, stampato sulle fatture pagate con bonifico. Nelle fatture
// fatte a mano su Psicogest (es. 141) compare nel blocco "Coordinate
// bancarie", ma lo schema di import fatture non ha nessuna colonna per
// questo campo: l'unico posto dove può viaggiare è fatturaNOTE.
export const IBAN_STUDIO = "IT16D0305801604100572116459";

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
    supervisione: settings.prestazione_supervisione,
  };
  const prestazioneBase = prestazioneMap[patient.tipologia] || patient.tipologia;
  // Se il paziente è in regime agevolato, lo indichiamo esplicitamente nel
  // testo della prestazione, come già fatto su Psicogest.
  const prestazione =
    patient.regime_tariffario === "agevolata" ? `${prestazioneBase} - tariffa agevolata` : prestazioneBase;
  // L'import Psicogest non ha campi Quantità/Prezzo unitario separati (solo
  // un onorario forfettario per fattura): Psicogest mette sempre Quantità=1
  // sulla riga della fattura, quindi il numero di sedute non ci comparirebbe
  // da nessuna parte se non lo mettiamo qui, nella Descrizione stessa.
  const prestazioneRiga = `${count} sedute di ${prestazione}`;
  const date = computed.usati.map((e) => e.data).sort();
  const dal = date[0] || computed.ultimaData || dataFattura;
  const al = date[date.length - 1] || computed.ultimaData || dataFattura;

  const modoPagamento = patient.modalita_pagamento || "Bonifico";
  const noteSedute =
    dal === al
      ? `n. ${count} sedute (${prestazione}) - il ${dal}`
      : `n. ${count} sedute (${prestazione}) - dal ${dal} al ${al}`;
  // L'IBAN serve solo a chi paga con bonifico (le fatture in contanti, come
  // la 140, non hanno le coordinate bancarie).
  const note = /bonifico/i.test(modoPagamento)
    ? `${noteSedute} - Coordinate bancarie: ${IBAN_STUDIO}`
    : noteSedute;

  const row = {
    pazienteID: (patient.codice_fiscale || "").trim(),
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
    fatturaMODOPAGAMENTO: modoPagamento,
    fatturaPRESTAZIONE: prestazioneRiga,
    "fatturaIMPONIBILE SANITARIO": onorario,
    fatturaONORARIO: onorario,
    fatturaENPAP: enpap,
    fatturaBOLLO: bollo,
    // "no" = bollo assolto sulla copia conservata dal professionista, come
    // nelle fatture 140/141 (corrette, precedenti all'app). Con "si"
    // Psicogest applica invece l'ENPAP sul bollo pieno (2,00€) anziché
    // scorporato (1,96€), sballando il totale di 4 centesimi rispetto alla
    // tariffa tonda attesa (es. 502,04 invece di 502,00) — verificato
    // confrontando byte-per-byte i totali delle fatture 140/141 con 145/146.
    fatturaBOLLOACARICOPAZ: "no",
    fatturaTOTALE: totale,
    fatturaTOTALEDAPAGARE: totale,
    fatturaNOTE: note,
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
// distinto dall'import fatture sopra) — colonne/ordine del vero modello di
// importazione di Psicogest (Appunti/Settings/esempio_importazione_pazienti,
// arrivato da Maurizio come .zip), NON quelle di un file di export "umano"
// (tentativo precedente, mai testato, fallito al primo import reale con
// "ID paziente vuoto" su ogni riga: l'export e l'import hanno schemi
// diversi, esattamente come già successo con le fatture).
//
// pazienteID va valorizzato con CF (o PIVA per le aziende, che non
// gestiamo), ripetuto identico anche in pazienteCF — istruzione esplicita
// nel file d'esempio di Psicogest. Nazione vuole il codice ISO ("IT"), non
// il nome per esteso. Privato/Opposizione trasm. S.T.S. sono stringhe
// "s"/"n", non "Privato"/"No" come nel formato di export.
//
// Solo i campi che abbiamo davvero vengono valorizzati; tutto il resto
// (Ragione sociale, PIVA, data/luogo di nascita, telefono 2...) resta fuori
// dall'oggetto invece di essere scritto come stringa vuota — stessa cautela
// già imparata con fatturaDATAPAGAMENTO in buildInvoiceRow.
//
// Il validatore di Psicogest è rigido su telefono/CAP/email: "+39", spazi
// nel telefono ("+39 393 917 4851") e CAP con lettere ("2311XX", indirizzo
// estero nei Paesi Bassi — i CAP olandesi hanno davvero delle lettere,
// incompatibili con un campo italiano "solo numeri") mandano in errore
// l'intera riga. Anziché rimandare dati sporchi e far fallire l'import, li
// ripuliamo o li omettiamo qui — stessa logica di "chiave assente invece di
// dato invalido" già usata sopra.
//
// Telefono: il prefisso internazionale "+39" va tolto del tutto (non solo
// gli spazi) — Psicogest vuole evidentemente il numero in formato
// nazionale puro, cifre senza "+". Per prefissi esteri diversi da +39 (un
// solo paziente, vive in Germania) non abbiamo un formato nazionale da
// ricostruire: teniamo solo le cifre, "+" compreso, meglio di niente.
function soloNumeri(s) {
  return String(s).replace(/\D/g, "");
}
function normalizzaTelefono(raw) {
  const t = raw.trim().replace(/^\+39\s*/, "");
  return soloNumeri(t);
}
function emailValida(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
export function buildPsicogestAnagraficaRow(patient) {
  const cf = patient.codice_fiscale || "";
  const row = {
    pazienteID: cf,
    // Maurizio preferisce Nome/Cognome in maiuscolo su Psicogest (es.
    // "EDOARDO GRILLO"), anche se in anagrafica app restano in maiuscolo
    // solo iniziale — tocca solo questo export, non patients.nome/cognome.
    pazienteNOME: (patient.nome || "").toLocaleUpperCase("it-IT"),
    pazienteCOGNOME: (patient.cognome || "").toLocaleUpperCase("it-IT"),
    pazientePRIVATO: "s",
    pazienteCF: cf,
    pazienteOPPONETS: "n",
  };
  // Provincia mancante è il segnale già in uso in anagrafica per "indirizzo
  // estero" (vedi audit indirizzi 2026-09-11): in quel caso non dichiariamo
  // Nazione "IT" né mandiamo località/provincia/CAP, che per un indirizzo
  // non italiano non hanno lo stesso significato/formato.
  if (patient.provincia) {
    row.pazienteNAZIONE = "IT";
    row.pazientePROVINCIA = patient.provincia;
    if (patient.localita) row.pazienteLOCALITA = patient.localita;
    if (patient.cap && /^\d+$/.test(patient.cap.trim())) row.pazienteCAP = patient.cap.trim();
  }
  if (patient.indirizzo) row.pazienteINDIRIZZO1 = patient.indirizzo;
  if (patient.telefono) row.pazienteTELEFONO = normalizzaTelefono(patient.telefono);
  if (patient.email && emailValida(patient.email.trim())) row.pazienteEMAIL = patient.email.trim();
  if (patient.note) row.pazienteNOTE = patient.note;
  return row;
}

export const PSICOGEST_ANAGRAFICA_COLUMN_ORDER = [
  "pazienteID",
  "pazienteNOME",
  "pazienteCOGNOME",
  "pazienteRAGIONESOCIALE",
  "pazientePRIVATO",
  "pazienteINDIRIZZO1",
  "pazienteINDIRIZZO2",
  "pazienteLOCALITA",
  "pazientePROVINCIA",
  "pazienteCAP",
  "pazienteNAZIONE",
  "pazienteCF",
  "pazientePIVA",
  "pazienteEMAIL",
  "pazienteEMAILPEC",
  "pazienteTELEFONO",
  "pazienteOPPONETS",
  "pazienteLUOGONASCITA",
  "pazienteDATANASCITA",
  "pazienteTELEFONO2",
  "pazienteNOTE",
];

export const DEFAULT_SETTINGS = {
  soglia_default: 5,
  giorni_stale: 60,
  bollo_soglia: 77.47,
  prestazione_individuale: "psicoterapia individuale",
  prestazione_coppia: "psicoterapia di coppia",
  prestazione_consulenza: "consulenza psicologica",
  prestazione_supervisione: "supervisione",
  tariffa_individuale_regolare: 80,
  tariffa_individuale_agevolata: 50,
  tariffa_coppia_regolare: 100,
  tariffa_coppia_agevolata: 60,
  tariffa_consulenza_regolare: 80,
  tariffa_consulenza_agevolata: 50,
  tariffa_supervisione_regolare: 0,
  tariffa_supervisione_agevolata: 0,
  ultimo_numero_fattura: null,
  email_mittente_nome: "Dr. Maurizio Brasini",
  email_mittente_indirizzo: "maurizio.brasini@psiconet.it",
  link_prenotazioni_online: "https://calendar.app.google/eWXK76xeVknxzeM86",
  link_comunicazioni: "https://calendar.app.google/cYP4PBewfvmv4rKV9",
};

// regime "nessuna" (richiesta di Maurizio 2026-09-22, per chi non ha una
// tariffa applicabile — pro bono, supervisioni gratuite, pseudo-pazienti):
// sempre 0, non ricade su "regolare" come farebbe qualunque altro valore.
export function tariffaStandard(tipologia, regime, settings) {
  if (regime === "nessuna") return 0;
  const key = `tariffa_${tipologia}_${regime === "agevolata" ? "agevolata" : "regolare"}`;
  return settings[key] ?? 0;
}
