// Assegna patient_slots.durata_minuti = 60 a tutti gli slot attivi che non
// ce l'hanno ancora (tutti i pazienti normali), lasciando intoccato
// "Riunione Scienziati" (durata reale diversa, gestita a parte). Passo 1
// del modello "G-Cal": prima le durate reali per tutti, poi la griglia
// ragiona per sovrapposizione oraria vera invece che per corrispondenza
// esatta. Dry-run di default, --apply per scrivere.

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

const APPLY = process.argv.includes("--apply");

const slots = await supaGet("patient_slots?active=eq.true&select=id,patient_id,weekday,time_of_day,interval_days,anchor_date,durata_minuti");
const patients = await supaGet("patients?select=id,nome_calendario,fatturare_a");
const patientsById = Object.fromEntries(patients.map((p) => [p.id, p]));

const GIORNI = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

console.log(`${slots.length} slot attivi totali.\n`);

const daImpostare = [];
for (const s of slots) {
  const p = patientsById[s.patient_id];
  const nome = p?.nome_calendario || p?.fatturare_a || `(paziente ${s.patient_id})`;
  const riga = `#${s.id} ${nome} — ${GIORNI[s.weekday]} ${s.time_of_day.slice(0, 5)} (ogni ${s.interval_days}gg, ancora ${s.anchor_date}) — durata_minuti attuale: ${s.durata_minuti ?? "null"}`;
  if (/riunione scienziati/i.test(nome)) {
    console.log(`RIUNIONE (lasciata stare da questo script): ${riga}`);
    continue;
  }
  if (s.durata_minuti != null) {
    console.log(`già impostata, salto: ${riga}`);
    continue;
  }
  console.log(`da impostare a 60: ${riga}`);
  daImpostare.push(s.id);
}

console.log(`\n${daImpostare.length} slot da impostare a durata_minuti=60.`);

if (!APPLY) {
  console.log("\nDry-run: nessuna scrittura. Rilancia con --apply per applicare.");
} else {
  for (const id of daImpostare) {
    await supaPatch(`patient_slots?id=eq.${id}`, { durata_minuti: 60 });
  }
  console.log(`\nFatto: ${daImpostare.length} slot aggiornati.`);
}
