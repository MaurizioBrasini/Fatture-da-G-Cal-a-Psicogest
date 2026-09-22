// Trasforma lo slot unico di "Riunione Scienziati" (oggi: mercoledì 9:00,
// durata_minuti=120) in DUE slot fissi separati sulla stessa cadenza
// quindicinale — 9:30 e 10:30 — esattamente come la tratterebbe il vecchio
// calendario Excel a fasce orarie (CALENDARIO PAZIENTI MENSILE.xlsx): un
// impegno di 2 ore che non rispetta i confini delle fasce satura comunque
// solo le fasce che tocca, non un calcolo di orario reale. Dry-run di
// default, --apply per scrivere.

import fs from "node:fs";

const envRaw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
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
async function supaPost(pathAndQuery, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase POST fallita: ${await res.text()}`);
}

const APPLY = process.argv.includes("--apply");

const patients = await supaGet("patients?select=id,nome_calendario,fatturare_a,user_id");
const riunione = patients.find((p) => /riunione scienziati/i.test(p.nome_calendario || p.fatturare_a || ""));
if (!riunione) {
  console.error("Paziente 'Riunione Scienziati' non trovato.");
  process.exit(1);
}

const slots = await supaGet(`patient_slots?patient_id=eq.${riunione.id}&active=eq.true&select=*`);
console.log(`Slot attivi attuali di "${riunione.nome_calendario}":`);
for (const s of slots) {
  console.log(`  #${s.id} weekday=${s.weekday} ora=${s.time_of_day} interval_days=${s.interval_days} anchor=${s.anchor_date} durata_minuti=${s.durata_minuti}`);
}

if (slots.length !== 1) {
  console.error(`\nAttesi esattamente 1 slot attivo, trovati ${slots.length} — controlla a mano prima di procedere.`);
  process.exit(1);
}

const vecchio = slots[0];
const nuovi = [
  { weekday: vecchio.weekday, time_of_day: "09:30:00", interval_days: vecchio.interval_days, anchor_date: vecchio.anchor_date },
  { weekday: vecchio.weekday, time_of_day: "10:30:00", interval_days: vecchio.interval_days, anchor_date: vecchio.anchor_date },
];

console.log(`\nPiano: disattivo lo slot #${vecchio.id} (9:00, 120') e creo 2 nuovi slot attivi:`);
for (const n of nuovi) console.log(`  weekday=${n.weekday} ora=${n.time_of_day} interval_days=${n.interval_days} anchor=${n.anchor_date}`);

if (!APPLY) {
  console.log("\nDry-run: nessuna scrittura. Rilancia con --apply per applicare.");
} else {
  await supaPatch(`patient_slots?id=eq.${vecchio.id}`, { active: false });
  await supaPost(
    "patient_slots",
    nuovi.map((n) => ({ user_id: riunione.user_id, patient_id: riunione.id, ...n, active: true }))
  );
  console.log("\nFatto: slot vecchio disattivato, 2 nuovi slot creati.");
}
