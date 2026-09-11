// Audit accurato dei possibili "resuscitati" (2026-09-11, richiesto da
// Maurizio dopo il caso Elisabetta U.). Sola lettura, non scrive nulla.
// Estende scripts/audit-disdette-non-skippate.mjs, che copriva solo il
// rischio TEORICO futuro (una disdetta senza skipped_occurrences che
// verrebbe rigenerata al prossimo "Genera occorrenze future") ma escludeva
// esplicitamente i casi già ricreati ORA (come Elisabetta U.: il caso reale
// che ha fatto scoprire questo buco nell'audit precedente). Controlla 4 cose:
//
// A) Disdette not_charged senza skipped_occurrences, GIA' RICOMPARSE sul
//    calendario adesso (evento reale esistente per stesso paziente+data) —
//    problema attuale, non teorico: vanno cancellate a mano + backfillato
//    skipped_occurrences.
// B) Stessa categoria ma NON ancora ricomparse — rischio teorico (copre lo
//    stesso terreno dello script precedente, incluso qui per un report unico).
// C) Eventi a calendario con nota "disdett*" MAI registrati in
//    `cancellations` (pattern esatto del caso Elisabetta: nota scritta a
//    mano, mai passata da "Registra disdette") — orizzonte ampio (-90/+180).
// D) Slot fissi attivi duplicati (stesso paziente+weekday+ora+anchor+intervallo,
//    più di una riga active=true) — stesso bug trovato su Silvia F.

import fs from "node:fs";
import { fetchGoogleCalendarEvents } from "../src/lib/googleCalendar.js";
import { occorrenzeFuture, matchPatientForEvent, todayISO, addDays } from "../src/lib/logic.js";

