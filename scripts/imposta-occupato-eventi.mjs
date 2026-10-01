// One-off 2026-10-01: Chiara C. ha prenotato online martedì 13/10 alle 10:30,
// fascia già occupata da Valeria B. — il suo evento era segnato "Libero"
// (transparency: transparent) e Google Appointment Schedule ignora gli eventi
// "Libero". Questo script trova tutti gli eventi con orario (non "tutto il
// giorno") da oggi in poi segnati "Libero" e li rimette "Occupato".
// Anteprima di default; con --apply scrive. Tocca solo il campo transparency.
import fs from "node:fs";
import { todayISO, addDays } from "../src/lib/logic.js";
import { fetchGoogleCalendarEvents, setGoogleCalendarEventBusy } from "../src/lib/googleCalendar.js";

const APPLY = process.argv.includes("--apply");

const envRaw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;

const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/google_tokens?select=refresh_token`, {
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
});
const [{ refresh_token: refreshToken }] = await res.json();

const oggi = todayISO();
const events = await fetchGoogleCalendarEvents(refreshToken, oggi, addDays(oggi, 365));
const liberi = events.filter((e) => e.libero && e.ora && (!process.env.ONLY || e.titolo === process.env.ONLY));

console.log(`${events.length} eventi da ${oggi} a +365 gg, di cui ${liberi.length} con orario segnati "Libero":`);
for (const e of liberi) console.log(`  ${e.data} ${e.ora}  ${e.titolo}`);

if (!APPLY) {
  console.log("\n(anteprima, nessuna scrittura — rilanciare con --apply)");
} else {
  for (const e of liberi) await setGoogleCalendarEventBusy(refreshToken, e.id);
  console.log(`\nFatto: ${liberi.length} eventi impostati su "Occupato".`);
}

