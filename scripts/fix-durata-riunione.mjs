// One-off: la divisione in due slot di "Riunione Scienziati" (script
// dividi-riunione-scienziati.mjs) non aveva riportato durata_minuti sui
// nuovi slot, rimasti null. La imposta a 120 sui due slot attivi correnti.
import fs from "node:fs";

const envRaw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const patients = await (await fetch(`${SUPABASE_URL}/rest/v1/patients?select=id,nome_calendario,fatturare_a`, {
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
})).json();
const riunione = patients.find((p) => /riunione scienziati/i.test(p.nome_calendario || p.fatturare_a || ""));

const res = await fetch(`${SUPABASE_URL}/rest/v1/patient_slots?patient_id=eq.${riunione.id}&active=eq.true`, {
  method: "PATCH",
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
  body: JSON.stringify({ durata_minuti: 120 }),
});
console.log(res.status, await res.text());
