// Corregge patients.ancora_data per "Francesca S." (id 222).
// Diagnosi: oggi 2026-09-29 la 5a seduta del ciclo (19/5, 15/6, 14/7, 15/9,
// 29/9) è stata segnata correttamente "A5 fatturare deve 100 dati oggi", ma
// prima che la fattura fosse generata e confermata è stata impostata la
// nuova cadenza mensile (patient_slots id 81/82, creati oggi alle 9:39-9:40,
// ancora 2026-10-12) e questo ha spostato ancora_data a 2026-10-11 — nel
// futuro rispetto a tutte e 5 le sedute del ciclo, che quindi sono sparite
// dal conteggio (count tornato a 0, stato "senza_sedute", nessuna riga in
// invoice_history: la fattura non è mai stata confermata).
// Fix: ancora_data = 2026-05-06 (giorno dopo l'ultima seduta del ciclo
// precedente, "NpA 5 dato contante" del 5/5), stessa convenzione già usata
// da confirmBatch in src/app/page.js. Verificato con computePatientState
// (script scripts/diagnosi-francesca-tmp.mjs, sola lettura): torna
// count=5, stato="pronto", usati = esattamente le 5 sedute del ciclo.
// NON tocca patient_slots (81/82, cadenza mensile futura): indipendente dal
// conteggio, corretto così com'è per il nuovo ciclo dal 12/10 in poi.

import fs from "node:fs";
import { fetchGoogleCalendarEvents } from "../../src/lib/googleCalendar.js";
import { computePatientState, DEFAULT_SETTINGS } from "../../src/lib/logic.js";

const envRaw = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
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

const PATIENT_ID = 222;
const NUOVA_ANCORA_DATA = "2026-05-06";

async function main() {
  const allPatients = await supaGet("patients?select=*");
  const before = allPatients.find((p) => p.id === PATIENT_ID);
  if (!before) throw new Error(`Paziente id ${PATIENT_ID} non trovato.`);
  if (before.nome_calendario !== "Francesca S." || before.ancora_data !== "2026-10-11") {
    console.error(`ATTENZIONE: stato inatteso (nome="${before.nome_calendario}" ancora_data=${before.ancora_data}), mi fermo senza scrivere.`);
    process.exit(1);
  }
  console.log(`Prima: ancora_valore=${before.ancora_valore} ancora_data=${before.ancora_data}`);

  await supaPatch(`patients?id=eq.${PATIENT_ID}`, { ancora_data: NUOVA_ANCORA_DATA });
  console.log(`[OK] patients.ancora_data=${NUOVA_ANCORA_DATA} scritto.`);

  const patientsAfter = await supaGet("patients?select=*");
  const patient = patientsAfter.find((p) => p.id === PATIENT_ID);
  const cancellazioni = await supaGet(`cancellations?select=*&patient_id=eq.${PATIENT_ID}`);
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const settingsRow = (await supaGet("settings?select=*"))[0];
  const settings = { ...DEFAULT_SETTINGS, ...settingsRow };
  const events = await fetchGoogleCalendarEvents(refreshToken, "2026-01-01", "2026-11-30");

  const state = computePatientState(patient, events, settings, cancellazioni, patientsAfter);
  console.log("\nVerifica computePatientState con il dato appena scritto:");
  console.log(JSON.stringify({ count: state.count, soglia: state.soglia, stato: state.stato, ultimaData: state.ultimaData, usatiDate: state.usati.map((u) => u.data) }, null, 2));

  if (state.count !== 5 || state.stato !== "pronto") {
    console.error("\n[ATTENZIONE] Il risultato non è quello atteso (count=5, stato=pronto). Controllare a mano.");
    process.exit(1);
  }
  console.log("\n[OK] count=5, stato=pronto, sedute corrette. Ora genera/conferma la fattura dalla Dashboard.");
}

main().catch((e) => { console.error("ERRORE:", e); process.exit(1); });
