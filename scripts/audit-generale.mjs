// Controllo sistematico su tutti i pazienti con patient_slot attivo:
// confronta ancora_valore/ancora_data, computePatientState (stato/conteggio
// mostrato in app) e l'ultimo codice R/A/S REALMENTE scritto sul calendario.
// Sola lettura: non scrive nulla.

import fs from "node:fs";
import { fetchGoogleCalendarEvents } from "../src/lib/googleCalendar.js";
import { computePatientState, computeRinumerazione, matchPatientForEvent, normalizeName, todayISO, DEFAULT_SETTINGS } from "../src/lib/logic.js";

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

async function main() {
  const [patients, slots, cancellazioni, settingsRows, { refresh_token: refreshToken }] = await Promise.all([
    supaGet("patients?select=*&order=id"),
    supaGet("patient_slots?select=*&active=eq.true"),
    supaGet("cancellations?select=*"),
    supaGet("settings?select=*"),
    supaGet("google_tokens?select=refresh_token").then((r) => r[0]),
  ]);
  const settings = { ...DEFAULT_SETTINGS, ...(settingsRows[0] || {}) };

  const idAttivi = new Set(slots.map((s) => s.patient_id));
  const target = patients.filter((p) => idAttivi.has(p.id));
  console.log(`Pazienti con patient_slot attivo: ${target.length} (su ${patients.length} totali, ${slots.length} slot attivi)\n`);

  const events = await fetchGoogleCalendarEvents(refreshToken, "2025-01-01", "2027-06-30");
  const oggi = todayISO();

  const righe = [];
  for (const p of target) {
    // Match "largo": ignora ancora_data, per vedere la storia reale intera
    // (serve a scovare casi come Silvia M., dove ancora_data nasconde eventi
    // reali dal conteggio pur essendo loro dopo la data indicata).
    const tuttiMatch = events
      .filter((e) => matchPatientForEvent(e.titolo, [p]))
      .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.ora < b.ora ? -1 : 1));
    const passatiLargo = tuttiMatch.filter((e) => e.data <= oggi);
    const ultimoRealePassato = passatiLargo.length ? passatiLargo[passatiLargo.length - 1] : null;

    const state = computePatientState(p, events, settings, cancellazioni);
    const piano = computeRinumerazione(p, events, settings);
    const pianoPassato = piano.filter((r) => r.data <= oggi);
    const ultimoPianoPassato = pianoPassato.length ? pianoPassato[pianoPassato.length - 1] : null;

    righe.push({
      id: p.id,
      nome: p.fatturare_a || p.nome_calendario,
      nome_calendario: p.nome_calendario,
      fuori_schema: p.fuori_schema,
      ancora_valore: p.ancora_valore,
      ancora_data: p.ancora_data,
      app_count: state.count,
      app_stato: state.stato,
      app_ultimaData: state.ultimaData,
      cal_ultimoEvento_data: ultimoRealePassato?.data || null,
      cal_ultimoEvento_titolo: ultimoRealePassato?.titolo || null,
      cal_ultimoEvento_codiceReale: ultimoRealePassato?.descrizione || null,
      rinumera_ultimoPassato_codiceAtteso: ultimoPianoPassato?.codice || null,
      rinumera_ultimoPassato_cambia: ultimoPianoPassato?.cambia || false,
      rinumera_eventiPassatiDaCorreggere: pianoPassato.filter((r) => r.cambia).length,
      rinumera_eventiFuturiDaCorreggere: piano.filter((r) => r.data > oggi && r.cambia).length,
      eventoUltimoFuoriFinestraAncora: ultimoRealePassato && p.ancora_data && ultimoRealePassato.data < p.ancora_data,
    });
  }

  console.log("=== Elenco completo (tutti i pazienti attivi) ===");
  for (const r of righe) {
    console.log(`\n[${r.id}] ${r.nome} (${r.nome_calendario})${r.fuori_schema ? " [fuori schema]" : ""}`);
    console.log(`  DB: ancora_valore=${r.ancora_valore} ancora_data=${r.ancora_data}`);
    console.log(`  App: count=${r.app_count} stato=${r.app_stato} ultimaData=${r.app_ultimaData}`);
    console.log(`  Calendario ultimo evento passato: ${r.cal_ultimoEvento_data} "${r.cal_ultimoEvento_titolo}" -> nota reale="${r.cal_ultimoEvento_codiceReale}"`);
    console.log(`  Rinumera (live) atteso per quell'evento: "${r.rinumera_ultimoPassato_codiceAtteso}" ${r.rinumera_ultimoPassato_cambia ? "<<< DIVERSO DA QUELLO SCRITTO" : "(combacia)"}`);
    if (r.rinumera_eventiPassatiDaCorreggere > 0) console.log(`  !! ${r.rinumera_eventiPassatiDaCorreggere} eventi PASSATI con nota disallineata da Rinumera`);
    if (r.rinumera_eventiFuturiDaCorreggere > 0) console.log(`  .. ${r.rinumera_eventiFuturiDaCorreggere} eventi futuri con nota disallineata da Rinumera`);
    if (r.eventoUltimoFuoriFinestraAncora) console.log(`  !! ultimo evento reale (${r.cal_ultimoEvento_data}) è PRIMA di ancora_data (${r.ancora_data}) — possibile ancora_data mal posizionata`);
  }

  console.log("\n\n=== SOLO i pazienti con qualche disallineamento rilevato ===");
  const problemi = righe.filter((r) => r.rinumera_ultimoPassato_cambia || r.rinumera_eventiPassatiDaCorreggere > 0 || r.eventoUltimoFuoriFinestraAncora);
  for (const r of problemi) {
    console.log(`[${r.id}] ${r.nome}: scritto="${r.cal_ultimoEvento_codiceReale}" atteso="${r.rinumera_ultimoPassato_codiceAtteso}" (${r.rinumera_eventiPassatiDaCorreggere} eventi passati da correggere) ancora_valore=${r.ancora_valore}/ancora_data=${r.ancora_data} app_count=${r.app_count}/${r.app_stato}`);
  }
  console.log(`\nTotale pazienti con disallineamento: ${problemi.length} / ${righe.length}`);

  fs.writeFileSync(new URL("./audit-risultato.json", import.meta.url), JSON.stringify(righe, null, 2));
  console.log("\nSalvato dettaglio completo in scripts/audit-risultato.json");
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
