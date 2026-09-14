// Sola lettura: diagnosi del problema di numerazione per "Stefania e Bruno".
import fs from "node:fs";
import { fetchGoogleCalendarEvents } from "../src/lib/googleCalendar.js";
import { computeRinumerazione, computePatientState, eventiDiPazienteOrdinati, matchPatientForEvent, DEFAULT_SETTINGS } from "../src/lib/logic.js";

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
  const allPatients = await supaGet("patients?select=*");
  const candidates = allPatients.filter((p) =>
    /stefania/i.test(p.nome_calendario || "") || /bruno/i.test(p.nome_calendario || "")
  );
  console.log("Pazienti candidati trovati:");
  for (const p of candidates) {
    console.log(`  id=${p.id} nome_calendario="${p.nome_calendario}" ancora_valore=${p.ancora_valore} ancora_data=${p.ancora_data} stato=${p.stato} soglia_fatturazione=${p.soglia_fatturazione}`);
  }

  const patient = candidates.find((p) => /stefania.*bruno|bruno.*stefania/i.test(p.nome_calendario || "")) || candidates[0];
  if (!patient) { console.error("Nessun paziente trovato."); return; }
  console.log(`\n=== Uso paziente id=${patient.id} "${patient.nome_calendario}" ===`);

  const slots = await supaGet(`patient_slots?select=*&patient_id=eq.${patient.id}`);
  console.log("\npatient_slots:");
  for (const s of slots) console.log(" ", JSON.stringify(s));

  const cancellazioni = await supaGet(`cancellations?select=*&patient_id=eq.${patient.id}`);
  console.log("\ncancellations:");
  for (const c of cancellazioni) console.log(" ", JSON.stringify(c));

  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const settingsRow = (await supaGet("settings?select=*"))[0];
  const settings = { ...DEFAULT_SETTINGS, ...settingsRow };
  const events = await fetchGoogleCalendarEvents(refreshToken, "2026-06-01", "2026-12-31");

  const eventiOrdinati = eventiDiPazienteOrdinati(patient, events, allPatients);
  console.log("\nEventi abbinati (da ancora_data in poi, ordine cronologico):");
  for (const e of eventiOrdinati) console.log(`  ${e.data} ${e.ora} id=${e.id} titolo="${e.titolo}" nota="${e.descrizione}"`);

  const tuttiEventiAbbinati = events
    .filter((e) => matchPatientForEvent(e.titolo, allPatients)?.patient.id === patient.id)
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  console.log("\nTUTTI gli eventi abbinati a questo paziente (ignorando ancora_data, per vedere cosa c'e' davvero):");
  for (const e of tuttiEventiAbbinati) console.log(`  ${e.data} ${e.ora} id=${e.id} titolo="${e.titolo}" nota="${e.descrizione}"`);

  const piano = computeRinumerazione(patient, events, settings, allPatients);
  console.log("\ncomputeRinumerazione (anteprima, NESSUNA SCRITTURA):");
  for (const r of piano) console.log(`  ${r.data} ${r.ora} : "${r.descrizioneOriginale}" -> "${r.descrizioneNuova}"`);

  const state = computePatientState(patient, events, settings, cancellazioni, allPatients);
  console.log("\ncomputePatientState:", JSON.stringify(state, null, 2));

  const fatture = await supaGet(`invoice_history?select=*&patient_id=eq.${patient.id}`);
  console.log("\ninvoice_history per questo paziente:");
  for (const f of fatture) console.log(" ", JSON.stringify(f));

  console.log("\n--- SIMULAZIONE ipotesi di correzione (ancora_valore=0, ancora_data=2026-06-23, il giorno dopo l'ultima seduta del vecchio ciclo 22/6 - stessa convenzione di confirmBatch: 'giorno dopo l'ultima seduta fatturata'), NESSUNA SCRITTURA ---");
  const patientIpotesi = { ...patient, ancora_valore: 0, ancora_data: "2026-06-23" };
  const rosterIpotesi = allPatients.map((p) => (p.id === patient.id ? patientIpotesi : p));
  const pianoIpotesi = computeRinumerazione(patientIpotesi, events, settings, rosterIpotesi);
  for (const r of pianoIpotesi) console.log(`  ${r.data} ${r.ora} : "${r.descrizioneOriginale}" -> "${r.descrizioneNuova}"`);
}

main().catch((e) => { console.error("ERRORE:", e); process.exit(1); });
