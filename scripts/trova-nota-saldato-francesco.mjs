import fs from "node:fs";
import { matchPatientForEvent, todayISO, addDays } from "../src/lib/logic.js";
import { fetchGoogleCalendarEvents } from "../src/lib/googleCalendar.js";

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
  return res.json();
}

const patients = await supaGet("patients?select=*");
const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
const oggi = todayISO();
const events = await fetchGoogleCalendarEvents(refreshToken, addDays(oggi, -60), addDays(oggi, 30));

const francesco = patients.find((p) => p.nome_calendario === "Francesco Mer.");
const suoi = events.filter((e) => matchPatientForEvent(e.titolo, patients)?.patient.id === francesco.id);
for (const e of suoi) {
  console.log(e.data, e.id, JSON.stringify(e.descrizione));
}
