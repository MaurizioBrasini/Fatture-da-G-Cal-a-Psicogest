// Disdette: rilevamento nota, regola 48h, ripulitura duplicati, riprenotazioni, statistiche.
import { addDays, daysBetween, todayISO } from "./util.js";
import { matchPatientForEvent } from "./pazienti.js";

// ---------------------------------------------------------------------
// Disdette/buche: rilevamento della nota "disdetto" e calcolo automatico
// dello stato di fatturazione (charged/not_charged) dalla soglia di
// preavviso di 48h.
// ---------------------------------------------------------------------

export const DISDETTA_REGEX = /disdett/i; // copre "disdetto", "disdetta", "disdette"

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

// Pazienti che hanno DISDETTO DI RECENTE (una riga in `cancellazioni` con
// cancelled_at negli ultimi `giorniIndietroDisdetta` giorni, non solo un
// gap generico) E il cui salto tra ultimo e prossimo appuntamento supera il
// doppio della cadenza attesa (settimanale diventato quindicinale,
// quindicinale diventato mensile, ecc.) — o senza alcun appuntamento futuro
// nonostante lo slot attivo. Entrambe le condizioni servono: un gap grande
// senza una disdetta recente potrebbe essere semplicemente come è sempre
// stato programmato quel paziente (non un buco da colmare, vedi
// "alternanza_fissa"); una disdetta recente su uno slot fisso di solito NON
// crea alcun buco (il prossimo turno regolare è già pianificato) — qui si
// individua chi è rimasto davvero scoperto dopo aver disdetto: il target
// giusto per un messaggio di riprenotazione mirato (richiesta di Maurizio
// 2026-09-11). Include anche i pazienti "a schema libero" (nessuno slot
// fisso attivo, es. fuori_schema/"su richiesta") che non hanno alcuna data
// futura già pianificata — per loro non serve una disdetta recente: non
// esiste una cadenza attesa da violare, "nessuna data pianificata" è già di
// per sé il segnale interessante. Richiede `events` su un orizzonte che
// copra sia il passato recente sia almeno 2x l'intervallo più lungo in
// futuro, altrimenti "nessun futuro" darebbe falsi positivi per semplice
// mancanza di dati letti.
export function computePazientiConSalto(patients, slots, events, cancellazioni, giorniIndietroDisdetta = 30) {
  const slotAttivoByPatientId = Object.fromEntries((slots || []).filter((s) => s.active).map((s) => [s.patient_id, s]));
  const oggi = todayISO();
  const dataMinimaDisdetta = addDays(oggi, -giorniIndietroDisdetta);
  const haDisdettoRecente = new Set(
    (cancellazioni || []).filter((c) => c.cancelled_at && c.cancelled_at.slice(0, 10) >= dataMinimaDisdetta).map((c) => c.patient_id)
  );
  const risultati = [];
  for (const patient of patients || []) {
    if (patient.stato === "concluso") continue; // percorso chiuso: nessun messaggio di riprenotazione
    const slot = slotAttivoByPatientId[patient.id];
    const matched = (events || []).filter((e) => matchPatientForEvent(e.titolo, patients)?.patient.id === patient.id);
    const passate = matched.filter((e) => e.data <= oggi).map((e) => e.data).sort();
    const future = matched.filter((e) => e.data > oggi).map((e) => e.data).sort();
    const ultima = passate.length ? passate[passate.length - 1] : null;
    const prossima = future.length ? future[0] : null;

    if (!slot) {
      // Schema libero: nessuna cadenza attesa da confrontare, quindi
      // nessuna disdetta recente richiesta — basta non avere già una data
      // futura pianificata (e uno storico reale, non un lead mai visto).
      if (ultima && !prossima) {
        risultati.push({
          patientId: patient.id,
          nome: patient.nome_calendario || patient.fatturare_a,
          tipo: "schema_libero_senza_data",
          ultima,
          prossima: null,
          gapGiorni: null,
          intervalAtteso: null,
        });
      }
      continue;
    }
    if (!haDisdettoRecente.has(patient.id)) continue; // solo chi ha disdetto di recente, non un gap qualunque

    if (!prossima) {
      risultati.push({
        patientId: patient.id,
        nome: patient.nome_calendario || patient.fatturare_a,
        tipo: "nessun_futuro",
        ultima,
        prossima: null,
        gapGiorni: null,
        intervalAtteso: slot.interval_days,
      });
      continue;
    }
    if (!ultima) continue; // nessuno storico da confrontare (paziente nuovo)

    const gap = daysBetween(ultima, prossima);
    if (gap >= slot.interval_days * 2) {
      risultati.push({
        patientId: patient.id,
        nome: patient.nome_calendario || patient.fatturare_a,
        tipo: "salto",
        ultima,
        prossima,
        gapGiorni: gap,
        intervalAtteso: slot.interval_days,
      });
    }
  }
  return risultati;
}

