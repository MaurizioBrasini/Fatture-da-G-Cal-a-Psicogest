// Correzioni dopo il controllo conteggi del 2026-09-29 (richiesta di Maurizio).
//  1. Immacolata e Simone (432): ancora_data 2026-10-27 -> 2026-09-28 (primo incontro
//     fatto il 28/9, secondo preso a mano il 12/10: prima dell'ancora, non contavano).
//  2. Alessia C. (389): salda in contanti ogni 2 sedute senza fattura -> stato
//     "non_fatturato" (come pro bono / supervisioni), tolti i codici R/S dalle
//     note dei futuri eventi (per NF "Rinumera" non tocca le note, vanno tolti a mano).
//  3. Numeri sbagliati nelle note vecchie (ininfluenti sul conteggio): si cambia
//     SOLO il numero, il resto della nota resta identico.
//
// DRY_RUN=1 (default): stampa senza scrivere. DRY_RUN=0: scrive DB + Google Calendar.
// Ogni modifica a una nota parte solo se la nota attuale è esattamente quella attesa.

import fs from "node:fs";
import { fetchGoogleCalendarEvents, updateGoogleCalendarEventDescription } from "../../src/lib/googleCalendar.js";
import { computePatientState, stripCodiceEsistente, DEFAULT_SETTINGS } from "../../src/lib/logic.js";

const DRY_RUN = process.env.DRY_RUN !== "0";
const envRaw = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function supaGet(q) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!res.ok) throw new Error(`GET fallita: ${await res.text()}`);
  return res.json();
}
async function supaPatch(q, body) {
  if (DRY_RUN) { console.log(`[DRY] PATCH ${q}`, JSON.stringify(body)); return; }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH fallita (${q}): ${await res.text()}`);
}

// [nome_calendario, data, inizio nota attuale (esatto), inizio nota nuovo]
const NOTE_DA_CORREGGERE = [
  ["Carmine C.", "2026-09-01", "NpA 2", "NpA 3"],            // valore 3 all'ancora 15/9: 7/7=1, 7/21=2, 9/1=3
  ["Josephine P.G.", "2026-09-03", "NpA 2", "NpA 1"],        // dopo NpA 5 del 21/7 è la 1a del ciclo (ancora 17/9 valore 1)
  ["Flavia e Edoardo", "2026-07-15", "Np 3", "Np 4"],        // 14/5, 3/6, 17/6, 15/7, 9/9 = 5 (fatturate 5)
  ["Jessica M.", "2026-09-03", "R1", "R5 fatturare"],        // dopo Pc 4 del 21/7 è la 5a (fattura 13/9 di 5 sedute)
];
const ALESSIA_ID = 389;
const IMMACOLATA_ID = 432;

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== SCRITTURA REALE ===");
  const patients = await supaGet("patients?select=*");
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const settings = { ...DEFAULT_SETTINGS, ...(await supaGet("settings?select=*"))[0] };
  const events = await fetchGoogleCalendarEvents(refreshToken, "2026-05-01", "2026-12-31");
  const byName = (n) => patients.find((p) => p.nome_calendario === n);

  // --- 1. Immacolata e Simone ---
  const imm = patients.find((p) => p.id === IMMACOLATA_ID);
  if (imm.ancora_data !== "2026-10-27") throw new Error(`Immacolata: ancora inattesa ${imm.ancora_data}`);
  const immDopo = { ...imm, ancora_data: "2026-09-28", ancora_valore: 0 };
  const rosterImm = patients.map((p) => (p.id === IMMACOLATA_ID ? immDopo : p));
  const st = computePatientState(immDopo, events, settings, [], rosterImm);
  console.log(`\nImmacolata e Simone: con ancora 28/9 -> count=${st.count} stato=${st.stato} usati=${st.usati.map((u) => u.data)}`);
  if (st.count !== 1) throw new Error("Immacolata: conteggio simulato inatteso, mi fermo.");
  await supaPatch(`patients?id=eq.${IMMACOLATA_ID}`, { ancora_data: "2026-09-28", ancora_valore: 0 });

  // --- 2. Alessia C. ---
  const ale = patients.find((p) => p.id === ALESSIA_ID);
  if (ale.nome_calendario !== "Alessia C.") throw new Error("Alessia: id inatteso");
  await supaPatch(`patients?id=eq.${ALESSIA_ID}`, {
    stato: "non_fatturato",
    note: "Salda in contanti ogni 2 sedute, senza fattura.",
  });
  const rosterAle = patients.map((p) => (p.id === ALESSIA_ID ? { ...p, stato: "non_fatturato" } : p));
  void rosterAle;
  const futuri = events.filter((e) => e.data > "2026-09-29" && e.titolo.trim() === "Alessia C.");
  console.log(`\nAlessia C.: eventi futuri trovati: ${futuri.length}`);
  for (const e of futuri) {
    const nuova = stripCodiceEsistente(e.descrizione).trim();
    if (nuova === (e.descrizione || "").trim()) { console.log(`  ${e.data}: nessun codice da togliere ("${e.descrizione}")`); continue; }
    console.log(`  ${e.data}: "${(e.descrizione || "").split("\n")[0]}" -> "${nuova.split("\n")[0]}"`);
    if (!DRY_RUN) await updateGoogleCalendarEventDescription(refreshToken, e.id, nuova);
  }

  // --- 3. Numeri sbagliati nelle note ---
  console.log("\nNote da correggere:");
  for (const [nome, data, vecchio, nuovo] of NOTE_DA_CORREGGERE) {
    const p = byName(nome);
    if (!p) throw new Error(`Paziente ${nome} non trovato`);
    const ev = events.filter((e) => e.data === data && e.titolo.trim() === nome);
    if (ev.length !== 1) throw new Error(`${nome} ${data}: attesi 1 evento, trovati ${ev.length}`);
    const desc = ev[0].descrizione || "";
    if (!(desc === vecchio || desc.startsWith(vecchio + " ") || desc.startsWith(vecchio + "\n") || desc.startsWith(vecchio + "<"))) {
      throw new Error(`${nome} ${data}: nota inattesa "${desc.slice(0, 40)}" (atteso inizio "${vecchio}"), mi fermo.`);
    }
    const nuovaDesc = nuovo + desc.slice(vecchio.length);
    console.log(`  ${nome} ${data}: "${desc.split("\n")[0]}" -> "${nuovaDesc.split("\n")[0]}"`);
    if (!DRY_RUN) await updateGoogleCalendarEventDescription(refreshToken, ev[0].id, nuovaDesc);
  }
  console.log(DRY_RUN ? "\n[DRY RUN COMPLETATO]" : "\n[FATTO]");
}

main().catch((e) => { console.error("ERRORE:", e); process.exit(1); });
