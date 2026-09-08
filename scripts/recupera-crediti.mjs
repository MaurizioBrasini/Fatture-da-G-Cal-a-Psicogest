// Sola lettura. Per ogni paziente, trova l'ultimo appuntamento PASSATO
// (mai toccato da nessuno script stanotte: la verita' storica intatta) e ne
// legge la nota, cercando un importo "deve X€" da confrontare con
// patients.contante_dovuto attuale. Ignora note tipo "saldati"/"dati
// oggi"/"pagato" (debito gia' chiuso, nulla da riportare).
// Non scrive nulla.

import fs from "node:fs";
import { matchPatientForEvent, todayISO, addDays } from "../src/lib/logic.js";

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

const DEVE_REGEX = /deve\s*([\d.,]+)\s*€?/i;
const SALDATO_REGEX = /saldat|dati\s*oggi|pagat/i;

async function main() {
  const patients = await supaGet("patients?select=id,nome_calendario,fatturare_a,contante_dovuto");
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

  const oggi = todayISO();
  const finestraDa = addDays(oggi, -400); // ampio, per non perdere l'ultimo appuntamento di pazienti con sedute rade

  let events = [];
  let pageToken;
  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", new Date(finestraDa + "T00:00:00Z").toISOString());
    url.searchParams.set("timeMax", new Date(oggi + "T00:00:00Z").toISOString()); // solo PASSATO, mai toccato
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("orderBy", "startTime");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    events = events.concat(
      (data.items || []).map((e) => ({
        summary: (e.summary || "").trim(),
        data: (e.start?.date || e.start?.dateTime || "").slice(0, 10),
        descrizione: e.description || "",
        status: e.status,
      })).filter((e) => e.status !== "cancelled" && e.data)
    );
    pageToken = data.nextPageToken;
  } while (pageToken);

  // ultimo evento passato per paziente (il piu' recente <= ieri)
  const ultimoPerPaziente = new Map();
  for (const e of events) {
    const m = matchPatientForEvent(e.summary, patients);
    if (!m) continue;
    const attuale = ultimoPerPaziente.get(m.patient.id);
    if (!attuale || e.data > attuale.data) ultimoPerPaziente.set(m.patient.id, { patient: m.patient, evento: e });
  }

  console.log(`=== Ultimo appuntamento passato per ${ultimoPerPaziente.size} pazienti (finestra ${finestraDa} .. ieri) ===\n`);

  const daAggiornare = [];
  const daIgnorare = [];
  for (const { patient, evento } of ultimoPerPaziente.values()) {
    const nome = patient.fatturare_a || patient.nome_calendario;
    const deveMatch = evento.descrizione.match(DEVE_REGEX);
    const saldatoMatch = SALDATO_REGEX.test(evento.descrizione);
    if (deveMatch) {
      const importo = Number(deveMatch[1].replace(".", "").replace(",", "."));
      const attuale = patient.contante_dovuto || 0;
      if (importo !== attuale) {
        daAggiornare.push({ nome, data: evento.data, nota: evento.descrizione, importoTrovato: importo, attualeDB: attuale });
      }
    } else if (saldatoMatch) {
      daIgnorare.push({ nome, data: evento.data, nota: evento.descrizione });
    }
  }

  console.log(`--- Pazienti con "deve X" da riconciliare (${daAggiornare.length}) ---`);
  for (const r of daAggiornare) {
    console.log(`${r.nome} — ultimo appuntamento ${r.data}: nota = "${r.nota.replace(/\n/g, " / ")}"`);
    console.log(`   contante_dovuto attuale in DB: ${r.attualeDB}€  ->  trovato in nota: ${r.importoTrovato}€\n`);
  }

  console.log(`\n--- Pazienti con nota "saldati/dati oggi/pagato" (ignorati, nessuna azione) (${daIgnorare.length}) ---`);
  for (const r of daIgnorare) {
    console.log(`${r.nome} — ${r.data}: "${r.nota.replace(/\n/g, " / ")}"`);
  }
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
