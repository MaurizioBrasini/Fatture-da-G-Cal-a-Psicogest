// Backfill una tantum di generated_occurrences (schema_addendum11.sql):
// senza questo, la protezione anti-resuscitazione varrebbe solo per le
// occorrenze create da ORA in poi da "Genera occorrenze future" — tutti gli
// appuntamenti futuri già pianificati resterebbero scoperti (se cancellati
// a mano su Google Calendar, verrebbero ancora silenziosamente ricreati).
// Per ogni paziente con uno slot fisso attivo, segna come "generata" ogni
// data futura che ha oggi un evento reale abbinato — non serve che
// coincida perfettamente con la matematica anchor_date+interval (copre
// anche appuntamenti leggermente spostati a mano). Idempotente (upsert),
// nessun impatto su dati esistenti. Dry-run di default, --apply per
// scrivere davvero.

import fs from "node:fs";
import { fetchGoogleCalendarEvents } from "../src/lib/googleCalendar.js";
import { matchPatientForEvent, todayISO, addDays } from "../src/lib/logic.js";

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
async function supaUpsert(pathAndQuery, body) {
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}${sep}on_conflict=patient_id,data`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase UPSERT fallita: ${await res.text()}`);
}

const APPLY = process.argv.includes("--apply");

async function main() {
  const [patients, slots, tokenRows] = await Promise.all([
    supaGet("patients?select=id,nome_calendario"),
    supaGet("patient_slots?select=patient_id&active=eq.true"),
    supaGet("google_tokens?select=refresh_token"),
  ]);
  const patientIdsConSlot = new Set(slots.map((s) => s.patient_id));
  const refreshToken = tokenRows[0]?.refresh_token;
  if (!refreshToken) throw new Error("Nessun refresh_token trovato.");

  const oggi = todayISO();
  const dataMassima = addDays(oggi, 400);
  console.log(`Lettura calendario reale (${oggi} -> ${dataMassima}) in corso...`);
  const events = await fetchGoogleCalendarEvents(refreshToken, oggi, dataMassima);

  const daScrivere = [];
  for (const e of events) {
    if (e.data <= oggi) continue;
    const match = matchPatientForEvent(e.titolo, patients);
    if (!match || !patientIdsConSlot.has(match.patient.id)) continue;
    daScrivere.push({ user_id: null, patient_id: match.patient.id, data: e.data, nome: match.patient.nome_calendario });
  }

  console.log(`Occorrenze future da segnare come "generate": ${daScrivere.length}`);

  if (!APPLY) {
    console.log("(dry-run, passa --apply per scrivere davvero)");
    return;
  }

  const [{ user_id }] = await supaGet("patient_slots?select=user_id&limit=1");
  console.log("\nScrittura in corso...");
  const CHUNK = 200;
  for (let i = 0; i < daScrivere.length; i += CHUNK) {
    const blocco = daScrivere.slice(i, i + CHUNK).map((r) => ({ user_id, patient_id: r.patient_id, data: r.data }));
    await supaUpsert("generated_occurrences", blocco);
  }
  console.log(`Fatto: ${daScrivere.length} righe scritte (upsert, eventuali duplicati ignorati).`);
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
