// Controllo/correzione degli eventi con orario segnati "Libero" da oggi a un
// anno: Google Appointment Schedule li ignora e offre la fascia ai pazienti
// (caso Valeria B./Chiara C., 13/10/2026). Anteprima di default; con --apply li
// rimette "Occupato" (tocca solo il campo transparency); con --solo "Titolo"
// limita ai soli eventi con quel titolo esatto.
import fs from "node:fs";
import { todayISO, addDays } from "../src/lib/logic.js";
import { fetchGoogleCalendarEvents, setGoogleCalendarEventBusy } from "../src/lib/googleCalendar.js";

const APPLY = process.argv.includes("--apply");
const iSolo = process.argv.indexOf("--solo");
const SOLO = iSolo >= 0 ? process.argv[iSolo + 1] : null;

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
const liberi = events.filter((e) => e.libero && e.ora && (!SOLO || e.titolo === SOLO));

console.log(`${events.length} eventi da ${oggi} a +365 gg, di cui ${liberi.length} con orario segnati "Libero":`);
for (const e of liberi) console.log(`  ${e.data} ${e.ora}  ${e.titolo}`);

if (!APPLY) {
  console.log("\n(anteprima, nessuna scrittura — rilanciare con --apply)");
} else {
  for (const e of liberi) await setGoogleCalendarEventBusy(refreshToken, e.id);
  console.log(`\nFatto: ${liberi.length} eventi impostati su "Occupato".`);
}

