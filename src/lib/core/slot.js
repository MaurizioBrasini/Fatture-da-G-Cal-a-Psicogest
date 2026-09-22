// Slot fissi dei pazienti: occorrenze future, conflitti tra slot, griglia di disponibilità.
import { addDays, todayISO } from "./util.js";

// ---------------------------------------------------------------------
// Generatore di occorrenze per patient_slot (motore appuntamenti,
// sezione 5 di istruzioni-claude-code-appuntamenti.md): calcola le date
// reali di uno slot fisso applicando in cascata le chiusure dello stesso
// slot_key (weekday+ora) — una coppia quindicinale condivide la stessa
// lista di chiusure, quindi la cascata si propaga identica a entrambi
// senza logica differenziata per "chi tocca a chi".
// ---------------------------------------------------------------------

// patientSlot: { weekday, time_of_day, interval_days, anchor_date,
// alternanza_fissa }. closures: tutte le righe di slot_closures (vengono
// filtrate qui per weekday+time_of_day, non serve prefiltrarle prima di
// chiamare). Se il patient_slot ha alternanza_fissa (il suo turno non può
// spostarsi, es. solo 1°/3° lunedì del mese) le chiusure vengono ignorate
// del tutto per questo paziente — resta il ritmo fisso, anche se la stessa
// fascia condivisa da un altro paziente (non fisso) viene invece scalata in
// avanti normalmente: è Maurizio a decidere caso per caso cosa fare
// dell'occorrenza caduta su una data indisponibile.
// Ritorna le date reali (YYYY-MM-DD), ordinate, da oggi a oggi+orizzonteGiorni.
export function occorrenzeFuture(patientSlot, closures, orizzonteGiorni = 60, oggi = todayISO()) {
  const closureDates = patientSlot.alternanza_fissa
    ? []
    : (closures || [])
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

function mcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

// Due slot con lo stesso weekday NON sono per forza in conflitto: se
// entrambi sono quindicinali (o comunque a cadenza multipla) ma le ancore
// cadono su settimane diverse, si alternano e non generano mai lo stesso
// giorno reale (caso voluto, es. Livia/Pietro). Le due sequenze di date
// (anchor + n*interval_days) si intersecano se e solo se la differenza tra
// le due ancore è multipla del MCD dei due interval_days — se si
// intersecano lo fanno periodicamente, quindi è un vero conflitto ricorrente,
// non un caso limite isolato.
// Orario: coincidenza esatta come sempre, TRANNE quando uno dei due slot ha
// una durata esplicita (durata_minuti) più lunga della fascia standard — in
// quel caso conta la sovrapposizione oraria reale, non l'orario di inizio.
// Bug reale 2026-09-22: la prima versione applicava un default di 60' a
// OGNI slot per calcolare la sovrapposizione, anche a due pazienti normali
// senza durata esplicita — risultato, falsi conflitti ovunque due pazienti
// qualsiasi capitassero a meno di un'ora di distanza (es. "Riunione
// Scienziati" alle 9 faceva risultare doppio l'appuntamento di un paziente
// delle 9:30, che con lei non c'entrava nulla). Il default 60' si usa SOLO
// per valutare la sovrapposizione con uno slot che ha una durata esplicita.
function sovrapposizioneOraria(slotA, slotB) {
  if (!slotA.durata_minuti && !slotB.durata_minuti) return slotA.time_of_day === slotB.time_of_day;
  const inizioA = minutiOrario(slotA.time_of_day);
  const fineA = inizioA + (slotA.durata_minuti || 60);
  const inizioB = minutiOrario(slotB.time_of_day);
  const fineB = inizioB + (slotB.durata_minuti || 60);
  return inizioA < fineB && inizioB < fineA;
}

export function slotsInConflitto(slotA, slotB) {
  if (slotA.weekday !== slotB.weekday) return false;
  if (!sovrapposizioneOraria(slotA, slotB)) return false;
  const diffGiorni = Math.round(
    (new Date(`${slotB.anchor_date}T00:00:00Z`) - new Date(`${slotA.anchor_date}T00:00:00Z`)) / 86400000
  );
  const g = mcd(slotA.interval_days, slotB.interval_days);
  return diffGiorni % g === 0;
}

const GIORNI_GRIGLIA = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];

// "09:30" o "09:30:00" -> 570 (minuti da mezzanotte).
function minutiOrario(t) {
  const [hh, mm] = t.slice(0, 5).split(":").map(Number);
  return hh * 60 + mm;
}