// ---------------------------------------------------------------------
// Statistiche disdette (richiesta di Maurizio 2026-09-20): chi occupa uno
// slot fisso ma disdice spesso non ha diritto alla frequenza fissa. La
// percentuale è "appuntamenti disdetti / appuntamenti fissati" dal giorno in
// cui le disdette hanno iniziato ad essere registrate (prima non esiste
// alcuna traccia: gli eventi non addebitati venivano eliminati e le note
// riscritte dalla numerazione, quindi il passato non è recuperabile — e
// contare gli appuntamenti di quel periodo senza le relative disdette
// gonfierebbe il denominatore e abbasserebbe la % in modo falso).
// ---------------------------------------------------------------------

export const SOGLIA_DISDETTE_DEFAULT = 0.2;
export const MIN_APPUNTAMENTI_DISDETTE = 5;
// Periodo del bilancio: "negli ultimi 6 mesi ha dato buca il 25% delle volte"
// (richiesta di Maurizio). null = dall'inizio della rilevazione.
export const GIORNI_PERIODO_DISDETTE = 182;

// "Appuntamenti fissati" di un paziente = date DISTINTE, dall'inizio della
// rilevazione a oggi, in cui esiste un evento reale abbinato a lui OPPURE una
// disdetta registrata. L'unione evita il doppio conteggio delle buche
// addebitate (l'evento resta a calendario E c'è la riga in cancellations),
// e conta anche le disdette non addebitate il cui evento è stato eliminato.
// Solo pazienti con uno slot fisso attivo (gli "a schema libero" non hanno
// un impegno di frequenza da rispettare). Le date future sono escluse da
// numeratore e denominatore: gli appuntamenti non ancora arrivati non
// possono essere né rispettati né disdetti in modo confrontabile.
export function computeStatisticheDisdette(patients, slots, events, cancellazioni, opzioni = {}) {
  const oggi = opzioni.oggi || todayISO();
  const soglia = opzioni.soglia ?? SOGLIA_DISDETTE_DEFAULT;
  const minAppuntamenti = opzioni.minAppuntamenti ?? MIN_APPUNTAMENTI_DISDETTE;
  // undefined -> default 6 mesi; null esplicito -> dall'inizio della rilevazione
  const giorniPeriodo = opzioni.giorniPeriodo === undefined ? GIORNI_PERIODO_DISDETTE : opzioni.giorniPeriodo;

  const inizio = (cancellazioni || []).map((c) => c.original_date).sort()[0] || null;
  if (!inizio) return { inizio: null, oggi, soglia, minAppuntamenti, giorniPeriodo, righe: [], mensile: [] };

  const pazientiConSlot = new Set((slots || []).filter((s) => s.active).map((s) => s.patient_id));
  const perPaziente = {};
  for (const p of patients || []) {
    // "non_fatturato" (pro bono, supervisioni gratuite, pseudo-pazienti che
    // occupano solo uno slot) non ha una fatturazione da cui perdere il
    // diritto disdicendo spesso: escluso dal calcolo (richiesta di Maurizio
    // 2026-09-22, stesso principio del filtro "attivo" già esistente).
    if (pazientiConSlot.has(p.id) && p.stato !== "non_fatturato") {
      perPaziente[p.id] = { patient: p, appuntamenti: new Set(), disdette: new Set() };
    }
  }

  for (const e of events || []) {
    if (e.data < inizio || e.data > oggi || !e.ora) continue;
    const id = matchPatientForEvent(e.titolo, patients)?.patient.id;
    if (perPaziente[id]) perPaziente[id].appuntamenti.add(e.data);
  }
  for (const c of cancellazioni || []) {
    if (c.original_date < inizio || c.original_date > oggi || !perPaziente[c.patient_id]) continue;
    perPaziente[c.patient_id].appuntamenti.add(c.original_date);
    perPaziente[c.patient_id].disdette.add(c.original_date);
  }

  const mensile = {};
  const righe = Object.values(perPaziente)
    .filter((x) => x.appuntamenti.size > 0)
    .map(({ patient, appuntamenti, disdette }) => {
      for (const d of appuntamenti) {
        const m = (mensile[d.slice(0, 7)] ??= { mese: d.slice(0, 7), appuntamenti: 0, disdette: 0 });
        m.appuntamenti++;
        if (disdette.has(d)) m.disdette++;
      }
      // Andamento cumulativo, un punto per appuntamento: da qui si ricava il
      // bilancio su qualunque periodo (bilancioAlla) e il tempo trascorso
      // sopra soglia (tempoInZonaRossa).
      let cumTot = 0;
      let cumDisd = 0;
      const andamento = [...appuntamenti].sort().map((d) => {
        cumTot++;
        if (disdette.has(d)) cumDisd++;
        return { data: d, appuntamenti: cumTot, disdette: cumDisd };
      });
      const { appuntamenti: tot, disdette: disd } = bilancioAlla(andamento, oggi, giorniPeriodo);
      const percentuale = tot ? disd / tot : 0;
      const datiInsufficienti = tot < minAppuntamenti;
      return {
        patientId: patient.id,
        nome: patient.nome_calendario || patient.fatturare_a,
        appuntamenti: tot,
        disdette: disd,
        andamento,
        zonaRossa: tempoInZonaRossa(andamento, soglia, minAppuntamenti, oggi, giorniPeriodo),
        percentuale,
        datiInsufficienti,
        segnalato: !datiInsufficienti && percentuale > soglia,
      };
    })
    .sort((a, b) => Number(b.segnalato) - Number(a.segnalato) || b.percentuale - a.percentuale || (a.nome || "").localeCompare(b.nome || ""));

  return {
    inizio,
    oggi,
    soglia,
    minAppuntamenti,
    giorniPeriodo,
    righe,
    mensile: Object.values(mensile).sort((a, b) => (a.mese < b.mese ? -1 : 1)),
  };
}