const envRaw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function supaGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET fallita: ${await res.text()}`);
  return res.json();
}

const DISDETTA_REGEX = /disdett/i;
const ORIZZONTE_FUTURO = 180;
const ORIZZONTE_PASSATO = 90;

async function main() {
  const oggi = todayISO();
  const dataMinima = addDays(oggi, -ORIZZONTE_PASSATO);
  const dataMassima = addDays(oggi, ORIZZONTE_FUTURO);

  const [patients, slots, allSlotsAttivi, closures, skipped, cancellazioniNotCharged, cancellazioniTutte, tokenRows] =
    await Promise.all([
      supaGet("patients?select=*"),
      supaGet("patient_slots?select=*&active=eq.true"),
      supaGet("patient_slots?select=*&active=eq.true&order=patient_id"),
      supaGet("slot_closures?select=*"),
      supaGet("skipped_occurrences?select=patient_id,data"),
      supaGet("cancellations?select=*&billing_status=eq.not_charged"),
      supaGet("cancellations?select=patient_id,original_date"),
      supaGet("google_tokens?select=refresh_token"),
    ]);

  const patientsById = Object.fromEntries(patients.map((p) => [p.id, p]));
  const skippedSet = new Set(skipped.map((s) => `${s.patient_id}|${s.data}`));
  const cancellateSet = new Set(cancellazioniTutte.map((c) => `${c.patient_id}|${c.original_date}`));
  const refreshToken = tokenRows[0]?.refresh_token;
  if (!refreshToken) throw new Error("Nessun refresh_token salvato.");

  console.log(`Oggi: ${oggi}. Orizzonte calendario controllato: ${dataMinima} -> ${dataMassima}.\n`);
  console.log("Lettura calendario reale in corso...");
  const events = await fetchGoogleCalendarEvents(refreshToken, dataMinima, dataMassima);
  console.log(`${events.length} eventi letti.\n`);

  // --- A + B: disdette not_charged senza skipped_occurrences ---
  const nonCoperte = cancellazioniNotCharged.filter((c) => !skippedSet.has(`${c.patient_id}|${c.original_date}`));
  const slotsByPatientId = Object.fromEntries(allSlotsAttivi.map((s) => [s.patient_id, s]));

  const giaResuscitate = [];
  const rischioTeorico = [];
  for (const c of nonCoperte) {
    const patient = patientsById[c.patient_id];
    if (!patient) continue;
    const eventoReale = events.find(
      (e) => e.data === c.original_date && matchPatientForEvent(e.titolo, patients)?.patient.id === patient.id
    );
    if (eventoReale) {
      giaResuscitate.push({ data: c.original_date, nome: patient.nome_calendario, patientId: patient.id, eventId: eventoReale.id, eventoDescrizione: eventoReale.descrizione });
      continue;
    }
    const slot = slotsByPatientId[c.patient_id];
    if (!slot) continue;
    const dateAttese = new Set(occorrenzeFuture(slot, closures, ORIZZONTE_FUTURO, oggi));
    if (dateAttese.has(c.original_date)) {
      rischioTeorico.push({ data: c.original_date, nome: patient.nome_calendario, patientId: patient.id });
    }
  }

  console.log(`=== A) GIA' RESUSCITATE ORA (evento reale ricreato per una disdetta not_charged senza skipped_occurrences): ${giaResuscitate.length} ===`);
  for (const r of giaResuscitate.sort((a, b) => (a.data < b.data ? -1 : 1))) {
    console.log(`  [${r.patientId}] ${r.nome}  data=${r.data}  eventId=${r.eventId}  nota="${r.eventoDescrizione}"`);
  }

  console.log(`\n=== B) A RISCHIO TEORICO (verrebbero ricreate al prossimo "Genera occorrenze future", non ancora ricreate): ${rischioTeorico.length} ===`);
  for (const r of rischioTeorico.sort((a, b) => (a.data < b.data ? -1 : 1))) {
    console.log(`  [${r.patientId}] ${r.nome}  data=${r.data}`);
  }

  // --- C: eventi con nota "disdett*" mai registrati in cancellations ---
  const nonRegistrate = [];
  for (const e of events) {
    if (!DISDETTA_REGEX.test(e.descrizione || "")) continue;
    const match = matchPatientForEvent(e.titolo, patients);
    if (!match) {
      nonRegistrate.push({ data: e.data, titolo: e.titolo, nota: e.descrizione, eventId: e.id, patientId: null, nomeMatch: "NESSUN MATCH PAZIENTE" });
      continue;
    }
    const patient = match.patient;
    if (cancellateSet.has(`${patient.id}|${e.data}`)) continue; // già registrata (anche se charged)
    nonRegistrate.push({ data: e.data, titolo: e.titolo, nota: e.descrizione, eventId: e.id, patientId: patient.id, nomeMatch: patient.nome_calendario });
  }
  console.log(`\n=== C) EVENTI CON NOTA "disdett*" MAI REGISTRATI in cancellations: ${nonRegistrate.length} ===`);
  for (const r of nonRegistrate.sort((a, b) => (a.data < b.data ? -1 : 1))) {
    console.log(`  ${r.data}  "${r.titolo}" (${r.nomeMatch})  nota="${r.nota}"  eventId=${r.eventId}`);
  }

  // --- D: slot fissi attivi duplicati ---
  const gruppi = new Map();
  for (const s of allSlotsAttivi) {
    const chiave = `${s.patient_id}|${s.weekday}|${s.time_of_day}|${s.interval_days}|${s.anchor_date}`;
    if (!gruppi.has(chiave)) gruppi.set(chiave, []);
    gruppi.get(chiave).push(s);
  }
  const duplicati = [...gruppi.entries()].filter(([, rows]) => rows.length > 1);
  console.log(`\n=== D) SLOT FISSI ATTIVI DUPLICATI: ${duplicati.length} gruppi ===`);
  for (const [chiave, rows] of duplicati) {
    const p = patientsById[rows[0].patient_id];
    console.log(`  ${p?.nome_calendario || chiave}: righe id=[${rows.map((r) => r.id).join(",")}] (${rows.length} copie)`);
  }

  console.log("\n(sola lettura, nessuna scrittura eseguita)");
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
