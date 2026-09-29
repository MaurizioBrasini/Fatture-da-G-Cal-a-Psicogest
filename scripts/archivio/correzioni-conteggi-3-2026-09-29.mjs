// Terza tornata 2026-09-29: Maurizio conferma che Stefano A. (4) è stato fatturato
// al 18/5 e Roberta C. (45) al 6/7 -> ancora al giorno dopo, valore 0.
// DRY_RUN=1 (default) stampa e non scrive; DRY_RUN=0 scrive DB + note Calendar.
import fs from "node:fs";
import { fetchGoogleCalendarEvents, updateGoogleCalendarEventDescription } from "../../src/lib/googleCalendar.js";
import { computePatientState, computeRinumerazione, DEFAULT_SETTINGS } from "../../src/lib/logic.js";

const DRY_RUN = process.env.DRY_RUN !== "0";
const envRaw = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}` };
const get = async (q) => { const r = await fetch(`${U}/rest/v1/${q}`, { headers: H }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
async function patch(q, body) {
  if (DRY_RUN) { console.log(`[DRY] PATCH ${q}`, JSON.stringify(body)); return; }
  const r = await fetch(`${U}/rest/v1/${q}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
}

const CASI = [
  { id: 4, nome: "Stefano A.", vecchia: "2026-07-13/3", nuova: "2026-05-19" },
  { id: 45, nome: "Roberta C.", vecchia: "2026-09-21/4", nuova: "2026-07-07" },
];

const patients = await get("patients?select=*");
const [{ refresh_token }] = await get("google_tokens?select=refresh_token");
const settings = { ...DEFAULT_SETTINGS, ...(await get("settings?select=*"))[0] };
const events = await fetchGoogleCalendarEvents(refresh_token, "2026-04-01", "2027-02-28");
const pag = await get("contante_pagamenti?select=*");
const canc = await get("cancellations?select=*");
console.log(DRY_RUN ? "=== DRY RUN ===" : "=== SCRITTURA REALE ===");
for (const c of CASI) {
  const p = patients.find((x) => x.id === c.id);
  if (p.nome_calendario !== c.nome || `${p.ancora_data}/${p.ancora_valore}` !== c.vecchia) throw new Error(`${c.nome}: stato inatteso ${p.ancora_data}/${p.ancora_valore}`);
  const dopo = { ...p, ancora_data: c.nuova, ancora_valore: 0 };
  const roster = patients.map((x) => (x.id === c.id ? dopo : x));
  const st = computePatientState(dopo, events, settings, canc.filter((x) => x.patient_id === c.id), roster);
  console.log(`\n## ${c.nome}: ancora ${c.vecchia} -> ${c.nuova}/0 => count=${st.count} ${st.stato} usati=${st.usati.map((u) => u.data)}`);
  await patch(`patients?id=eq.${c.id}`, { ancora_data: c.nuova, ancora_valore: 0 });
  const piano = computeRinumerazione(dopo, events, settings, roster, { pagamentiContante: pag.filter((x) => x.patient_id === c.id) });
  for (const r of piano.filter((r) => r.cambia)) {
    console.log(`  ${r.data}: "${r.descrizioneOriginale.split("\n")[0]}" -> "${r.descrizioneNuova.split("\n")[0]}"`);
    if (!DRY_RUN) { await updateGoogleCalendarEventDescription(refresh_token, r.id, r.descrizioneNuova); await new Promise((x) => setTimeout(x, 150)); }
  }
}
console.log(DRY_RUN ? "\n[DRY RUN COMPLETATO]" : "\n[FATTO]");
