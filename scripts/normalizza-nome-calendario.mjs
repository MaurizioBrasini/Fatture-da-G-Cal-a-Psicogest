// Uniforma patients.nome_calendario al lettering "solo iniziali maiuscole"
// (es. "DAVIDE S." -> "Davide S.") con titleCaseNomeCalendario (logic.js),
// poi rinomina i titoli degli eventi su Google Calendar che non coincidono
// più col nuovo valore — stesso pattern già usato per l'audit maiuscole del
// 2026-09-08 (matchPatientForEvent per abbinare con sicurezza, mai indovinare
// su un titolo ambiguo). Richiesto da Maurizio 2026-09-11: lettering uniforme
// ovunque tranne "Storico fatture", che resta volutamente TUTTO MAIUSCOLO
// (gestito lato display in src/app/storico/page.js, non tocca i dati).
//
// Dry-run di default, --apply per scrivere davvero (patients + calendario).

import fs from "node:fs";
import { titleCaseNomeCalendario, matchPatientForEvent, todayISO, addDays } from "../src/lib/logic.js";
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
async function supaPatch(pathAndQuery, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH fallita: ${await res.text()}`);
}

const APPLY = process.argv.includes("--apply");

async function main() {
  const patients = await supaGet("patients?select=id,nome_calendario&order=id");
  const daCorreggere = patients
    .map((p) => ({ p, nuovo: titleCaseNomeCalendario(p.nome_calendario) }))
    .filter(({ p, nuovo }) => p.nome_calendario && nuovo !== p.nome_calendario);

  console.log(`Pazienti totali: ${patients.length}`);
  console.log(`Da correggere in patients.nome_calendario: ${daCorreggere.length}`);
  for (const { p, nuovo } of daCorreggere) {
    console.log(`  [${p.id}] "${p.nome_calendario}" -> "${nuovo}"`);
  }

  if (APPLY) {
    console.log("\nScrittura patients in corso...");
    for (const { p, nuovo } of daCorreggere) {
      await supaPatch(`patients?id=eq.${p.id}`, { nome_calendario: nuovo });
    }
    console.log(`Fatto: ${daCorreggere.length} pazienti aggiornati.`);
  } else {
    console.log("(dry-run — passa --apply per scrivere davvero, anche sul calendario)");
  }

  // Rilettura con i valori già normalizzati (se applicato) o quelli attesi
  // (se dry-run, per capire comunque quanti eventi calendario andranno
  // rinominati) per il confronto coi titoli reali.
  const patientsAttesi = APPLY
    ? await supaGet("patients?select=id,nome_calendario&order=id")
    : patients.map((p) => {
        const corretto = daCorreggere.find((d) => d.p.id === p.id);
        return corretto ? { ...p, nome_calendario: corretto.nuovo } : p;
      });

  const [{ refresh_token: refreshToken } = {}] = await supaGet("google_tokens?select=refresh_token");
  if (!refreshToken) throw new Error("Nessun refresh_token trovato.");

  const da = "2025-01-01";
  const a = addDays(todayISO(), 365);
  console.log(`\nLettura calendario reale (${da} -> ${a}) in corso...`);
  const events = await fetchGoogleCalendarEvents(refreshToken, da, a);

  // Solo differenze di SOLO CASING (es. "MIchela M." -> "Michela M." — stesso
  // testo se maiuscolizzato) — non tocchiamo titoli storici più corti/diversi
  // (es. "Josephine" per "Josephine P.G."): è un problema diverso (nomi
  // abbreviati in eventi vecchi, non lettering) e fuori dalla richiesta di
  // stasera; toccherebbe centinaia di eventi del 2025, non serve qui.
  const daRinominare = [];
  for (const e of events) {
    const match = matchPatientForEvent(e.titolo, patientsAttesi);
    if (!match) continue;
    const atteso = match.patient.nome_calendario;
    if (atteso && e.titolo !== atteso && e.titolo.toUpperCase() === atteso.toUpperCase()) {
      daRinominare.push({ eventId: e.id, data: e.data, vecchio: e.titolo, nuovo: atteso });
    }
  }

  console.log(`\nEventi calendario con titolo da uniformare: ${daRinominare.length}`);
  for (const r of daRinominare) {
    console.log(`  ${r.data}  "${r.vecchio}" -> "${r.nuovo}"`);
  }

  if (APPLY) {
    console.log("\nRinomina eventi calendario in corso...");
    let ok = 0;
    for (const r of daRinominare) {
      await updateGoogleCalendarEventTitle(refreshToken, r.eventId, r.nuovo);
      ok++;
      await new Promise((res) => setTimeout(res, 150));
    }
    console.log(`Fatto: ${ok} eventi rinominati.`);
  } else {
    console.log("\n(dry-run, passa --apply per scrivere davvero)");
  }
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
