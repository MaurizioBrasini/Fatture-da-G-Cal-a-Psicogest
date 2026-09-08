// Applica il flusso "Rinumera" già esistente nell'app (api/calendar/renumber-
// preview + renumber-confirm) da riga di comando, per scrivere i codici
// R/A/S + numero progressivo + "fatturare" a soglia + nota "deve X€" sulle
// sedute — incluse le occorrenze create stanotte da ripopola-calendario.mjs,
// che sono state create con descrizione vuota apposta (i codici li scrive
// questo script, non il generatore). Nessuna logica di numerazione nuova:
// riusa computeRinumerazione/updateGoogleCalendarEventDescription già
// testati, stessa identica logica del bottone in app.
//
// Uso: node scripts/rinumera-calendario.mjs [--apply]
// Senza --apply: solo anteprima (stampa cosa cambierebbe, non scrive nulla).

import fs from "node:fs";
import { computeRinumerazione, DEFAULT_SETTINGS, todayISO, addDays } from "../src/lib/logic.js";
import { fetchGoogleCalendarEvents, updateGoogleCalendarEventDescription } from "../src/lib/googleCalendar.js";

const APPLY = process.argv.includes("--apply");

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
  if (!res.ok) throw new Error(`Supabase GET ${pathAndQuery} fallita: ${await res.text()}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const patients = await supaGet("patients?select=*");
  const [settingsRow] = await supaGet("settings?select=*");
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const settings = { ...DEFAULT_SETTINGS, ...(settingsRow || {}) };

  const target = patients.filter((p) => p.nome_calendario);
  const oggi = todayISO();
  const dataMinima = target.reduce((min, p) => (p.ancora_data && (!min || p.ancora_data < min) ? p.ancora_data : min), null) || oggi;
  const dataMassima = addDays(oggi, 90);

  console.log(`Lettura eventi ${dataMinima} .. ${dataMassima} per ${target.length} pazienti...`);
  const events = await fetchGoogleCalendarEvents(refreshToken, dataMinima, dataMassima);
  console.log(`${events.length} eventi letti.\n`);

  let totaleCambi = 0;
  const daScrivere = [];
  for (const p of target) {
    const piano = computeRinumerazione(p, events, settings).filter((r) => r.cambia);
    if (!piano.length) continue;
    totaleCambi += piano.length;
    console.log(`${p.fatturare_a || p.nome_calendario}: ${piano.length} note da aggiornare`);
    for (const r of piano) {
      console.log(`   ${r.data} "${r.descrizioneOriginale}" -> "${r.descrizioneNuova}"`);
      daScrivere.push(r);
    }
  }
  console.log(`\nTotale note da scrivere: ${totaleCambi}`);

  if (!APPLY) {
    console.log("\n(anteprima, nessuna scrittura — rilanciare con --apply per scrivere davvero)");
    return;
  }

  console.log("\n=== SCRITTURA ===");
  let scritti = 0;
  const errori = [];
  for (const r of daScrivere) {
    try {
      await updateGoogleCalendarEventDescription(refreshToken, r.id, r.descrizioneNuova);
      scritti++;
    } catch (e) {
      errori.push(`${r.data} (id ${r.id}): ${e.message}`);
    }
    await sleep(150);
  }
  console.log(`Scritti: ${scritti}/${daScrivere.length}`);
  if (errori.length) {
    console.log(`Errori: ${errori.length}`);
    console.log(errori.map((e) => "  - " + e).join("\n"));
  }
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
