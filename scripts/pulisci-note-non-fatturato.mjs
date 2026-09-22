// Pulizia una tantum (richiesta di Maurizio 2026-09-22): computeRinumerazione
// ora salta del tutto i pazienti "non_fatturato" (non genera più codici
// "NF1", "NF2"...), ma un eventuale "Rinumera tutti" già girato in
// precedenza — da quando "Riunione Scienziati" era non_fatturato con slot
// attivo — potrebbe aver già scritto quel codice su note reali del
// calendario. Le toglie (stessa funzione chirurgica stripCodiceEsistente
// già usata da tutta l'app: tocca solo il codice riconosciuto, mai il
// resto della nota). Dry-run di default, --apply per scrivere.
//
// Uso: node scripts/pulisci-note-non-fatturato.mjs [--apply]

import fs from "node:fs";
import { stripCodiceEsistente, matchPatientForEvent, todayISO, addDays } from "../src/lib/logic.js";
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
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");

  const nonFatturati = patients.filter((p) => p.stato === "non_fatturato" && p.nome_calendario);
  if (!nonFatturati.length) {
    console.log("Nessun paziente 'non_fatturato' trovato.");
    return;
  }
  console.log(`Pazienti non_fatturato: ${nonFatturati.map((p) => p.nome_calendario).join(", ")}`);

  const oggi = todayISO();
  const dataMinima = addDays(oggi, -365);
  const dataMassima = addDays(oggi, 365);
  console.log(`Lettura eventi ${dataMinima} .. ${dataMassima}...`);
  const events = await fetchGoogleCalendarEvents(refreshToken, dataMinima, dataMassima);
  console.log(`${events.length} eventi letti.\n`);

  const daPulire = [];
  for (const e of events) {
    const match = matchPatientForEvent(e.titolo, patients);
    if (!match || !nonFatturati.includes(match.patient)) continue;
    const pulita = stripCodiceEsistente(e.descrizione || "").trim();
    if (pulita === (e.descrizione || "").trim()) continue; // niente da togliere
    daPulire.push({ id: e.id, data: e.data, titolo: e.titolo, originale: e.descrizione || "", pulita });
  }

  if (!daPulire.length) {
    console.log("Nessuna nota con un codice riconosciuto da togliere. Niente da fare.");
    return;
  }

  console.log(`${daPulire.length} note con un codice da togliere:`);
  for (const r of daPulire) {
    console.log(`  ${r.data} "${r.originale}" -> "${r.pulita}"`);
  }

  if (!APPLY) {
    console.log("\n(anteprima, nessuna scrittura — rilanciare con --apply per scrivere davvero)");
    return;
  }

  console.log("\n=== SCRITTURA ===");
  let scritti = 0;
  const errori = [];
  for (const r of daPulire) {
    try {
      await updateGoogleCalendarEventDescription(refreshToken, r.id, r.pulita);
      scritti++;
    } catch (e) {
      errori.push(`${r.data} (id ${r.id}): ${e.message}`);
    }
    await sleep(150);
  }
  console.log(`Scritti: ${scritti}/${daPulire.length}`);
  if (errori.length) {
    console.log(`Errori: ${errori.length}`);
    console.log(errori.map((e) => "  - " + e).join("\n"));
  }
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