// Fase di anchor_date dentro il ciclo di interval_days/7 settimane (1 per
// settimanale, 2 per quindicinale, 4 per "ogni 4 settimane") relativa a un
// lunedì di riferimento fisso — serve a sapere non solo "c'è già qualcuno su
// questa fascia" ma quante delle sue settimane sono davvero libere.
const EPOCH_LUNEDI = new Date("2020-01-06T00:00:00Z");
function faseSettimana(anchorDate, intervalDays) {
  const cicloSettimane = intervalDays / 7;
  const weekIndex = Math.round((new Date(`${anchorDate}T00:00:00Z`) - EPOCH_LUNEDI) / (7 * 86400000));
  return ((weekIndex % cicloSettimane) + cicloSettimane) % cicloSettimane;
}

// Quali fasi (0..cicloMax/7-1) del ciclo più lungo della fascia occupa una
// singola riga: un paziente con cadenza più corta del ciclo massimo (es.
// quindicinale dentro un ciclo mensile) ricorre PIÙ volte in quel ciclo,
// quindi occupa più di una fase — non una sola. Bug reale trovato 2026-09-16
// (caso Nele e Enzo quindicinale inserito sulla stessa fascia di due
// pazienti mensili, Giovedì 13:30): il vecchio codice chiamava
// `faseSettimana(r.anchor_date, cicloMax)`, che restituisce un solo numero
// anche per un paziente quindicinale dentro un ciclo mensile a 4 fasi — la
// sua seconda fase (quella 2 settimane dopo) spariva dal conteggio, facendo
// sembrare libera una fascia in realtà già piena, o nascondendo un vero
// conflitto quando quella fase coincide con quella di un altro paziente.
function faseSettimanaRiga(r, cicloMaxSettimane) {
  const rigaSettimane = r.interval_days / 7;
  const faseBase = faseSettimana(r.anchor_date, rigaSettimane * 7);
  const fasi = [];
  for (let k = 0; k < cicloMaxSettimane; k++) {
    if (k % rigaSettimane === faseBase) fasi.push(k);
  }
  return fasi;
}

// Occupazione reale di una fascia (weekday+orario): per ogni fase del ciclo
// più lungo tra i pazienti presenti, chi la occupa — una fase con più di un
// occupante è un vero conflitto ricorrente (stesso giorno reale, prima o
// poi), non solo "stessa fascia oraria".
function occupazioneFascia(righe) {
  const cicloMax = Math.max(...righe.map((r) => r.interval_days));
  const cicloMaxSettimane = cicloMax / 7;
  const occupazione = Array.from({ length: cicloMaxSettimane }, () => []);
  for (const r of righe) {
    for (const k of faseSettimanaRiga(r, cicloMaxSettimane)) occupazione[k].push(r);
  }
  return { cicloMax, faseSlots: cicloMaxSettimane, occupazione };
}