// Bilancio di un paziente alla data `dataFine`: appuntamenti e disdette
// negli ultimi `giorniPeriodo` giorni (null = dall'inizio della rilevazione).
// `andamento` è cumulativo e cronologico (un punto per appuntamento), quindi
// il bilancio del periodo è la differenza tra il cumulato alla fine e quello
// subito prima dell'inizio della finestra (estremo iniziale incluso).
export function bilancioAlla(andamento, dataFine, giorniPeriodo) {
  const inizioFinestra = giorniPeriodo == null ? null : addDays(dataFine, -giorniPeriodo);
  let prima = { appuntamenti: 0, disdette: 0 };
  let fine = { appuntamenti: 0, disdette: 0 };
  for (const p of andamento || []) {
    if (p.data > dataFine) break;
    fine = p;
    if (inizioFinestra !== null && p.data < inizioFinestra) prima = p;
  }
  return { appuntamenti: fine.appuntamenti - prima.appuntamenti, disdette: fine.disdette - prima.disdette };
}

// Tempo trascorso in "zona rossa" (percentuale del periodo sopra soglia, con
// almeno `minAppuntamenti` appuntamenti nel periodo), SOMMANDO tutti i
// periodi: un paziente può entrare, uscire e rientrare, e ciò che interessa
// a Maurizio è quanto tempo in totale ci è stato ("se restano in zona rossa
// per un tot..."), non solo la permanenza attuale. Lo stato viene valutato a
// ogni appuntamento e alla data `oggi` (una disdetta vecchia può uscire dalla
// finestra anche senza nuovi appuntamenti) e vale fino alla valutazione
// successiva; un periodo ancora aperto arriva fino a `oggi`. Il conteggio di
// un paziente parte dal primo momento in cui raggiunge il minimo (prima non
// può essere rosso) — `primoIngresso`. Restituisce null se non è mai stato in
// zona rossa. Non decide nulla: informa soltanto.
export function tempoInZonaRossa(andamento, soglia, minAppuntamenti, oggi, giorniPeriodo = null) {
  const periodi = [];
  let inizio = null;
  const date = (andamento || []).map((p) => p.data);
  if (!date.length || date[date.length - 1] < oggi) date.push(oggi);
  for (const data of date) {
    const b = bilancioAlla(andamento, data, giorniPeriodo);
    const rosso = b.appuntamenti >= minAppuntamenti && b.disdette / b.appuntamenti > soglia;
    if (rosso && inizio === null) inizio = data;
    if (!rosso && inizio !== null) {
      periodi.push({ da: inizio, a: data });
      inizio = null;
    }
  }
  if (inizio !== null) periodi.push({ da: inizio, a: null });
  if (!periodi.length) return null;
  const giorniTotali = periodi.reduce((somma, per) => somma + daysBetween(per.da, per.a || oggi), 0);
  return { giorniTotali, periodi, inCorso: periodi[periodi.length - 1].a === null, primoIngresso: periodi[0].da };
}
