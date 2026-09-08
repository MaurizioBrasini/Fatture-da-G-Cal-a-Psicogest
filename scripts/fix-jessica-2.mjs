// Corregge patients.ancora_valore/ancora_data per Jessica M. (id 115),
// tornati sballati dopo il fix-jessica.mjs della sera 2026-09-07 (allora
// impostati a ancora_valore=5/ancora_data=2026-10-01, ora in DB risultano
// 0/2026-09-01 — qualcosa li ha sovrascritti, causa non identificata). Il
// suo evento del 3/9 ("R1 5") e' storico pre-nuovo-sistema, l'evento del
// 1/10 e' la sua 6a seduta reale (mai fatturata finora). Verificato con
// computeRinumerazione prima di scrivere.

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

const PATIENT_ID = 115;
const NUOVO_ANCORA_VALORE = 5;
const NUOVA_ANCORA_DATA = "2026-10-01";

async function main() {
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const settingsRows = await supaGet("settings?select=*");
  const settings = { ...DEFAULT_SETTINGS, ...settingsRows[0] };
  const events = await fetchGoogleCalendarEvents(refreshToken, "2026-06-01", "2026-11-30");

  await supaPatch(`patients?id=eq.${PATIENT_ID}`, { ancora_valore: NUOVO_ANCORA_VALORE, ancora_data: NUOVA_ANCORA_DATA });
  console.log(`[OK] ancora_valore=${NUOVO_ANCORA_VALORE}, ancora_data=${NUOVA_ANCORA_DATA} scritti per id=${PATIENT_ID}`);

  const [jessica] = await supaGet(`patients?select=*&id=eq.${PATIENT_ID}`);
  const piano = computeRinumerazione(jessica, events, settings);
  console.log("\nVerifica computeRinumerazione:");
  for (const r of piano) console.log(`  ${r.data} ${r.ora} : "${r.descrizioneOriginale}" -> "${r.descrizioneNuova}"`);

  const evento = piano.find((r) => r.data === "2026-10-01");
  if (!evento || evento.codice !== "R6 fatturare") {
    console.error(`\n[ATTENZIONE] Il 1/10 risulta "${evento?.codice}", non "R6 fatturare". Nessuna scrittura sul calendario.`);
    process.exit(1);
  }
  console.log(`\n[OK] Confermato: 2026-10-01 -> "R6 fatturare". Scrivo sul calendario.`);

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