// Ricava dai patient_slots attivi (uno per riga: {weekday, time_of_day,
// interval_days, anchor_date, nome, stato}) il prospetto usato dalla pagina
// "Disponibilità": per ogni fascia weekday+orario, quali pazienti la
// occupano e quante fasi del ciclo (settimanale/quindicinale/mensile)
// restano libere — sostituisce la lettura manuale del vecchio calendario
// Excel. `conflitto` segnala due pazienti sulla stessa fase (sovrapposizione
// reale, mai dovrebbe succedere se `slotsInConflitto` è stato controllato
// all'inserimento).
export function computeGrigliaDisponibilita(patientSlots) {
  const gruppi = new Map();
  for (const s of patientSlots) {
    const key = `${s.weekday}|${s.time_of_day}`;
    if (!gruppi.has(key)) gruppi.set(key, []);
    gruppi.get(key).push(s);
  }

  const settimanali = [];
  const quindicinaliPieni = [];
  const quindicinaliSingoli = [];
  const mensili = [];

  for (const [key, righe] of gruppi) {
    const [weekday, time] = key.split("|");
    const { faseSlots, occupazione } = occupazioneFascia(righe);
    const fasiOccupate = occupazione.filter((occ) => occ.length > 0).length;
    const info = {
      weekday: Number(weekday),
      giorno: GIORNI_GRIGLIA[Number(weekday)],
      orario: time.slice(0, 5),
      fasiTotali: faseSlots,
      fasiLibere: faseSlots - fasiOccupate,
      conflitto: occupazione.some((occ) => occ.length > 1),
      conflittiDettaglio: occupazione.filter((occ) => occ.length > 1).map((occ) => occ.map((r) => r.nome)),
      pazienti: righe.map((r) => ({ nome: r.nome, stato: r.stato, interval_days: r.interval_days, anchor_date: r.anchor_date })),
    };
    const intervalli = new Set(righe.map((r) => r.interval_days));
    if (intervalli.has(7)) settimanali.push(info);
    else if (intervalli.has(14) && !intervalli.has(28)) (righe.length >= 2 ? quindicinaliPieni : quindicinaliSingoli).push(info);
    else if (intervalli.has(28)) mensili.push(info);
  }

  // Griglia fissa 08:30–20:30 ogni mezz'ora (richiesta di Maurizio
  // 2026-09-22: vedere anche le fasce vuote, non solo quelle già usate da
  // qualche paziente, per capire a colpo d'occhio dove infilarne uno nuovo,
  // "sfalsato" rispetto agli orari esistenti) — unita agli orari
  // effettivamente usati, per sicurezza, nel caso un vecchio slot non cada
  // esattamente su una mezz'ora canonica (non sparisce mai dalla griglia).
  const ORARIO_GRIGLIA_INIZIO = "08:30";
  const ORARIO_GRIGLIA_FINE = "20:30";
  const orariCanonici = [];
  for (let m = minutiOrario(ORARIO_GRIGLIA_INIZIO); m <= minutiOrario(ORARIO_GRIGLIA_FINE); m += 30) {
    orariCanonici.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  const orariUsati = [...new Set([...orariCanonici, ...patientSlots.map((s) => s.time_of_day.slice(0, 5))])].sort();
  const griglia = orariUsati.map((orario) => {
    const riga = { orario, giorni: {} };
    const orarioMinuti = minutiOrario(orario);
    for (const g of [1, 2, 3, 4, 5]) {
      // Ogni riga è un blocco di 30' INDIPENDENTE (mai un'ora "a scorrimento"
      // che sconfina nella riga prima/dopo — bug reale 2026-09-22: la prima
      // versione trattava ogni riga come un'ora piena, quindi una riunione
      // dalle 9 alle 11 risultava (sbagliato) anche nella riga 08:30, una
      // fascia che in realtà non tocca affatto). Un paziente normale
      // (durata_minuti non impostata) compare SOLO nella propria fascia
      // esatta, come sempre. Uno slot con durata ESPLICITA più lunga di 30'
      // (es. una riunione di 2 ore) compare in ogni riga di 30' che la sua
      // durata reale attraversa — non una di più, non una di meno.
      const righe = patientSlots.filter((s) => {
        if (Number(s.weekday) !== g) return false;
        if (!s.durata_minuti) return minutiOrario(s.time_of_day) === orarioMinuti;
        const inizio = minutiOrario(s.time_of_day);
        const fine = inizio + s.durata_minuti;
        return inizio < orarioMinuti + 30 && fine > orarioMinuti;
      });
      if (righe.length === 0) {
        riga.giorni[g] = { stato: "libero", pazienti: [], sottoSlot: [{ pazienti: [], parziale: false }, { pazienti: [], parziale: false }] };
        continue;
      }
      const { cicloMax, faseSlots, occupazione } = occupazioneFascia(righe);
      const fasiLibere = faseSlots - occupazione.filter((occ) => occ.length > 0).length;
      // Vista "a due caselle" (le due settimane del ciclo quindicinale):
      // la casella s raccoglie chi occupa le fasi k con k % 2 === s — un
      // settimanale compare in entrambe, i mensili della stessa parità
      // finiscono insieme nella stessa casella.
      const sottoSlot = [0, 1].map((s) => {
        const visti = new Set();
        const pazienti = [];
        let fasiLibereCasella = 0;
        occupazione.forEach((occ, k) => {
          if (cicloMax > 7 && k % 2 !== s) return;
          if (occ.length === 0) fasiLibereCasella++;
          for (const r of occ) {
            if (visti.has(r)) continue;
            visti.add(r);
            pazienti.push({ nome: r.nome, stato: r.stato });
          }
        });
        // parziale: casella occupata da mensili ma con ancora una settimana
        // libera nel suo ciclo (ci starebbe un altro mensile, non un quindicinale).
        return { pazienti, parziale: pazienti.length > 0 && fasiLibereCasella > 0 };
      });
      riga.giorni[g] = {
        sottoSlot,
        stato: fasiLibere === 0 ? "pieno" : "parziale",
        cadenza: cicloMax === 7 ? "settimanale" : cicloMax === 14 ? "quindicinale" : "mensile",
        fasiTotali: faseSlots,
        fasiLibere,
        conflitto: occupazione.some((occ) => occ.length > 1),
        conflittiDettaglio: occupazione.filter((occ) => occ.length > 1).map((occ) => occ.map((r) => r.nome)),
        pazienti: righe.map((r) => ({ nome: r.nome, stato: r.stato })),
      };
    }
    return riga;
  });

  return { settimanali, quindicinaliPieni, quindicinaliSingoli, mensili, griglia, totaleSlotAttivi: patientSlots.length };
}
