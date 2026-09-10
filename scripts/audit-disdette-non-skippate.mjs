// Diagnostico, sola lettura: trova le disdette paziente (cancellations,
// billing_status=not_charged) che NON hanno una riga skipped_occurrences
// corrispondente (il bug corretto in aggiorna-confirm da 0689823) e verifica,
// rilanciando la stessa identica logica di genera-occorrenze-preview, se
// quella data verrebbe DAVVERO riproposta per la ricreazione se si rilancia
// "Genera occorrenze future" adesso — cioè se il rischio è reale o solo
// teorico (es. il paziente è uscito dalla programmazione fissa nel frattempo,
// o quella data è già fuori dall'orizzonte di generazione).
// Non scrive nulla.

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

const ORIZZONTE_GIORNI = 90; // ampio apposta: vogliamo vedere tutto ciò che potrebbe ricomparire, non solo le prossime 2 settimane

async function main() {
  const oggi = todayISO();
  const dataMassima = addDays(oggi, ORIZZONTE_GIORNI);

  const [patients, slots, closures, skipped, cancellazioni, tokenRows] = await Promise.all([
    supaGet("patients?select=*"),
    supaGet("patient_slots?select=*&active=eq.true"),
    supaGet("slot_closures?select=*"),
    supaGet("skipped_occurrences?select=patient_id,data"),
    supaGet("cancellations?select=*&billing_status=eq.not_charged"),
    supaGet("google_tokens?select=refresh_token"),
  ]);

  const skippedSet = new Set(skipped.map((s) => `${s.patient_id}|${s.data}`));
  const patientsById = Object.fromEntries(patients.map((p) => [p.id, p]));
  const refreshToken = tokenRows[0]?.refresh_token;
  if (!refreshToken) throw new Error("Nessun refresh_token salvato.");

  console.log(`Oggi: ${oggi}. Orizzonte controllato: fino a ${dataMassima}.`);
  console.log(`Disdette not_charged totali in cancellations: ${cancellazioni.length}`);
  console.log(`Righe skipped_occurrences esistenti: ${skipped.length}\n`);

  // Le disdette senza skipped_occurrences corrispondente, filtrate a quelle
  // ancora nel futuro/orizzonte (le passate non le rigenererebbe comunque,
  // occorrenzeFuture scarta tutto ciò che è < oggi).
  const nonCoperte = cancellazioni.filter(
    (c) => !skippedSet.has(`${c.patient_id}|${c.original_date}`) && c.original_date <= dataMassima
  );
  console.log(`Disdette senza skipped_occurrences E ancora entro l'orizzonte: ${nonCoperte.length}`);
  if (!nonCoperte.length) {
    console.log("Nessuna a rischio teorico. Fine.");
    return;
  }
  for (const c of nonCoperte) {
    const p = patientsById[c.patient_id];
    console.log(`  - ${c.original_date}  ${p?.nome_calendario || "id=" + c.patient_id}  (disdetta registrata il ${c.cancelled_at?.slice(0, 10)})`);
  }

  // Ora il controllo vero: rilanciamo la stessa logica di
  // genera-occorrenze-preview per vedere quali di queste date verrebbero
  // DAVVERO riproposte oggi (serve leggere il calendario reale).
  console.log("\nLettura calendario reale in corso...");
  const events = await fetchGoogleCalendarEvents(refreshToken, addDays(oggi, -14), dataMassima);

  const slotsByPatientId = Object.fromEntries(slots.map((s) => [s.patient_id, s]));
  const rischioReale = [];
  for (const c of nonCoperte) {
    const patient = patientsById[c.patient_id];
    const slot = slotsByPatientId[c.patient_id];
    if (!patient || !slot) continue; // paziente non più a cadenza fissa: nessun motore lo tocca più
    const dateAttese = new Set(occorrenzeFuture(slot, closures, ORIZZONTE_GIORNI, oggi));
    if (!dateAttese.has(c.original_date)) continue; // la matematica non se lo aspetta più su questa data (es. cambiata frequenza/ancora nel frattempo)
    const esisteGia = events.some(
      (e) => e.data === c.original_date && matchPatientForEvent(e.titolo, patients)?.patient.id === patient.id
    );
    if (esisteGia) continue; // già ricreato (come i 2 di oggi) o mai davvero rimosso
    rischioReale.push({ data: c.original_date, nome: patient.nome_calendario, patientId: patient.id });
  }

  console.log(`\n=== A RISCHIO REALE: verrebbero ricreate al prossimo "Genera occorrenze future" (${rischioReale.length}) ===`);
  for (const r of rischioReale.sort((a, b) => (a.data < b.data ? -1 : 1))) {
    console.log(`  ${r.data}  ${r.nome}`);
  }
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
