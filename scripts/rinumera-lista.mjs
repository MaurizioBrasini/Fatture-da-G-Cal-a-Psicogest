// Rilancia Rinumera (calcolo + scrittura) su una lista di pazienti — stesso
// meccanismo di renumber-preview/renumber-confirm, usato qui in un unico
// script per il giro di pulizia note calendario disallineate del 2026-09-08.
// Nessuna modifica ad ancora_valore/ancora_data: solo le note vengono
// riscritte secondo quanto gia' corretto in patients.

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

const IDS = [164, 67, 103, 160, 34, 88, 30, 230, 258, 87, 393, 394, 395, 390, 136, 33];

async function main() {
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const settingsRows = await supaGet("settings?select=*");
  const settings = { ...DEFAULT_SETTINGS, ...settingsRows[0] };
  const events = await fetchGoogleCalendarEvents(refreshToken, "2026-06-01", "2026-11-30");
  const patients = await supaGet(`patients?select=*&id=in.(${IDS.join(",")})`);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const { access_token: accessToken } = await tokenRes.json();

  for (const p of patients) {
    const piano = computeRinumerazione(p, events, settings);
    const daScrivere = piano.filter((r) => r.cambia);
    console.log(`\n[${p.id}] ${p.fatturare_a || p.nome_calendario}: ${daScrivere.length} note da aggiornare`);
    for (const r of daScrivere) {
      const patchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(r.id)}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ description: r.descrizioneNuova }),
      });
      console.log(`   ${r.data} "${r.descrizioneOriginale}" -> "${r.descrizioneNuova}" (status ${patchRes.status})`);
      await new Promise((res) => setTimeout(res, 150));
    }
  }
  console.log("\n[FATTO]");
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
