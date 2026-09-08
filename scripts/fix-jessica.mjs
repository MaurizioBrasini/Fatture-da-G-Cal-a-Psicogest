// Completa la migrazione di Jessica M., rimasta fuori perché interval_days=28
// era bloccato dal vecchio CHECK constraint (schema_addendum4.sql, ora eseguito).

import fs from "node:fs";
import { occorrenzeFuture, todayISO, addDays } from "../src/lib/logic.js";
import { createGoogleCalendarEvent } from "../src/lib/googleCalendar.js";

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setRruleUntil(recurrenceArray, untilDateISO) {
  const untilStr = untilDateISO.replace(/-/g, "") + "T235959Z";
  return (recurrenceArray || [])
    .filter((line) => line.startsWith("RRULE:"))
    .map((line) => {
      const parts = line.slice(6).split(";").filter((p) => !p.startsWith("UNTIL=") && !p.startsWith("COUNT="));
      parts.push(`UNTIL=${untilStr}`);
      return "RRULE:" + parts.join(";");
    });
}

const PATIENT_ID = 115;
const SLOT_ID = 31;
const MASTER_ID = "cco62d1oc9i6abb164pj4b9k6osjib9p6kqj2b9l6so6cpj2c9ij2dr46k";
const GIORNO = "2026-10-01";
const HHMM = "13:30";
const INTERVAL_DAYS = 28;
const NUMERO_INC = 6;
const STATO = "confermato";

async function main() {
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const oggi = todayISO();

  await supaPatch(`patients?id=eq.${PATIENT_ID}`, { ancora_valore: NUMERO_INC - 1, ancora_data: GIORNO });
  console.log("[OK] patients aggiornato");

  const weekday = new Date(GIORNO + "T12:00:00Z").getUTCDay();
  await supaPatch(`patient_slots?id=eq.${SLOT_ID}`, {
    weekday, time_of_day: HHMM + ":00", interval_days: INTERVAL_DAYS, anchor_date: GIORNO,
  });
  console.log("[OK] patient_slots aggiornato, weekday=" + weekday);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const { access_token: accessToken } = await tokenRes.json();

  const cutoffBase = GIORNO > oggi ? GIORNO : oggi;
  const cutoff = addDays(cutoffBase, -1);
  const getRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${MASTER_ID}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const master = await getRes.json();
  console.log("Master DTSTART:", master.start?.dateTime, "| cutoff scelto:", cutoff);
  const nuovaRecurrence = setRruleUntil(master.recurrence, cutoff);
  const patchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${MASTER_ID}`, {
    method: "PATCH", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recurrence: nuovaRecurrence }),
  });
  console.log("[TRONCATA]", patchRes.status);
  await sleep(200);

  const slot = { weekday, time_of_day: HHMM + ":00", interval_days: INTERVAL_DAYS, anchor_date: GIORNO };
  const date = occorrenzeFuture(slot, [], 60, oggi);
  for (let i = 0; i < date.length; i++) {
    const confermato = i === 0 && STATO === "confermato";
    await createGoogleCalendarEvent(refreshToken, {
      data: date[i], ora: HHMM, durataMinuti: 60, titolo: "Jessica M.", descrizione: "",
      colorId: confermato ? undefined : "6",
    });
    await sleep(150);
  }
  console.log(`[OK] ${date.length} occorrenze create:`, date.join(", "));

  // Controllo duplicato (bug noto: DTSTART del master coincide col cutoff+1)
  const masterDtstart = (master.start?.date || master.start?.dateTime || "").slice(0, 10);
  if (date.includes(masterDtstart)) {
    console.log(`\n[ATTENZIONE] Il DTSTART del master (${masterDtstart}) coincide con una data appena generata — verificare duplicato a mano.`);
  } else {
    console.log("\nNessun rischio di duplicato noto (DTSTART master fuori dalle date generate).");
  }
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
