// Riconciliazione richiesta da Maurizio: per ciascun paziente attivo, trova
// l'ultima seduta utile PRIMA del 31 agosto 2026 (la fonte che Maurizio ha
// usato per compilare a mano i dati pazienti in app) e il codice NP/NF/R/A/S
// che aveva scritto quel giorno — da confrontare con ancora_valore/ancora_data
// attuali. Incrocia DUE fonti indipendenti: la query diretta su Google
// Calendar (fetchGoogleCalendarEvents) e il dump completo .ics esportato da
// Maurizio (Appunti/Settings/*.ical.zip, decompresso), per non fidarsi solo
// della prima sugli eventi piu' vecchi. Sola lettura, nessuna scrittura.

import fs from "node:fs";
import { fetchGoogleCalendarEvents } from "../src/lib/googleCalendar.js";
import { matchPatientForEvent, normalizeName } from "../src/lib/logic.js";

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

const SOGLIA = "2026-08-31";

// ---------------------------------------------------------------------
// Parser ICS minimale: unfold delle righe continuate, split in VEVENT,
// espansione RRULE settimanale/quindicinale (l'unico pattern usato in
// questo calendario per le sedute), applicazione EXDATE e override
// RECURRENCE-ID.
// ---------------------------------------------------------------------

function unfoldIcs(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function parseIcsDate(raw) {
  // "20260902T163000" (locale, con TZID a parte) oppure "20260902T163000Z" (UTC)
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo}-${d}`;
}

function parseVEvents(icsText) {
  const blocks = icsText.split("BEGIN:VEVENT").slice(1).map((b) => b.split("END:VEVENT")[0]);
  const events = [];
  for (const b of blocks) {
    const lines = b.split("\n").filter(Boolean);
    const get = (prefix) => {
      const l = lines.find((l) => l.startsWith(prefix));
      return l ? l.slice(l.indexOf(":") + 1).trim() : null;
    };
    const dtstartLine = lines.find((l) => l.startsWith("DTSTART"));
    const dtstart = dtstartLine ? parseIcsDate(dtstartLine.split(":")[1]) : null;
    const recurrenceIdLine = lines.find((l) => l.startsWith("RECURRENCE-ID"));
    const recurrenceId = recurrenceIdLine ? parseIcsDate(recurrenceIdLine.split(":")[1]) : null;
    const rrule = get("RRULE");
    const exdateLines = lines.filter((l) => l.startsWith("EXDATE"));
    const exdates = exdateLines.flatMap((l) => l.slice(l.indexOf(":") + 1).split(",").map(parseIcsDate));
    events.push({
      summary: get("SUMMARY") || "",
      description: get("DESCRIPTION") || "",
      uid: get("UID"),
      dtstart, rrule, recurrenceId, exdates,
    });
  }
  return events;
}

function addDaysIso(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// Espande un master RRULE (solo FREQ=WEEKLY, il pattern usato qui) in date
// reali fino a "fino" incluso, applicando UNTIL/EXDATE.
function espandiRicorrenza(ev, fino) {
  if (!ev.rrule || !ev.dtstart) return [ev.dtstart].filter(Boolean);
  const parts = Object.fromEntries(ev.rrule.split(";").map((p) => p.split("=")));
  if (parts.FREQ !== "WEEKLY") return [ev.dtstart]; // pattern non atteso in questo calendario, non provo a espanderlo
  const interval = parseInt(parts.INTERVAL || "1", 10);
  const until = parts.UNTIL ? parseIcsDate(parts.UNTIL) : null;
  const limite = until && until < fino ? until : fino;
  const exSet = new Set(ev.exdates || []);
  const risultati = [];
  let cur = ev.dtstart;
  let iter = 0;
  while (cur <= limite && iter < 500) {
    if (!exSet.has(cur)) risultati.push(cur);
    cur = addDaysIso(cur, 7 * interval);
    iter++;
  }
  return risultati;
}

async function main() {
  const [patientsAll, slotsAttivi, { refresh_token: refreshToken }] = await Promise.all([
    supaGet("patients?select=*&order=id"),
    supaGet("patient_slots?select=patient_id&active=eq.true"),
    supaGet("google_tokens?select=refresh_token").then((r) => r[0]),
  ]);
  const idAttivi = new Set(slotsAttivi.map((s) => s.patient_id));
  const patients = patientsAll.filter((p) => idAttivi.has(p.id));

  console.log(`Pazienti attivi da riconciliare: ${patients.length}\n`);

  // Fonte 1: query diretta Google Calendar (fetchGoogleCalendarEvents espande
  // gia' le ricorrenze da solo).
  const eventsLive = await fetchGoogleCalendarEvents(refreshToken, "2025-01-01", SOGLIA);

  // Fonte 2: dump .ics completo esportato da Maurizio oggi stesso.
  const icsPath = process.argv[2];
  const icsRaw = fs.readFileSync(icsPath, "utf8");
  const icsEvents = parseVEvents(unfoldIcs(icsRaw));
  // separa master ricorrenti, singoli, e override (RECURRENCE-ID)
  const overridesByUid = new Map();
  for (const e of icsEvents) if (e.recurrenceId) {
    if (!overridesByUid.has(e.uid)) overridesByUid.set(e.uid, new Map());
    overridesByUid.get(e.uid).set(e.recurrenceId, e);
  }
  const icsOccorrenze = []; // { data, titolo, descrizione }
  for (const e of icsEvents) {
    if (e.recurrenceId) continue; // gia' processati come override
    if (!e.dtstart) continue;
    if (e.rrule) {
      const date = espandiRicorrenza(e, SOGLIA);
      const overrides = overridesByUid.get(e.uid);
      for (const d of date) {
        const ov = overrides?.get(d);
        icsOccorrenze.push({ data: d, titolo: ov ? ov.summary : e.summary, descrizione: ov ? ov.description : e.description });
      }
    } else {
      if (e.dtstart <= SOGLIA) icsOccorrenze.push({ data: e.dtstart, titolo: e.summary, descrizione: e.description });
    }
  }
  console.log(`Occorrenze totali ricostruite dal file .ics fino al ${SOGLIA}: ${icsOccorrenze.length}\n`);

  const righe = [];
  for (const p of patients) {
    const matchLive = eventsLive
      .filter((e) => e.data <= SOGLIA && matchPatientForEvent(e.titolo, [p]))
      .sort((a, b) => (a.data < b.data ? -1 : 1));
    const ultimoLive = matchLive.length ? matchLive[matchLive.length - 1] : null;

    const matchIcs = icsOccorrenze
      .filter((e) => matchPatientForEvent(e.titolo, [p]))
      .sort((a, b) => (a.data < b.data ? -1 : 1));
    const ultimoIcs = matchIcs.length ? matchIcs[matchIcs.length - 1] : null;

    righe.push({
      id: p.id, nome: p.fatturare_a || p.nome_calendario, nome_calendario: p.nome_calendario,
      ancora_valore_db: p.ancora_valore, ancora_data_db: p.ancora_data,
      ultimo_live_data: ultimoLive?.data || null, ultimo_live_codice: ultimoLive?.descrizione || null,
      ultimo_ics_data: ultimoIcs?.data || null, ultimo_ics_codice: ultimoIcs?.descrizione || null,
      fontiCoerenti: (ultimoLive?.data === ultimoIcs?.data) && (ultimoLive?.descrizione === ultimoIcs?.descrizione),
    });
  }

  console.log("=== Confronto per paziente (ultima seduta utile prima del 31/8) ===\n");
  for (const r of righe) {
    console.log(`[${r.id}] ${r.nome} (${r.nome_calendario})`);
    console.log(`   DB: ancora_valore=${r.ancora_valore_db} ancora_data=${r.ancora_data_db}`);
    console.log(`   Live API : ${r.ultimo_live_data} -> "${r.ultimo_live_codice}"`);
    console.log(`   File .ics: ${r.ultimo_ics_data} -> "${r.ultimo_ics_codice}"`);
    if (!r.fontiCoerenti) console.log(`   !! LE DUE FONTI NON COINCIDONO`);
    console.log("");
  }

  fs.writeFileSync(new URL("./riconciliazione-risultato.json", import.meta.url), JSON.stringify(righe, null, 2));
  console.log("Salvato in scripts/riconciliazione-risultato.json");

  const discordanti = righe.filter((r) => !r.fontiCoerenti);
  console.log(`\nPazienti dove le due fonti NON coincidono: ${discordanti.length} / ${righe.length}`);
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
