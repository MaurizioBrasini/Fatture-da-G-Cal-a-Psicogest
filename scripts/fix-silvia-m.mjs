// Corregge patients.ancora_valore per Silvia M. (id 413, fuori schema).
// L'evento del 23/9/2026 è il suo 5° incontro nel ciclo di fatturazione
// corrente (mai fatturata finora) ma con ancora_valore=4 il motore di
// rinumerazione lo ricalcolava come "R1", perché ancora_data=2026-07-01
// include anche l'evento di quel giorno (nota storica "Np4") nel conteggio
// — ancora_valore deve rappresentare SOLO le sedute già contate PRIMA di
// ancora_data (il 6/3 "Np3"), quindi 3, non 4. Con ancora_valore=3:
// 07-01 diventa R4, 09-23 diventa R5 fatturare. Verificato via
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

const PATIENT_ID = 413;
const NUOVO_ANCORA_VALORE = 3;

async function main() {
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const [{ data: settingsRow }] = [{ data: (await supaGet("settings?select=*"))[0] }];
  const settings = { ...DEFAULT_SETTINGS, ...settingsRow };
  const events = await fetchGoogleCalendarEvents(refreshToken, "2026-06-01", "2026-11-30");

  await supaPatch(`patients?id=eq.${PATIENT_ID}`, { ancora_valore: NUOVO_ANCORA_VALORE });
  console.log(`[OK] patients.ancora_valore aggiornato a ${NUOVO_ANCORA_VALORE} per id=${PATIENT_ID}`);

  const [silviaM] = await supaGet(`patients?select=*&id=eq.${PATIENT_ID}`);
  const piano = computeRinumerazione(silviaM, events, settings);
  console.log("\nVerifica computeRinumerazione con il valore appena scritto:");
  for (const r of piano) console.log(`  ${r.data} ${r.ora} : "${r.descrizioneOriginale}" -> "${r.descrizioneNuova}"`);

  const eventoChiave = piano.find((r) => r.data === "2026-09-23");
  if (!eventoChiave || eventoChiave.codice !== "R5 fatturare") {
    console.error(`\n[ATTENZIONE] L'evento del 23/9 risulta "${eventoChiave?.codice}", non "R5 fatturare". NON ho scritto nulla sul calendario, controllare a mano.`);
    process.exit(1);
  }
  console.log('\n[OK] Confermato: 2026-09-23 -> "R5 fatturare". Procedo a scrivere le note sul calendario.');

  for (const r of piano.filter((r) => r.cambia)) {
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(r.id)}`;
    const accessTokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    const { access_token: accessToken } = await accessTokenRes.json();
    const patchRes = await fetch(url, {
      method: "PATCH", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ description: r.descrizioneNuova }),
    });
    console.log(`  scritto ${r.data} "${r.descrizioneNuova}" -> status ${patchRes.status}`);
    await new Promise((res) => setTimeout(res, 150));
  }
  console.log("\n[FATTO]");
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
