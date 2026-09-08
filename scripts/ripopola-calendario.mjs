// Script una tantum (motore appuntamenti, ordine di implementazione sezione 13
// di Appunti/istruzioni-claude-code-appuntamenti.md): ripopola Google Calendar
// da Appunti/CALENDARIO PAZIENTI MENSILE.xlsx (Foglio1/Foglio2, esportati come
// CSV da PowerShell/Excel COM prima di lanciare questo script — vedi
// scratchpad, o rigenerarli).
//
// STEP 1 (questa versione): SOLO VERIFICA A SECCO. Nessuna scrittura né su
// Supabase né su Google Calendar. Stampa un report; gli step successivi
// (scrittura patient_slots/patients, troncamento serie native, creazione
// occorrenze) vengono aggiunti ed eseguiti solo dopo che Maurizio ha
// confermato questo report — vedi Appunti (non tracciato in git) per il piano
// completo approvato.
//
// Uso: node scripts/ripopola-calendario.mjs <path-Foglio1.csv> <path-Foglio2.csv>

import fs from "node:fs";
import {
  normalizeName,
  matchPatientForEvent,
  computeRinumerazione,
  occorrenzeFuture,
  todayISO,
  addDays,
  DEFAULT_SETTINGS,
} from "../src/lib/logic.js";
import { createGoogleCalendarEvent } from "../src/lib/googleCalendar.js";

const args = process.argv.slice(2).filter((a) => a !== "--apply");
const APPLY = process.argv.includes("--apply");
const [foglio1Path, foglio2Path] = args;
if (!foglio1Path || !foglio2Path) {
  console.error("Uso: node scripts/ripopola-calendario.mjs <Foglio1.csv> <Foglio2.csv> [--apply]");
  process.exit(1);
}
const logLines = [];
function log(msg) {
  console.log(msg);
  logLines.push(msg);
}

// --- credenziali da .env.local (stesso file usato dall'app) ---
const envRaw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
// googleCalendar.js legge le credenziali da process.env (così fa anche in
// Next.js, che carica .env.local da solo) — qui, script Node a sé stante,
// vanno impostate a mano prima di usare createGoogleCalendarEvent.
process.env.GOOGLE_CLIENT_ID = GOOGLE_CLIENT_ID;
process.env.GOOGLE_CLIENT_SECRET = GOOGLE_CLIENT_SECRET;

