// Estensione dell'audit di stasera: controlla TUTTE le cancellations
// not_charged (non solo quelle SENZA skipped_occurrences) per vedere se
// esiste ancora/di nuovo un evento reale sul calendario per quel
// paziente+data. Scoperto stasera (Alessandra C. 15/9, Flavia e Edoardo
// 23/9): il backfill di ieri sera (backfill-skipped-occurrences.mjs) ha
// scritto skipped_occurrences per 7 pazienti SENZA verificare se l'evento
// fosse già stato ri-creato nel frattempo (la rigenerazione incriminata delle
// 17:28 del 10/9 era precedente al backfill delle 18:03) — quindi
// audit-resuscitati-completo.mjs (sezione A) non li vede: per lui quei
// pazienti "hanno già skipped_occurrences", punto, non ricontrolla se serviva
// anche una pulizia retroattiva. Sola lettura, non scrive nulla.

import fs from "node:fs";
import { fetchGoogleCalendarEvents } from "../src/lib/googleCalendar.js";
import { matchPatientForEvent } from "../src/lib/logic.js";

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

async function main() {
  const [patients, cancellazioni, tokenRows] = await Promise.all([
    supaGet("patients?select=*"),
    supaGet("cancellations?select=*&billing_status=eq.not_charged"),
    supaGet("google_tokens?select=refresh_token"),
  ]);
  const patientsById = Object.fromEntries(patients.map((p) => [p.id, p]));
  const refreshToken = tokenRows[0]?.refresh_token;

  const dataMinima = "2026-06-01";
  const dataMassima = "2027-03-10";
  console.log(`Lettura calendario reale (${dataMinima} -> ${dataMassima}) in corso...`);
  const events = await fetchGoogleCalendarEvents(refreshToken, dataMinima, dataMassima);
  console.log(`${events.length} eventi letti. Cancellations not_charged totali: ${cancellazioni.length}\n`);

  const resuscitati = [];
  for (const c of cancellazioni) {
    const patient = patientsById[c.patient_id];
    if (!patient) continue;
    const eventoReale = events.find(
      (e) => e.data === c.original_date && matchPatientForEvent(e.titolo, patients)?.patient.id === patient.id
    );
    if (eventoReale) {
      resuscitati.push({
        patientId: patient.id,
        nome: patient.nome_calendario,
        data: c.original_date,
        eventoOriginale: c.event_id,
        eventoAttuale: eventoReale.id,
        stessoEvento: eventoReale.id === c.event_id,
        notaAttuale: eventoReale.descrizione,
        colorId: eventoReale.colorId,
      });
    }
  }

  console.log(`=== Disdette not_charged con un evento reale ANCORA/DI NUOVO presente sulla data: ${resuscitati.length} ===`);
  for (const r of resuscitati.sort((a, b) => (a.data < b.data ? -1 : 1))) {
    console.log(
      `  [${r.patientId}] ${r.nome}  data=${r.data}  ${r.stessoEvento ? "STESSO EVENTO (mai cancellato?!)" : "EVENTO DIVERSO (risorto)"}  eventId=${r.eventoAttuale}  nota="${r.notaAttuale}"`
    );
  }
  console.log("\n(sola lettura, nessuna scrittura eseguita)");
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
