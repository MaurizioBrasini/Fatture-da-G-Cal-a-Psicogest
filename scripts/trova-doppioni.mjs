// Scansione sola lettura per trovare occorrenze doppie (stesso paziente,
// stessa data+ora) create dal ripopolamento calendario del 2026-09-07/08.
// Non scrive/cancella nulla — produce solo un elenco diagnostico.

import fs from "node:fs";
import { matchPatientForEvent, normalizeName } from "../src/lib/logic.js";

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

async function main() {
  const patients = await supaGet("patients?select=id,nome_calendario,fatturare_a");
  const events = JSON.parse(
    fs.readFileSync(
      "C:/Users/mabra/AppData/Local/Temp/claude/C--Github-Fatture-da-G-Cal-a-Psicogest/1c4dcc24-2c7e-4492-bfa3-641213cd94d4/scratchpad/all-events-sep8-feb1.json",
      "utf8"
    )
  );

  const gruppi = new Map(); // key: patientId|data|ora -> events[]
  for (const e of events) {
    if (e.status === "cancelled") continue;
    const m = matchPatientForEvent(e.summary, patients);
    if (!m) continue;
    const key = `${m.patient.id}|${e.data}|${e.ora}`;
    if (!gruppi.has(key)) gruppi.set(key, { patient: m.patient, eventi: [] });
    gruppi.get(key).eventi.push(e);
  }

  const doppioni = [...gruppi.values()].filter((g) => g.eventi.length > 1);
  doppioni.sort((a, b) => (a.eventi[0].data < b.eventi[0].data ? -1 : 1));

  console.log(`=== ${doppioni.length} slot con occorrenze doppie (o piu') trovati, oggi -> 2027-01-31 ===\n`);
  for (const g of doppioni) {
    const nome = g.patient.fatturare_a || g.patient.nome_calendario;
    console.log(`${nome} — ${g.eventi[0].data} ${g.eventi[0].ora} — ${g.eventi.length} eventi:`);
    for (const e of g.eventi) {
      console.log(`   id=${e.id}  recurringEventId=${e.recurringEventId || "(nessuno, evento singolo)"}  creato=${e.created}`);
    }
  }

  console.log(`\nTotale eventi coinvolti in doppioni: ${doppioni.reduce((s, g) => s + g.eventi.length, 0)}`);
  console.log(`Ultima data con doppione trovato: ${doppioni.length ? doppioni[doppioni.length - 1].eventi[0].data : "-"}`);
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
