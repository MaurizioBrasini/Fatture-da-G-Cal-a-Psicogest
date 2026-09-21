// Chiusure del calendario (ferie, mezze giornate) e generazione delle occorrenze mancanti.
import { addDays } from "./util.js";
import { occorrenzeFuture } from "./slot.js";
import { matchPatientForEvent } from "./pazienti.js";

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

// Una riga di slot_closures (weekday+ora nominale della fascia + data) cade
// dentro una finestra di chiusura? Stessa semantica di rilevaConflittiChiusura
// (ora inizio inclusa, ora fine esclusa, ora assente = nessun limite), ma
// applicata all'orario nominale della fascia invece che a un evento reale:
// serve a decidere quali righe di una chiusura già registrata restano valide
// quando la sua finestra viene modificata.
export function chiusuraDentroFinestra(riga, { dataInizio, oraInizio, dataFine, oraFine }) {
  if (riga.closure_date < dataInizio || riga.closure_date > dataFine) return false;
  const ora = (riga.time_of_day || "").slice(0, 5);
  if (riga.closure_date === dataInizio && oraInizio && ora < oraInizio.slice(0, 5)) return false;
  if (riga.closure_date === dataFine && oraFine && ora >= oraFine.slice(0, 5)) return false;
  return true;
}

// Modifica di una chiusura già registrata: le righe vecchie ancora dentro la
// nuova finestra restano ("tenute") anche se l'appuntamento reale che le
// aveva generate non esiste più — è stato cancellato proprio da quella
// chiusura, quindi ricalcolare i conflitti solo dal calendario di oggi le
// perderebbe e libererebbe per errore date ancora chiuse. Le righe fuori
// dalla nuova finestra vengono "rimosse"; i conflitti reali trovati nella
// nuova finestra e non già coperti da una riga tenuta sono "aggiunte".
// Con finestra null (eliminazione) tutte le righe vecchie vengono rimosse.
export function calcolaRigheChiusuraModificata(righeVecchie, conflittiNuovi, finestra) {
  const chiave = (r) => `${r.weekday}|${r.time_of_day}|${r.closure_date}`;
  const tenute = finestra ? righeVecchie.filter((r) => chiusuraDentroFinestra(r, finestra)) : [];
  const rimosse = finestra ? righeVecchie.filter((r) => !chiusuraDentroFinestra(r, finestra)) : [...righeVecchie];
  const giaCoperte = new Set(tenute.map(chiave));
  const aggiunte = finestra ? (conflittiNuovi || []).filter((c) => !giaCoperte.has(chiave(c))) : [];
  return { tenute, rimosse, aggiunte };
}

// Titolo dell'evento "occupato" di una chiusura, e il suo inverso: serve a
// riconoscere sul calendario gli eventi creati dall'app (per recuperare le
// chiusure registrate prima che esistesse calendar_closures).
export function titoloChiusura(note) {
  return note ? `Indisponibile — ${note}` : "Indisponibile";
}

export function notaDaTitoloChiusura(titolo) {
  const m = /^Indisponibile(?: — (.+))?$/.exec((titolo || "").trim());
  if (!m) return undefined; // non è un evento di chiusura creato dall'app
  return m[1] || null;
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
