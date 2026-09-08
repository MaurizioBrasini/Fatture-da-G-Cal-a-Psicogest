// Completa la migrazione per i 3 casi "ambigui" (Domizia S., Giorgia S.,
// Maria Z.) risolti come falsi positivi: la loro serie nativa attiva è
// inequivocabile (l'unica con occorrenze future), la vecchia serie originale
// ha solo un'occorrenza residua ormai passata. Stesso trattamento degli
// altri 53 pazienti: tronca la serie attiva, genera le occorrenze con
// colorId (default se confermato solo la primissima, "6" mandarino le altre).

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

const CASI = [
  {
    nome: "Domizia S.",
    patientId: 218,
    slotId: 1,
    masterId: "60o66cppcphjgbb469h68b9kc8q6ab9oc8p62bb265h68dho74qj0eb1cc_R20260914T073000",
    giorno: "2026-09-07",
    stato: "confermato",
  },
  {
    nome: "Giorgia S.",
    patientId: 371,
    slotId: 7,
    masterId: "ckq64oj6c4s36bb1cdj34b9k6lgj4b9o68o30bb670om8cb261hm8ob26o_R20260921T083000",
    giorno: "2026-09-07",
    stato: "confermato",
  },
  {
    nome: "Maria Z.",
    patientId: 260,
    slotId: 13,
    masterId: "6pi32dpn65im8b9g6oqj0b9k70sj4b9oc8r3ibb6cdi66cpg6tj6cp9i64_R20260921T093000",
    giorno: "2026-09-07",
    stato: "confermato",
  },
];

async function main() {
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const slots = await supaGet("patient_slots?select=*");
  const oggi = todayISO();

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const { access_token: accessToken } = await tokenRes.json();

  for (const c of CASI) {
    const slot = slots.find((s) => s.id === c.slotId);
    console.log(`\n--- ${c.nome} ---`);

    // Taglio: mai prima di oggi reale, mai prima del giorno se successivo a oggi.
    const cutoffBase = c.giorno > oggi ? c.giorno : oggi;
    const cutoff = addDays(cutoffBase, -1);

    const getRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${c.masterId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const master = await getRes.json();
    const nuovaRecurrence = setRruleUntil(master.recurrence, cutoff);
    const patchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${c.masterId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recurrence: nuovaRecurrence }),
    });
    if (!patchRes.ok) {
      console.log(`  [ERRORE troncamento] ${await patchRes.text()}`);
      continue;
    }
    console.log(`  [TRONCATA] UNTIL ${cutoff}`);
    await sleep(200);

    const date = occorrenzeFuture(slot, [], 60, oggi);
    for (let i = 0; i < date.length; i++) {
      const confermato = i === 0 && c.stato === "confermato";
      try {
        await createGoogleCalendarEvent(refreshToken, {
          data: date[i],
          ora: slot.time_of_day.slice(0, 5),
          durataMinuti: 60,
          titolo: c.nome,
          descrizione: "",
          colorId: confermato ? undefined : "6",
        });
      } catch (e) {
        console.log(`  [ERRORE creazione ${date[i]}] ${e.message}`);
      }
      await sleep(150);
    }
    console.log(`  [OK] ${date.length} occorrenze create.`);
  }
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