async function supaGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${pathAndQuery} fallita: ${await res.text()}`);
  return res.json();
}

// --- parsing CSV minimale (righe tra virgolette, come esportate dallo
// script PowerShell già usato in questa conversazione) ---
function parseCsv(path) {
  const lines = fs.readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
  return lines.map((line) => {
    const fields = line.split('","');
    fields[0] = fields[0].replace(/^"/, "");
    fields[fields.length - 1] = fields[fields.length - 1].replace(/"$/, "");
    return fields;
  });
}

const EPOCH = Date.UTC(1899, 11, 30); // epoca seriale Excel

function serialToISO(serial) {
  const ms = EPOCH + Number(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function fracToHHMM(fracStr) {
  const frac = Number(fracStr.replace(",", "."));
  const totalMin = Math.round(frac * 24 * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const FREQ_TO_DAYS = { "sett.": 7, "2 sett.": 14, "4 sett.": 28 };
const WEEKDAY_JS_TO_DB = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 }; // 0=domenica..6=sabato, stesso range di patient_slots.weekday

async function main() {
  console.log("=== STEP 1: verifica a secco — nessuna scrittura ===\n");

  const patients = await supaGet("patients?select=id,nome_calendario,fatturare_a,ancora_valore,ancora_data,soglia_fatturazione,stato,regime_tariffario,contante_dovuto");
  const slots = await supaGet("patient_slots?select=*");
  const tokenRows = await supaGet("google_tokens?select=refresh_token");
  const refreshToken = tokenRows?.[0]?.refresh_token;
  if (!refreshToken) throw new Error("Nessun refresh_token trovato in google_tokens.");

  const f2rows = parseCsv(foglio2Path).slice(1); // salta header
  const foglio2 = f2rows
    .filter((f) => f[0] && f[0].trim() !== "")
    .map((f) => {
      const [nome, giornoSerial, orario, freq, numeroIncStr, stato] = f;
      const giorno = /^\d+$/.test(giornoSerial) ? serialToISO(giornoSerial) : null;
      let hhmm = null;
      if (/^0,/.test(orario)) hhmm = fracToHHMM(orario);
      else if (/^\d{2}[.:]\d{2}$/.test(orario)) hhmm = orario.replace(".", ":");
      return {
        nome: nome.trim(),
        giorno,
        hhmm,
        freq: freq.trim(),
        intervalDays: FREQ_TO_DAYS[freq.trim()] || null,
        numeroInc: Number(numeroIncStr),
        stato: stato.trim(),
      };
    });

  // --- 1.2: match Foglio2 -> patient_slots via nome_calendario, diff ---
  console.log("--- 1.2 Confronto Foglio2 vs patient_slots esistenti ---");
  const slotByPatientId = new Map(slots.map((s) => [s.patient_id, s]));

  // Risoluzione nome robusta: match esatto (preferendo, tra eventuali omonimi,
  // chi ha già un patient_slot — risolve casi come "Livia e Pietro" dove due
  // pazienti diversi condividono lo stesso nome_calendario), poi fallback su
  // matchPatientForEvent (già usato per il matching titolo/paziente altrove)
  // per gestire varianti tipo "Victor Matache" vs "Victor M." in anagrafica.
  // Alias noti per varianti di nome che nessuna euristica automatica risolve
  // (verificati a mano contro l'anagrafica): "Victor Matache" (Foglio2, nome
  // per esteso) = patient_id 127, nome_calendario "Victor M." (fatturare_a
  // "MATACHE VICTOR NICUSOR" conferma la stessa persona).
  const ALIAS_NOME = { "VICTOR MATACHE": "VICTOR M." };

  function trovaPaziente(nomeFoglio2) {
    const norm = normalizeName(ALIAS_NOME[normalizeName(nomeFoglio2)] || nomeFoglio2);
    const omonimi = patients.filter((p) => normalizeName(p.nome_calendario) === norm);
    if (omonimi.length === 1) return omonimi[0];
    if (omonimi.length > 1) {
      const conSlot = omonimi.find((p) => slotByPatientId.has(p.id));
      return conSlot || omonimi[0];
    }
    const m = matchPatientForEvent(nomeFoglio2, patients);
    return m ? m.patient : null;
  }

  const matchedSlotIds = new Set();
  const righeFoglio2ConDelta = [];
  let contaSenzaSlot = 0;

  for (const row of foglio2) {
    const patient = trovaPaziente(row.nome);
    if (!patient) {
      contaSenzaSlot++;
      console.log(`  [NON TROVATO in patients] "${row.nome}" — nessun paziente con questo nome_calendario.`);
      continue;
    }
    if (!row.giorno || !row.hhmm || !row.intervalDays) {
      contaSenzaSlot++;
      console.log(`  [DATI FOGLIO2 INCOMPLETI] ${row.nome}: giorno=${row.giorno} orario=${row.hhmm} freq=${row.freq}`);
      continue;
    }
    const slot = slotByPatientId.get(patient.id);
    const weekdayAtteso = new Date(row.giorno + "T12:00:00Z").getUTCDay();
    if (!slot) {
      contaSenzaSlot++;
      console.log(`  [NESSUN patient_slot] ${row.nome} (id ${patient.id}) — Foglio2 vorrebbe weekday=${weekdayAtteso} ${row.hhmm} ogni ${row.intervalDays}gg da ${row.giorno}, ma non esiste riga in patient_slots.`);
      continue;
    }
    matchedSlotIds.add(slot.id);
    const timeDb = slot.time_of_day.slice(0, 5);
    const delta = [];
    if (slot.weekday !== weekdayAtteso) delta.push(`weekday ${slot.weekday}->${weekdayAtteso}`);
    if (timeDb !== row.hhmm) delta.push(`orario ${timeDb}->${row.hhmm}`);
    if (slot.interval_days !== row.intervalDays) delta.push(`interval_days ${slot.interval_days}->${row.intervalDays}`);
    if (slot.anchor_date !== row.giorno) delta.push(`anchor_date ${slot.anchor_date}->${row.giorno}`);
    if (delta.length) {
      console.log(`  [DELTA] ${row.nome} (patient_slots id ${slot.id}): ${delta.join(", ")}`);
      righeFoglio2ConDelta.push({ row, patient, slot });
    }
  }
  const slotsNonInFoglio2 = slots.filter((s) => s.active && !matchedSlotIds.has(s.id));
  if (slotsNonInFoglio2.length) {
    console.log("  [patient_slots attivi senza riga corrispondente in Foglio2, verificare a mano]:");
    for (const s of slotsNonInFoglio2) {
      const p = patients.find((pp) => pp.id === s.patient_id);
      console.log(`    - patient_slots id ${s.id}, paziente ${p?.nome_calendario} (id ${s.patient_id})`);
    }
  }
  console.log(`  Totale righe Foglio2 con delta da applicare: ${righeFoglio2ConDelta.length}\n`);

  // --- accesso Google Calendar (sola lettura in questo step) ---
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!tokenRes.ok) throw new Error("Rinnovo token Google fallito: " + (await tokenRes.text()));
  const { access_token: accessToken } = await tokenRes.json();

  const oggi = todayISO();
  const finestraDa = addDays(oggi, -90);
  const finestraA = addDays(oggi, 60);

  async function fetchEventiEspansi(timeMin, timeMax) {
    let events = [];
    let pageToken;
    do {
      const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
      url.searchParams.set("timeMin", new Date(timeMin + "T00:00:00").toISOString());
      url.searchParams.set("timeMax", new Date(timeMax + "T23:59:59").toISOString());
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("maxResults", "2500");
      url.searchParams.set("orderBy", "startTime");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error("Lettura calendario fallita: " + (await res.text()));
      const data = await res.json();
      events = events.concat(
        (data.items || []).map((ev) => ({
          id: ev.id,
          data: (ev.start?.date || ev.start?.dateTime || "").slice(0, 10),
          ora: ev.start?.dateTime ? ev.start.dateTime.slice(11, 16) : null,
          titolo: ev.summary || "",
          descrizione: ev.description || "",
          recurringEventId: ev.recurringEventId || null,
          updated: ev.updated || null,
        })).filter((e) => e.data)
      );
      pageToken = data.nextPageToken;
    } while (pageToken);
    return events;
  }

  console.log(`--- Lettura eventi calendario reali (${finestraDa} .. ${finestraA}) per il controllo numeri e le serie native ---`);
  const eventiFinestra = await fetchEventiEspansi(finestraDa, finestraA);
  console.log(`  ${eventiFinestra.length} eventi letti.\n`);

  // --- 1.3: controllo diagnostico "numero inc." (non blocca nulla) ---
  console.log("--- 1.3 Controllo diagnostico numero inc. (SOLO informativo, non blocca la scrittura) ---");
  for (const row of foglio2) {
    const patient = trovaPaziente(row.nome);
    if (!patient || !row.giorno) continue;
    const piano = computeRinumerazione(patient, eventiFinestra, DEFAULT_SETTINGS);
    const riga = piano.find((p) => p.data === row.giorno);
    if (!riga) {
      console.log(`  ${row.nome}: nessun evento trovato a calendario sulla data giorno=${row.giorno} (normale se la serie nativa va ancora creata/non esiste già un evento lì) — numero atteso ${row.numeroInc}, nessun confronto possibile.`);
    } else if (riga.numero !== row.numeroInc) {
      console.log(`  [DISCREPANZA] ${row.nome}: storico calendario proietta numero=${riga.numero} il ${row.giorno}, Foglio2 dice numeroInc=${row.numeroInc}. Verrà comunque scritto ancora_valore=${row.numeroInc - 1} come da conferma di Maurizio.`);
    } else {
      console.log(`  [OK] ${row.nome}: coincide (numero=${riga.numero}).`);
    }
  }
  console.log("");

  // --- 1.4: individuazione serie ricorrenti native da troncare ---
  // Una serie può essere già stata spezzata in passato da una modifica
  // "questo e i successivi" fatta a mano su Google Calendar: questo genera
  // due recurringEventId distinti per lo stesso paziente/slot, di cui uno
  // ormai "morto" (nessuna occorrenza futura) e uno attivo. Non è ambiguità
  // vera: si sceglie automaticamente l'unico con occorrenze future; è
  // ambiguo solo se PIÙ DI UNO ha ancora occorrenze future contemporaneamente.
  console.log("--- 1.4 Serie ricorrenti native (candidate al troncamento UNTIL) ---");
  const contatori = { nonTrovata: 0, ambigua: 0, trovataPulita: 0 };
  const casiDaVerificareAMano = [];

  for (const row of foglio2) {
    const patient = trovaPaziente(row.nome);
    if (!patient) continue;
    const eventiPaziente = eventiFinestra.filter((e) => {
      const m = matchPatientForEvent(e.titolo, [patient]);
      return !!m;
    });
    const perSerie = new Map(); // recurringEventId -> { ultimoPassato, ultimoFuturo }
    for (const e of eventiPaziente) {
      if (!e.recurringEventId) continue;
      const s = perSerie.get(e.recurringEventId) || { ultimoPassato: null, primoFuturo: null };
      if (e.data < oggi) s.ultimoPassato = !s.ultimoPassato || e.data > s.ultimoPassato ? e.data : s.ultimoPassato;
      if (e.data >= oggi) s.primoFuturo = !s.primoFuturo || e.data < s.primoFuturo ? e.data : s.primoFuturo;
      perSerie.set(e.recurringEventId, s);
    }
    const serieAttive = [...perSerie.entries()].filter(([, s]) => s.primoFuturo);

    if (perSerie.size === 0) {
      contatori.nonTrovata++;
      console.log(`  ${row.nome}: nessuna serie ricorrente nativa trovata nella finestra (niente da troncare).`);
    } else if (serieAttive.length > 1) {
      contatori.ambigua++;
      casiDaVerificareAMano.push(row.nome);
      console.log(`  [AMBIGUO] ${row.nome}: ${serieAttive.length} serie diverse hanno ANCORA occorrenze future contemporaneamente (${serieAttive.map(([id]) => id).join(", ")}) — da verificare a mano, non scelgo automaticamente.`);
    } else if (serieAttive.length === 1) {
      contatori.trovataPulita++;
      const [recId, s] = serieAttive[0];
      console.log(`  ${row.nome}: serie nativa attiva ${recId} — ultima occorrenza passata: ${s.ultimoPassato || "nessuna nella finestra, verificare a mano"} -> UNTIL proposto = fine di quel giorno.`);
    } else {
      // Solo serie con esclusivamente occorrenze passate (già superata da
      // un'eventuale seconda serie non trovata, o naturalmente esaurita):
      // niente di attivo da troncare.
      contatori.nonTrovata++;
      console.log(`  ${row.nome}: solo serie passate/già esaurite trovate (niente da troncare).`);
    }
  }

  console.log("\n=== RIEPILOGO (i tre numeri) ===");
  console.log(`(a) Righe Foglio2 senza patient_slot corrispondente: ${contaSenzaSlot}`);
  console.log(`(b) Serie nativa ambigua (2+ serie con occorrenze future contemporanee, da NON troncare in automatico): ${contatori.ambigua}`);
  console.log(`    [info, non blocca] serie nativa non trovata (niente da troncare, non è un problema): ${contatori.nonTrovata}`);
  console.log(`    [info, non blocca] serie nativa pulita trovata: ${contatori.trovataPulita}`);
  console.log(`(c) numero-check discordante (solo informativo): vedi [DISCREPANZA] sopra`);
  if (casiDaVerificareAMano.length) console.log(`Casi ambigui da verificare a mano: ${casiDaVerificareAMano.join(", ")}`);

  if (!APPLY) {
    console.log("\n=== FINE REPORT (dry-run) — nessuna scrittura effettuata ===");
    return;
  }

  // =====================================================================
  // STEP 2-4: APPLICAZIONE — scritture reali (solo dopo il report a secco).
  // Salta i pazienti con serie ambigua o con frequenza non ancora ammessa
  // dallo schema (interval_days fuori 7/14 finché schema_addendum4.sql non
  // è stato eseguito) — quelli restano per la revisione manuale di domani.
  // =====================================================================
  console.log("\n=== STEP 2-4: APPLICAZIONE (scritture reali) ===");

  const nomiAmbigui = new Set(casiDaVerificareAMano.map(normalizeName));
  const daSaltareSchema = foglio2.filter((r) => r.intervalDays && ![7, 14].includes(r.intervalDays));
  const nomiSchemaBloccati = new Set(daSaltareSchema.map((r) => normalizeName(r.nome)));
  const riepilogoManuale = [
    ...casiDaVerificareAMano.map((nome) => `${nome}: serie native ambigue (2 serie con occorrenze future contemporanee) — scegliere a mano quale troncare, poi generare le sue occorrenze`),
    ...daSaltareSchema.map((r) => `${r.nome}: richiede interval_days=${r.intervalDays}, eseguire prima schema_addendum4.sql su Supabase (SQL editor), poi rilanciare per lui/lei`),
  ];

  async function supaPatch(pathAndQuery, body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Supabase PATCH ${pathAndQuery} fallita: ${await res.text()}`);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function setRruleUntil(recurrenceArray, untilDateISO) {
    const untilStr = untilDateISO.replace(/-/g, "") + "T235959Z";
    return (recurrenceArray || [])
      .filter((line) => line.startsWith("RRULE:"))
      .map((line) => {
        const parts = line.slice(6).split(";").filter((p) => !p.startsWith("UNTIL=") && !p.startsWith("COUNT="));
        parts.push(`UNTIL=${untilStr}`);
        return "RRULE:" + parts.join(";");
      });
  }

  // Il taglio non deve mai essere anteriore a "oggi reale" (non si tocca mai
  // il passato), ma nemmeno anteriore al `giorno` di Foglio2 quando quello è
  // successivo a oggi (Maurizio: "non devi toccare nulla prima di quel
  // punto") — es. Mattia M./Roberta C. hanno giorno molte settimane avanti:
  // eventuali occorrenze native reali tra oggi e giorno vanno lasciate stare.
  // Se invece giorno è già oggi o nel passato (es. l'esecuzione è slittata
  // di un giorno rispetto a quando Foglio2 è stato preparato), si ricade sulla
  // regola originale "fino a ieri rispetto a oggi", per non cancellare mai
  // un'occorrenza che nel frattempo è già diventata storica.
  function cutoffPerPaziente(giornoRow) {
    const base = giornoRow > oggi ? giornoRow : oggi;
    return addDays(base, -1);
  }

  async function troncaSerie(masterId, cutoffISO) {
    const getRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(masterId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!getRes.ok) throw new Error("Lettura evento master fallita: " + (await getRes.text()));
    const master = await getRes.json();
    const nuovaRecurrence = setRruleUntil(master.recurrence, cutoffISO);
    const patchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(masterId)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recurrence: nuovaRecurrence }),
    });
    if (!patchRes.ok) throw new Error("Troncamento serie fallito: " + (await patchRes.text()));
  }

  // Ricostruisce, per ogni paziente non saltato, quale sia l'unica serie
  // nativa attiva (stessa logica dello Step 1.4) e l'insieme di date che
  // hanno già un evento reale abbinato (per evitare doppioni quando non c'è
  // una serie da troncare — es. un evento singolo già creato a mano).
  const serieAttivaPerNome = new Map();
  const dateEsistentiPerNome = new Map();
  for (const row of foglio2) {
    const patient = trovaPaziente(row.nome);
    if (!patient) continue;
    const eventiPaziente = eventiFinestra.filter((e) => !!matchPatientForEvent(e.titolo, [patient]));
    dateEsistentiPerNome.set(normalizeName(row.nome), new Set(eventiPaziente.map((e) => e.data)));
    const perSerie = new Map();
    for (const e of eventiPaziente) {
      if (!e.recurringEventId) continue;
      const s = perSerie.get(e.recurringEventId) || { primoFuturo: null };
      if (e.data >= oggi) s.primoFuturo = !s.primoFuturo || e.data < s.primoFuturo ? e.data : s.primoFuturo;
      perSerie.set(e.recurringEventId, s);
    }
    const attive = [...perSerie.entries()].filter(([, s]) => s.primoFuturo);
    if (attive.length === 1) serieAttivaPerNome.set(normalizeName(row.nome), attive[0][0]);
  }

  let contaTroncate = 0, contaSlotAggiornati = 0, contaPazientiAggiornati = 0, contaEventiCreati = 0;
  const erroriApply = [];

  for (const row of foglio2) {
    const key = normalizeName(row.nome);
    if (nomiAmbigui.has(key) || nomiSchemaBloccati.has(key)) continue; // manuale domani
    const patient = trovaPaziente(row.nome);
    if (!patient || !row.giorno || !row.hhmm || !row.intervalDays) continue;
    const slot = slotByPatientId.get(patient.id);
    if (!slot) continue;

    try {
      // Step 2: patients.ancora_valore/ancora_data — SEMPRE, come confermato
      // da Maurizio (indipendente dal controllo diagnostico 1.3).
      await supaPatch(`patients?id=eq.${patient.id}`, {
        ancora_valore: row.numeroInc - 1,
        ancora_data: row.giorno,
      });
      contaPazientiAggiornati++;
      await sleep(120);

      // Step 2: patient_slots — geometria corretta da Foglio2.
      const weekdayAtteso = new Date(row.giorno + "T12:00:00Z").getUTCDay();
      await supaPatch(`patient_slots?id=eq.${slot.id}`, {
        weekday: weekdayAtteso,
        time_of_day: row.hhmm + ":00",
        interval_days: row.intervalDays,
        anchor_date: row.giorno,
      });
      slot.weekday = weekdayAtteso;
      slot.time_of_day = row.hhmm + ":00";
      slot.interval_days = row.intervalDays;
      slot.anchor_date = row.giorno;
      contaSlotAggiornati++;
      await sleep(120);

      // Step 3: tronca la serie nativa attiva, se ce n'è una pulita.
      const masterId = serieAttivaPerNome.get(key);
      if (masterId) {
        const cutoff = cutoffPerPaziente(row.giorno);
        await troncaSerie(masterId, cutoff);
        contaTroncate++;
        log(`  [TRONCATA] ${row.nome}: serie ${masterId} -> UNTIL ${cutoff}`);
        await sleep(150);
      }

      // Step 4: genera le occorrenze future (orizzonte 60gg, motore già
      // esistente). colorId omesso (default/blu) solo per la primissima
      // occorrenza se Foglio2 dice "confermato"; tutte le altre "6" (mandarino).
      // Se non c'era una serie nativa da troncare, non ricreare un evento su
      // una data che ha già un evento reale abbinato (es. creato a mano) —
      // se invece la serie ERA quella troncata poco sopra, la sua vecchia
      // istanza su quella data sta per sparire: va bene ricrearla.
      const dateEsistenti = masterId ? new Set() : dateEsistentiPerNome.get(key) || new Set();
      const tutteLeDate = occorrenzeFuture(slot, [], 60, oggi);
      const primaDataVera = tutteLeDate[0];
      const date = tutteLeDate.filter((d) => !dateEsistenti.has(d));
      const saltate = tutteLeDate.length - date.length;
      for (let i = 0; i < date.length; i++) {
        const confermato = date[i] === primaDataVera && row.stato === "confermato";
        await createGoogleCalendarEvent(refreshToken, {
          data: date[i],
          ora: row.hhmm,
          durataMinuti: 60,
          titolo: patient.nome_calendario,
          descrizione: "",
          colorId: confermato ? undefined : "6",
        });
        contaEventiCreati++;
        await sleep(150);
      }
      log(`  [OK] ${row.nome}: patient_slots/patients aggiornati, ${masterId ? "serie troncata, " : ""}${date.length} occorrenze create${saltate ? ` (${saltate} saltate: già presente un evento su quella data)` : ""}.`);
    } catch (e) {
      erroriApply.push(`${row.nome}: ${e.message}`);
      log(`  [ERRORE] ${row.nome}: ${e.message}`);
    }
  }

  console.log("\n=== RISULTATO APPLICAZIONE ===");
  console.log(`Pazienti aggiornati (patients): ${contaPazientiAggiornati}`);
  console.log(`patient_slots aggiornati: ${contaSlotAggiornati}`);
  console.log(`Serie native troncate: ${contaTroncate}`);
  console.log(`Occorrenze create: ${contaEventiCreati}`);
  console.log(`Errori: ${erroriApply.length}`);
  if (erroriApply.length) console.log(erroriApply.map((e) => "  - " + e).join("\n"));

  console.log("\n=== DA SISTEMARE A MANO DOMANI ===");
  for (const m of riepilogoManuale) console.log("  - " + m);
  if (!riepilogoManuale.length) console.log("  (nessuno)");

  console.log("\n=== FINE — Step 5 (Rinumera) e Step 6 (bottone) restano per domani sera ===");
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
