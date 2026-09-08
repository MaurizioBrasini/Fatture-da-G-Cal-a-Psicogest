// Sola lettura. Due analisi:
// A) Per i 15 slot doppi (14 sistematici + Antonietta F.): confronto nota
//    vecchia (istanza residua della serie nativa) vs nota nuova (evento
//    creato dal ripopolamento) — per capire cosa recuperare prima di
//    cancellare il residuo.
// B) Scansione di TUTTI gli eventi futuri correnti per note che contengono
//    qualcosa oltre al semplice codice R/A/S(+numero)(+fatturare) — candidati
//    da trascrivere in patients.note prima di cambiare la logica di
//    generazione delle descrizioni.
// Non scrive/cancella nulla.

import fs from "node:fs";
import { matchPatientForEvent, stripCodiceEsistente } from "../src/lib/logic.js";

const envRaw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function supaGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET fallita: ${await res.text()}`);
  return res.json();
}

async function main() {
  const patients = await supaGet("patients?select=id,nome_calendario,fatturare_a,note");
  const tokenRows = await supaGet("google_tokens?select=refresh_token");
  const refreshToken = tokenRows[0].refresh_token;

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

  let events = [];
  let pageToken;
  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", new Date("2026-09-08T00:00:00Z").toISOString());
    url.searchParams.set("timeMax", new Date("2027-02-01T00:00:00Z").toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("orderBy", "startTime");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    events = events.concat(
      (data.items || []).map((e) => ({
        id: e.id,
        summary: (e.summary || "").trim(),
        data: (e.start?.date || e.start?.dateTime || "").slice(0, 10),
        ora: e.start?.dateTime ? e.start.dateTime.slice(11, 16) : null,
        descrizione: e.description || "",
        recurringEventId: e.recurringEventId || null,
        created: e.created,
        status: e.status,
      })).filter((e) => e.status !== "cancelled")
    );
    pageToken = data.nextPageToken;
  } while (pageToken);

  fs.writeFileSync(
    "C:/Users/mabra/AppData/Local/Temp/claude/C--Github-Fatture-da-G-Cal-a-Psicogest/1c4dcc24-2c7e-4492-bfa3-641213cd94d4/scratchpad/all-events-full.json",
    JSON.stringify(events, null, 2)
  );

  // --- A) i 15 doppi: quale nasce da tonight (>= 2026-09-07T21:00Z, i miei
  // batch sono partiti verso le 22:0x/22:1x UTC) vs quale è il residuo ---
  const gruppi = new Map();
  for (const e of events) {
    const m = matchPatientForEvent(e.summary, patients);
    if (!m) continue;
    const key = `${m.patient.id}|${e.data}|${e.ora}`;
    if (!gruppi.has(key)) gruppi.set(key, { patient: m.patient, eventi: [] });
    gruppi.get(key).eventi.push(e);
  }
  const doppioni = [...gruppi.values()].filter((g) => g.eventi.length > 1);

  console.log("=== A) Confronto nota vecchia / nota nuova sui 15 doppi ===\n");
  for (const g of doppioni) {
    const nome = g.patient.fatturare_a || g.patient.nome_calendario;
    const ordinati = [...g.eventi].sort((a, b) => new Date(a.created) - new Date(b.created));
    const vecchio = ordinati[0];
    const nuovo = ordinati[ordinati.length - 1];
    console.log(`${nome} — ${vecchio.data} ${vecchio.ora}`);
    console.log(`   VECCHIA (creata ${vecchio.created}): "${vecchio.descrizione}"`);
    console.log(`   NUOVA   (creata ${nuovo.created}): "${nuovo.descrizione}"`);
    console.log("");
  }

  // --- B) scansione di tutte le note per contenuto extra oltre al codice ---
  console.log("\n=== B) Note con contenuto oltre al semplice codice R/A/S ===\n");
  const perPaziente = new Map();
  for (const e of events) {
    const m = matchPatientForEvent(e.summary, patients);
    if (!m) continue;
    if (!e.descrizione) continue;
    const dopoStrip = stripCodiceEsistente(e.descrizione).trim();
    // Ignora il blocco automatico di Google Meet (sempre uguale, non è una
    // nota scritta a mano) e le stringhe vuote dopo lo strip del codice.
    const senzaMeet = dopoStrip.replace(/Partecipa con Google Meet:[\s\S]*$/i, "").trim();
    if (!senzaMeet) continue;
    const key = m.patient.id;
    if (!perPaziente.has(key)) perPaziente.set(key, { patient: m.patient, righe: [] });
    perPaziente.get(key).righe.push({ data: e.data, ora: e.ora, originale: e.descrizione, extra: senzaMeet });
  }

  for (const { patient, righe } of perPaziente.values()) {
    const nome = patient.fatturare_a || patient.nome_calendario;
    console.log(`${nome} (patients.note attuale: ${JSON.stringify(patient.note || "")})`);
    for (const r of righe) {
      console.log(`   ${r.data} ${r.ora}: extra = "${r.extra}"  (originale completa: "${r.originale}")`);
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
