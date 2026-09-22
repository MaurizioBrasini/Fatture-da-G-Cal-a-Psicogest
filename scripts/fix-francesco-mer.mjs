// One-off 2026-09-22: Francesco Mer. — l'incasso di 400€ (debito "di mesi",
// mai tracciato dal sistema perché la quota contanti è stata attivata solo
// il 21/9) è stato registrato dal bottone manuale in Pazienti (data 2/9),
// non dal riconoscimento automatico "saldato" — risultato: contante_dovuto
// finito a -400 (credito, sbagliato: il debito era reale e ora è saldato,
// deve tornare a 0) e la nota "A3 saldato tutto il dovuto" del 16/9 mai
// ripulita, che ricompariva a ogni "Registra disdette". Corregge entrambi.
import fs from "node:fs";
import { matchPatientForEvent, todayISO, addDays, rimuoviMarcatoreSaldato } from "../src/lib/logic.js";
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
  return res.json();
}
async function supaPatch(pathAndQuery, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  return res.json();
}

const patients = await supaGet("patients?select=*");
const francesco = patients.find((p) => p.nome_calendario === "Francesco Mer.");
console.log("Saldo attuale:", francesco.contante_dovuto);

const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
const oggi = todayISO();
const events = await fetchGoogleCalendarEvents(refreshToken, addDays(oggi, -60), addDays(oggi, 30));
const evento = events.find(
  (e) => e.data === "2026-09-16" && matchPatientForEvent(e.titolo, patients)?.patient.id === francesco.id
);
if (!evento) throw new Error("Evento del 16/9 non trovato.");
const pulita = rimuoviMarcatoreSaldato(evento.descrizione);
console.log(`Nota: "${evento.descrizione}" -> "${pulita}"`);

if (!APPLY) {
  console.log("\n(anteprima, nessuna scrittura — rilanciare con --apply)");
} else {
  await supaPatch(`patients?id=eq.${francesco.id}`, { contante_dovuto: 0 });
  await updateGoogleCalendarEventDescription(refreshToken, evento.id, pulita);
  console.log("\nFatto: saldo azzerato, nota ripulita.");
}
