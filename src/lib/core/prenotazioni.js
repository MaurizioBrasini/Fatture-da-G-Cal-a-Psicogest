// Prenotazioni online dal link Google: abbinamento ai pazienti e regole di conflitto.
import { addDays, daysBetween, normalizeName, todayISO } from "./util.js";
import { occorrenzeFuture } from "./slot.js";
import { DISDETTA_REGEX } from "./disdette.js";
import { matchPatientForEvent } from "./pazienti.js";

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

// Stessa identica logica a livelli di confidenza di matchBookingToPatient,
// ma nella direzione opposta: da un paziente già in anagrafica trova il
// Contatto Google corrispondente (usato per la verifica bulk telefono/
// email/indirizzo contro i Contatti Google). confidence: "forte" (email
// combacia, o nome E cognome combaciano su un unico contatto), "debole"
// (un solo token combacia su un unico contatto), "ambiguo" (più
// candidati), null (nessun candidato) — stesso significato di lì.
export function matchPatientToGoogleContact(patient, contacts) {
  const emailNorm = (patient.email || "").trim().toLowerCase();
  if (emailNorm) {
    const perEmail = contacts.filter((c) => (c.email || []).some((e) => (e || "").trim().toLowerCase() === emailNorm));
    if (perEmail.length === 1) return { contact: perEmail[0], confidence: "forte" };
  }

  const nomeTok = tokenizzaNome(patient.nome);
  const cognomeTok = tokenizzaNome(patient.cognome);
  if (!nomeTok.length && !cognomeTok.length) return { contact: null, confidence: null };

  const scored = contacts
    .map((c) => {
      const tokens = tokenizzaNome(c.nome);
      const haNome = nomeTok.length > 0 && nomeTok.every((t) => tokens.includes(t));
      const haCognome = cognomeTok.length > 0 && cognomeTok.every((t) => tokens.includes(t));
      return { contact: c, haNome, haCognome };
    })
    .filter((s) => s.haNome || s.haCognome);

  const forti = scored.filter((s) => s.haNome && s.haCognome);
  if (forti.length === 1) return { contact: forti[0].contact, confidence: "forte" };
  if (forti.length > 1) return { contact: null, confidence: "ambiguo" };
  if (scored.length === 1) return { contact: scored[0].contact, confidence: "debole" };
  if (scored.length > 1) return { contact: null, confidence: "ambiguo" };
  return { contact: null, confidence: null };
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

// Regola di Maurizio (2026-09-20): chi prenota dal link libero non può
// avere più di un appuntamento ogni due settimane (Google non ha alcun
// limite per persona: solo massimo giornaliero totale, buffer e finestra).
// Due appuntamenti dello stesso paziente devono distare almeno 14 giorni.
export const GIORNI_MIN_TRA_PRENOTAZIONI = 14;
// Quanto indietro leggere il calendario per la regola: per i pazienti con slot
// fisso serve almeno la cadenza più lunga (mensile, 28 giorni).
export const GIORNI_LOOKBACK_PRENOTAZIONI = 28;
// Pazienti con slot fisso: un recupero deve distare almeno questi giorni da
// ogni altro appuntamento in agenda (richiesta di Maurizio: "5, forse 7", scelto 6).
// Per cadenze corte si scende a metà cadenza (settimanale: 3).
export const GIORNI_MIN_DA_APPUNTAMENTO = 6;

// Individua le prenotazioni online (righe di computePrenotazioniPreview con
// paziente abbinato) che violano la regola: restituisce {eventId: [{data,
// ora, tipo}]} con gli appuntamenti con cui confliggono. Per i pazienti senza
// slot fisso attivo ("su richiesta"/fuori schema) vale la regola dei 14
// giorni; per quelli con slot fisso vale la loro cadenza (vedi sotto).
// Il confronto è con (a) gli appuntamenti già presenti a calendario abbinati
// al paziente per titolo — passati inclusi, "una seduta 5 giorni fa" conta —
// senza quelli con nota "disdett*", e (b) le prenotazioni precedenti dello
// stesso paziente NON in conflitto: in ordine cronologico la prima resta, le
// successive vicine no. Non scrive nulla.
//
// Pazienti CON slot fisso attivo (regola di Maurizio, 2026-09-20): vale la
// loro cadenza (interval_days), non i 14 giorni. Chi disdice può recuperare,
// ma non aumentare la frequenza senza il suo consenso. Ogni seduta prevista
// dallo slot (occorrenzeFuture, chiusure comprese) è "occupata" dall'appuntamento
// reale più vicino a meno di interval_days; una prenotazione online è legittima
// solo se trova una seduta prevista ancora libera (disdetta o mai fissata) entro
// interval_days-1 giorni, prima o dopo. Se sono tutte occupate è un'aggiunta:
// conflitto. Gli appuntamenti veri occupano per primi (sono fatti), poi le
// prenotazioni in ordine cronologico. Serve che gli slot abbiano interval_days
// e anchor_date; senza, il paziente resta escluso come prima. Opzioni:
// closures (righe slot_closures) per le date spostate dalle chiusure.
//
// Orizzonte massimo (richiesta di Maurizio, 2026-09-21): un paziente a schema
// fisso può prenotare solo PRIMA (o nello stesso giorno) dell'ultimo
// appuntamento già messo a calendario secondo il suo schema — cioè fino a dove
// il calendario è "saturo". Oltre non ci sono appuntamenti che occupino le
// sedute previste, quindi senza questo limite una prenotazione lontana
// troverebbe sempre una seduta "libera" e passerebbe (buco reale provato: con
// il calendario popolato fino al 14/10, una prenotazione del 12/11 veniva
// accettata). `ultimoPrevisto` = {data, ora} dell'ultimo evento del paziente
// (disdetti compresi: la seduta disdetta è ancora nello schema); se manca
// (nessun evento letto) il limite non si applica.
function conflittiSlotFisso(slot, righePaz, esistentiPaz, closures, ultimoPrevisto) {
  const reach = slot.interval_days;
  const tutte = [...esistentiPaz.map((e) => e.data), ...righePaz.map((r) => r.data)].sort();
  const inizio = addDays(tutte[0], -reach);
  const fine = addDays(tutte[tutte.length - 1], reach);
  const previste = occorrenzeFuture(slot, closures, Math.abs(daysBetween(inizio, fine)), inizio).map((data) => ({ data, da: null }));

  // Occupa la seduta libera più vicina (a pari distanza la prima) entro reach-1 giorni.
  const occupa = (data, chi) => {
    let migliore = null;
    let dMigliore = Infinity;
    for (const p of previste) {
      const d = Math.abs(daysBetween(p.data, data));
      if (d >= reach) continue;
      if (!p.da && d < dMigliore) {
        migliore = p;
        dMigliore = d;
      }
    }
    if (migliore) migliore.da = chi;
    return !!migliore;
  };

  for (const e of [...esistentiPaz].sort((a, b) => (a.data + a.ora).localeCompare(b.data + b.ora))) {
    occupa(e.data, { data: e.data, ora: e.ora, tipo: "appuntamento", cadenza: reach });
  }
  const esito = {};
  const tenute = [];
  const distanzaMin = Math.min(GIORNI_MIN_DA_APPUNTAMENTO, Math.floor(reach / 2));
  const ordinate = [...righePaz].sort((a, b) => (a.data + (a.ora || "")).localeCompare(b.data + (b.ora || "")));
  for (const r of ordinate) {
    if (ultimoPrevisto && r.data > ultimoPrevisto.data) {
      esito[r.eventId] = [{ data: ultimoPrevisto.data, ora: ultimoPrevisto.ora, tipo: "appuntamento", cadenza: reach, oltreOrizzonte: true }];
      continue;
    }
    // Un recupero troppo a ridosso di un altro appuntamento in agenda è inutile
    // (e lascia il rischio che il paziente disdica quello, aprendo un altro buco).
    const stretti = [...esistentiPaz.map((e) => ({ data: e.data, ora: e.ora, tipo: "appuntamento" })), ...tenute]
      .filter((x) => Math.abs(daysBetween(x.data, r.data)) < distanzaMin)
      .map((x) => ({ ...x, cadenza: reach, troppoVicina: distanzaMin }));
    if (stretti.length) {
      esito[r.eventId] = stretti;
      continue;
    }
    if (occupa(r.data, { data: r.data, ora: r.ora, tipo: "prenotazione", cadenza: reach })) {
      tenute.push({ data: r.data, ora: r.ora, tipo: "prenotazione" });
      continue;
    }
    // Nessuna seduta libera: si segnalano gli appuntamenti che occupano quelle vicine.
    const vicini = previste.filter((p) => p.da && Math.abs(daysBetween(p.data, r.data)) < reach).map((p) => p.da);
    if (vicini.length) esito[r.eventId] = vicini;
  }
  return esito;
}

export function computeConflittiPrenotazioni(righe, events, patients, slots, opzioni = {}) {
  const minGiorni = opzioni.minGiorni ?? GIORNI_MIN_TRA_PRENOTAZIONI;
  const oggi = opzioni.oggi || todayISO();
  const slotAttivi = (slots || []).filter((s) => s.active);
  const conSlot = new Set(slotAttivi.map((s) => s.patient_id));
  const ordinate = [...(righe || [])].sort((a, b) => (a.data + (a.ora || "")).localeCompare(b.data + (b.ora || "")));

  // Eventi del calendario per paziente: l'abbinamento titolo→paziente si fa UNA
  // volta per evento (le prenotazioni grezze del link non contano). `tutti`
  // include le sedute disdette (sono ancora nello schema), `attivi` no.
  const tutti = new Map();
  for (const e of events || []) {
    if (!e.ora || BOOKING_TITLE_REGEX.test(e.titolo || "")) continue;
    const id = matchPatientForEvent(e.titolo, patients)?.patient.id;
    if (id) (tutti.get(id) || tutti.set(id, []).get(id)).push(e);
  }
  const attivi = (id) => (tutti.get(id) || []).filter((e) => !DISDETTA_REGEX.test(e.descrizione || ""));
  const ultimoEvento = (id) => [...(tutti.get(id) || [])].sort((a, b) => (a.data + a.ora).localeCompare(b.data + b.ora)).pop();

  const conflitti = {};

  // --- Pazienti con slot fisso: regola della cadenza (vedi conflittiSlotFisso).
  const idFissi = [...new Set(ordinate.filter((r) => r.patientId && conSlot.has(r.patientId)).map((r) => r.patientId))];
  for (const id of idFissi) {
    const slot = slotAttivi.find((s) => s.patient_id === id && s.interval_days && s.anchor_date);
    if (!slot) continue;
    const ultimo = ultimoEvento(id);
    const ultimoPrevisto = ultimo ? { data: ultimo.data, ora: ultimo.ora } : null;
    const righePaz = ordinate.filter((r) => r.patientId === id);
    Object.assign(conflitti, conflittiSlotFisso(slot, righePaz, attivi(id), opzioni.closures, ultimoPrevisto));
  }

  // --- Pazienti "liberi" (senza slot fisso) e persone non ancora abbinate.
  // Una data/ora è "riservata" se cade su una seduta prevista dallo schema di
  // un paziente fisso che il calendario non ha ancora popolato (data > ultimo
  // evento di quel paziente): Google la mostra libera solo perché troppo avanti.
  const minuti = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const riservataAlloSchema = (r) => {
    if (!r.ora || r.data < oggi) return false;
    const giornoSettimana = new Date(`${r.data}T00:00:00Z`).getUTCDay();
    const orizzonteGiorni = daysBetween(oggi, r.data) + 1;
    return slotAttivi.some((s) => {
      if (s.weekday !== giornoSettimana || !s.time_of_day || !s.interval_days || !s.anchor_date) return false;
      if (Math.abs(minuti(s.time_of_day) - minuti(r.ora)) >= 60) return false;
      const ultima = ultimoEvento(s.patient_id)?.data;
      if (ultima && r.data <= ultima) return false;
      return occorrenzeFuture(s, opzioni.closures, orizzonteGiorni, oggi).includes(r.data);
    });
  };

  // Regole, in ordine: (1) fascia riservata non ancora popolata, (2) almeno
  // minGiorni dagli altri appuntamenti, (3) un solo appuntamento futuro alla volta.
  const tenute = {}; // prenotazioni già accettate, per paziente
  for (const r of ordinate) {
    if (r.patientId && conSlot.has(r.patientId)) continue;
    if (riservataAlloSchema(r)) {
      conflitti[r.eventId] = [{ data: r.data, ora: r.ora, tipo: "riservato", riservato: true }];
      continue;
    }
    if (!r.patientId) continue;

    const esistenti = attivi(r.patientId);
    const precedenti = tenute[r.patientId] || [];
    const vicini = [
      ...esistenti
        .filter((e) => Math.abs(daysBetween(e.data, r.data)) < minGiorni)
        .map((e) => ({ data: e.data, ora: e.ora, tipo: "appuntamento" })),
      ...precedenti
        .filter((k) => Math.abs(daysBetween(k.data, r.data)) < minGiorni)
        .map((k) => ({ data: k.data, ora: k.ora, tipo: "prenotazione" })),
    ];
    if (vicini.length) {
      conflitti[r.eventId] = vicini;
      continue;
    }
    const altri = [
      ...esistenti
        .filter((e) => e.data > oggi)
        .map((e) => ({ data: e.data, ora: e.ora, tipo: "appuntamento", unaSola: true })),
      ...precedenti.map((k) => ({ data: k.data, ora: k.ora, tipo: "prenotazione", unaSola: true })),
    ];
    if (altri.length) conflitti[r.eventId] = altri;
    else (tenute[r.patientId] ||= []).push(r);
  }
  return conflitti;
}
