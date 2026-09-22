// Numerazione delle sedute nelle note di Google Calendar (R/A/S + numero) e quota contanti.
import { matchPatientForEvent } from "./pazienti.js";

// ---------------------------------------------------------------------
// Numerazione sedute su Google Calendar (R/A/S + numero progressivo)
// ---------------------------------------------------------------------

// Lettera del codice, dedotta dai dati che il paziente ha già in anagrafica
// (nessun dato nuovo da inserire a mano): NF/S hanno priorità perché lo
// stato prevale sul regime tariffario. "non_fatturato" (2026-09-22, richiesta
// di Maurizio) copre sia pazienti reali mai fatturati (pro bono, supervisioni
// gratuite ad allievi) sia pseudo-pazienti che occupano solo uno slot fisso
// senza essere una persona da fatturare (es. una riunione ricorrente) — in
// entrambi i casi la numerazione prosegue (per tenere un conteggio), ma non
// scatta mai "fatturare" (vedi computeRinumerazione).
export function letteraCodice(patient) {
  if (patient.stato === "non_fatturato") return "NF";
  if (patient.stato === "sospeso") return "S";
  return patient.regime_tariffario === "agevolata" ? "A" : "R";
}

// contanteDovuto (facoltativo): quando il paziente ha un saldo contanti non
// fatturato ancora da saldare, viene aggiunto in coda al codice — es.
// "R3 (deve 150€)" — così resta visibile su Google Calendar senza doverlo
// scrivere/cancellare a mano ad ogni seduta.
// contantiSaldati (facoltativo): importo incassato proprio il giorno di questa
// seduta — la nota riporta "(contanti saldati 100€)" solo quel giorno; dalle
// sedute successive il "deve" sparisce da solo (o cala, se il saldo è parziale).
export function formatCodice(lettera, numero, fatturare, contanteDovuto, contantiSaldati) {
  let out = `${lettera}${numero}${fatturare ? " fatturare" : ""}`;
  if (contantiSaldati > 0) out += ` (contanti saldati ${formatEuro(contantiSaldati)}€)`;
  if (contanteDovuto > 0) out += ` (deve ${formatEuro(contanteDovuto)}€)`;
  return out;
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
const VECCHIO_CODICE_REGEX = /^\s*(?:(?:np|npa|nf|pc)\s*\d+|\d+\s*(?:np|npa|nf|pc)|[ras]\d+(?:\s*fatturare)?)\s*(?:\((?:deve\s*[\d.,]+\s*€?|contanti\s+saldati(?:\s*[\d.,]+\s*€?)?)\)\s*){0,2}\.?\s*/i;

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
// generato), con il codice che dovrebbe avere. Per i pazienti NON sospesi e
// NON "non_fatturato", il conteggio riparte da 1 ("fatturare") ogni volta che
// raggiunge la soglia — una proiezione che assume che la fattura verrà
// confermata subito dopo quella seduta. Per i pazienti sospesi o
// "non_fatturato" (lettera S/NF), accumula senza mai azzerarsi: nessuna
// fatturazione periodica prevista per loro (mai, per "non_fatturato"; in
// pausa, per "sospeso").
// allPatients (facoltativo): vedi nota su computePatientState — l'intera
// anagrafica serve per disambiguare correttamente, ricade su [patient] se
// omesso.
//
// Contanti (opzioni.pagamentiContante = incassi del paziente [{data, importo}]):
// il "deve" sulle note è un saldo corrente che (a) alla seduta "fatturare"
// include già la quota dei nuovi cicli — debito ancora aperto + quota_contante_seduta
// × sedute del ciclo, quindi anche il caso cumulativo "100 + 100" — senza
// aspettare la conferma della fattura, (b) resta sulle sedute successive finché
// non viene saldato, (c) nel giorno di un incasso la seduta di quel giorno porta
// "(contanti saldati X€)" e dalle successive il "deve" cala o sparisce. Il saldo
// a inizio piano è contante_dovuto + gli incassi dall'ancora in poi (già sottratti
// dal saldo attuale): tutte le sedute del piano sono dopo l'ultimo accumulo.
export function computeRinumerazione(patient, allEvents, settings, allPatients, opzioni = {}) {
  const lettera = letteraCodice(patient);
  // "non_fatturato" (richiesta di Maurizio 2026-09-22): nessuna tariffa si
  // applica, quindi non si fattura mai — non serve nemmeno un conteggio
  // "NF1, NF2..." sulla nota, che non porterebbe a nulla. Piano vuoto:
  // "Rinumera" non tocca mai le note di questi pazienti/pseudo-pazienti (né
  // scrive un nuovo codice, né rimuove uno eventualmente già scritto in
  // passato — quello va tolto a mano una tantum se presente).
  if (lettera === "NF") return [];
  const soglia = patient.soglia_fatturazione || settings.soglia_default;
  const eventi = eventiDiPazienteOrdinati(patient, allEvents, allPatients);
  const quota = patient.quota_contante_seduta || 0;
  const arrotonda = (n) => Math.round(n * 100) / 100;

  const pagamenti = (opzioni.pagamentiContante || [])
    .filter((p) => !patient.ancora_data || p.data >= patient.ancora_data)
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  let deve = arrotonda((patient.contante_dovuto || 0) + pagamenti.reduce((s, p) => s + (p.importo || 0), 0));
  let iPag = 0;

  let contatore = patient.ancora_valore || 0;
  const piano = [];

  for (const ev of eventi) {
    contatore += 1;
    const fatturare = lettera !== "S" && contatore >= soglia; // "NF" è già uscito sopra, mai qui
    let saldatiOggi = 0;
    while (iPag < pagamenti.length && pagamenti[iPag].data <= ev.data) {
      const p = pagamenti[iPag++];
      // Senza tetto a zero: un incasso in anticipo (prima che il debito sia
      // maturato) è un credito che il prossimo accumulo compensa; formatCodice
      // scrive il "deve" solo se il saldo è positivo.
      deve = arrotonda(deve - (p.importo || 0));
      if (p.data === ev.data) saldatiOggi += p.importo || 0;
    }
    if (fatturare && quota > 0) deve = arrotonda(deve + quota * contatore);
    const codice = formatCodice(lettera, contatore, fatturare, deve, saldatiOggi);
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

// Registra un incasso: può portare il saldo sotto zero (credito). Succede
// quando il paziente paga alla seduta 5, prima che la fattura sia confermata e
// il debito sia entrato nel saldo: alla conferma l'accumulo lo compensa.
export function incassaContante(saldoAttuale, importoPagato) {
  return Math.round(((saldoAttuale || 0) - (importoPagato || 0)) * 100) / 100;
}

// ---------------------------------------------------------------------
// Rilevamento nota "saldato"/"saldato N" (richiesta di Maurizio 2026-09-22):
// stesso principio di DISDETTA_REGEX in disdette.js — lui scrive a mano sulla
// nota della seduta del giorno "saldato" (debito interamente estinto) o
// "saldato 30" (estinti solo 30€, es. pagamento parziale o cumulativo), e la
// scansione propone di registrare l'incasso sulle STESSE strutture già usate
// dal bottone manuale "€X" in Pazienti (patients.contante_dovuto +
// contante_pagamenti, via incassaContante) — nessuna tabella nuova.
// ---------------------------------------------------------------------

export const SALDATO_REGEX = /\bsaldat[oa]\s*(\d+(?:[.,]\d+)?)?\s*€?\b/i;

// Scandisce gli eventi (stesso orizzonte già letto da "Registra disdette",
// nessuna chiamata Google aggiuntiva) alla ricerca della nota "saldato"/
// "saldato N" su pazienti con una quota contanti impostata. Non modifica
// nulla: solo l'elenco da mostrare in anteprima, con l'importo già proposto
// (editabile) e il saldo attuale per un controllo a vista prima di
// confermare. Senza numero, l'importo proposto è il saldo dovuto attuale —
// esattamente come il valore di partenza già proposto dal modale manuale
// "Contanti ricevuti" in Pazienti (può includere una proiezione non ancora
// fatturata: pagarla del tutto porta il saldo sotto zero, un credito che si
// compensa da solo alla conferma della prossima fattura, comportamento
// voluto e già in uso — vedi incassaContante).
export function computeIncassiContantiDaRegistrare(events, patients) {
  const risultati = [];
  for (const e of events || []) {
    const match = SALDATO_REGEX.exec(e.descrizione || "");
    if (!match) continue;
    const patient = matchPatientForEvent(e.titolo, patients)?.patient;
    if (!patient || !(patient.quota_contante_seduta > 0)) continue;
    const saldoAttuale = patient.contante_dovuto || 0;
    const importoScritto = match[1] ? Number(match[1].replace(",", ".")) : null;
    const importo = importoScritto != null ? importoScritto : saldoAttuale;
    risultati.push({
      eventId: e.id,
      patientId: patient.id,
      nome: patient.nome_calendario || patient.fatturare_a,
      data: e.data,
      saldoAttuale,
      importo,
      descrizioneOriginale: e.descrizione || "",
    });
  }
  return risultati.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

// Toglie il marcatore "saldato"/"saldato N" dalla nota dopo averlo
// registrato — necessario per l'idempotenza (altrimenti la prossima
// scansione lo troverebbe di nuovo) — stesso principio chirurgico di
// stripCodiceEsistente: tocca solo il testo riconosciuto, mai il resto della
// nota scritta a mano.
export function rimuoviMarcatoreSaldato(descrizione) {
  return (descrizione || "").replace(SALDATO_REGEX, "").replace(/\s{2,}/g, " ").trim();
}
