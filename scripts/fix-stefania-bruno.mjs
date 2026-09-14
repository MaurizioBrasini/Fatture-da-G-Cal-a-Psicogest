// Corregge patients.ancora_valore/ancora_data per "Stefania e Bruno" (id 64).
// Diagnosi completa: vedi scripts/diagnosi-stefania-bruno.mjs. L'appuntamento
// del 22/6 ("Np 5") ha chiuso il vecchio ciclo pre-app (nessuna riga in
// invoice_history per questo paziente: quella fattura è avvenuta fuori
// dall'app). ancora_data era rimasta a 2026-09-23 (giorno del patient_slot,
// creato il 7/9), che esclude dal conteggio l'appuntamento reale del 16/9
// (nota vecchia "Np 5" mai aggiornata) — risultato: il 23/9 veniva contato
// come "R5 fatturare" invece che il 16/9 come inizio nuovo ciclo (R1).
// Fix: ancora_data = 2026-06-23 (giorno dopo l'ultima seduta del vecchio
// ciclo, stessa convenzione usata da confirmBatch in src/app/page.js:
// "ancora_data punta al primo giorno NON ancora fatturato"), ancora_valore=0.
// NON tocca patient_slots (id 16, anchor_date 2026-09-23, weekday
// mercoledì, ogni 14gg) — completamente indipendente, governa solo la
// generazione delle occorrenze future, non il conteggio.

import fs from "node:fs";
import { fetchGoogleCalendarEvents, updateGoogleCalendarEventDescription } from "../src/lib/googleCalendar.js";
import { computeRinumerazione, DEFAULT_SETTINGS } from "../src/lib/logic.js";

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
async function supaPatch(pathAndQuery, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH fallita: ${await res.text()}`);
}

const PATIENT_ID = 64;
const NUOVA_ANCORA_DATA = "2026-06-23";
const NUOVO_ANCORA_VALORE = 0;

async function main() {
  const allPatients = await supaGet("patients?select=*");
  const before = allPatients.find((p) => p.id === PATIENT_ID);
  if (!before) throw new Error(`Paziente id ${PATIENT_ID} non trovato.`);
  console.log(`Prima: ancora_valore=${before.ancora_valore} ancora_data=${before.ancora_data}`);

  await supaPatch(`patients?id=eq.${PATIENT_ID}`, { ancora_valore: NUOVO_ANCORA_VALORE, ancora_data: NUOVA_ANCORA_DATA });
  console.log(`[OK] patients.ancora_valore=${NUOVO_ANCORA_VALORE}, ancora_data=${NUOVA_ANCORA_DATA} scritti.`);

  const patientsAfter = await supaGet("patients?select=*");
  const patient = patientsAfter.find((p) => p.id === PATIENT_ID);

  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const settingsRow = (await supaGet("settings?select=*"))[0];
  const settings = { ...DEFAULT_SETTINGS, ...settingsRow };
  const events = await fetchGoogleCalendarEvents(refreshToken, "2026-06-01", "2026-12-31");

  const piano = computeRinumerazione(patient, events, settings, patientsAfter);
  console.log("\nVerifica computeRinumerazione con i dati appena scritti:");
  for (const r of piano) console.log(`  ${r.data} ${r.ora} : "${r.descrizioneOriginale}" -> "${r.descrizioneNuova}"`);

  const atteso = { "2026-09-16": "R1", "2026-09-23": "R2", "2026-10-07": "R3", "2026-10-21": "R4", "2026-11-04": "R5 fatturare" };
  for (const [data, codiceAtteso] of Object.entries(atteso)) {
    const riga = piano.find((r) => r.data === data);
    if (!riga || riga.codice !== codiceAtteso) {
      console.error(`\n[ATTENZIONE] ${data} risulta "${riga?.codice}", non "${codiceAtteso}". NON scrivo nulla sul calendario, controllare a mano.`);
      process.exit(1);
    }
  }
  console.log("\n[OK] Tutti e 5 i codici attesi confermati. Scrivo le note sul calendario.");

  for (const r of piano.filter((r) => r.cambia)) {
    await updateGoogleCalendarEventDescription(refreshToken, r.id, r.descrizioneNuova);
    console.log(`  scritto ${r.data} "${r.descrizioneNuova}"`);
    await new Promise((res) => setTimeout(res, 150));
  }
  console.log("\n[FATTO]");
}

main().catch((e) => { console.error("ERRORE:", e); process.exit(1); });
