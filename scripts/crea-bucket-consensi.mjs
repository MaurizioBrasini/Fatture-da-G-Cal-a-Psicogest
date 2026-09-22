// One-off: crea il bucket Supabase Storage "consensi" (privato — sono
// documenti sanitari/consenso informato, mai pubblici) per la firma di
// Maurizio e i PDF generati dai moduli compilati.
import fs from "node:fs";

const envRaw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
  method: "POST",
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ id: "consensi", name: "consensi", public: false }),
});
console.log(res.status, await res.text());
