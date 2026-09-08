// Corregge patients.ancora_valore per Carmine C. (id 41): Maurizio ha
// confermato che il 1/9 e' stata la sua 3a seduta (non registrata come tale
// sul calendario, nota rimasta "NpA 2"), quindi il 15/9 e' la 4a. ancora_data
// resta 2026-09-15 (l'evento del 15/9 e' il primo >= ancora_data), ancora_valore
// deve diventare 3 cosi' che 3+1=4. Verificato via computeRinumerazione prima
// di scrivere.

import fs from "node:fs";
import { fetchGoogleCalendarEvents } from "../src/lib/googleCalendar.js";
import { computeRinumerazione, DEFAULT_SETTINGS } from "../src/lib/logic.js";

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
async function supaPatch(pathAndQuery, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH fallita: ${await res.text()}`);
}

const PATIENT_ID = 41;
const NUOVO_ANCORA_VALORE = 3;

async function main() {
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const settingsRows = await supaGet("settings?select=*");
  const settings = { ...DEFAULT_SETTINGS, ...settingsRows[0] };
  const events = await fetchGoogleCalendarEvents(refreshToken, "2026-06-01", "2026-11-30");

  await supaPatch(`patients?id=eq.${PATIENT_ID}`, { ancora_valore: NUOVO_ANCORA_VALORE });
  console.log(`[OK] ancora_valore aggiornato a ${NUOVO_ANCORA_VALORE} per id=${PATIENT_ID}`);

  const [carmine] = await supaGet(`patients?select=*&id=eq.${PATIENT_ID}`);
  const piano = computeRinumerazione(carmine, events, settings);
  console.log("\nVerifica computeRinumerazione:");
  for (const r of piano) console.log(`  ${r.data} ${r.ora} : "${r.descrizioneOriginale}" -> "${r.descrizioneNuova}"`);

  const evento15 = piano.find((r) => r.data === "2026-09-15");
  if (!evento15 || !/^A4\b/.test(evento15.codice)) {
    console.error(`\n[ATTENZIONE] Il 15/9 risulta "${evento15?.codice}", non "A4...". Nessuna scrittura sul calendario, controllare a mano.`);
    process.exit(1);
  }
  console.log(`\n[OK] Confermato: 2026-09-15 -> "${evento15.codice}". Scrivo le note sul calendario.`);

  for (const r of piano.filter((r) => r.cambia)) {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    const { access_token: accessToken } = await tokenRes.json();
    const patchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(r.id)}`, {
      method: "PATCH", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ description: r.descrizioneNuova }),
    });
    console.log(`  scritto ${r.data} "${r.descrizioneNuova}" -> status ${patchRes.status}`);
    await new Promise((res) => setTimeout(res, 150));
  }
  console.log("\n[FATTO]");
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
