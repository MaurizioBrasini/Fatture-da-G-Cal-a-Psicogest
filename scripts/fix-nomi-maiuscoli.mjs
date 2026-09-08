// Corregge il titolo degli eventi calendario generati con nome paziente
// tutto in maiuscolo (es. "ISABELLA E SIMONE" -> "Isabella e Simone"),
// per allinearli a patients.nome_calendario, già corretto da Maurizio
// nell'app. Rinomina SOLO il titolo (summary): non tocca descrizione,
// orario o colore.

import fs from "node:fs";
import { fetchGoogleCalendarEvents, updateGoogleCalendarEventTitle } from "../src/lib/googleCalendar.js";

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

// Mappa titolo-maiuscolo-attuale -> nome_calendario corretto (verificato a
// mano contro la tabella patients prima di lanciare lo script).
const CORREZIONI = {
  "GIULIA E GIUSEPPE": "Giulia e Giuseppe",
  "CATERINA E FILIPPO": "Caterina e Filippo",
  "ISABELLA E SIMONE": "Isabella e Simone",
  "FLAVIA E EDOARDO": "Flavia e Edoardo",
  "ALESSIA C.": "Alessia C.",
  "SILVIA F.": "Silvia F.",
};

const APPLY = process.argv.includes("--apply");

async function main() {
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const events = await fetchGoogleCalendarEvents(refreshToken, "2025-01-01", "2027-06-30");

  const daCorreggere = events.filter((e) => CORREZIONI[e.titolo]);
  console.log(`Trovati ${daCorreggere.length} eventi da rinominare.${APPLY ? "" : " (dry-run, passa --apply per scrivere)"}\n`);

  for (const e of daCorreggere) {
    const nuovo = CORREZIONI[e.titolo];
    console.log(`${e.data} ${e.ora} id=${e.id} : "${e.titolo}" -> "${nuovo}"`);
    if (APPLY) {
      await updateGoogleCalendarEventTitle(refreshToken, e.id, nuovo);
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  console.log(`\n${APPLY ? "Fatto." : "Dry-run completato, nessuna scrittura effettuata."}`);
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
