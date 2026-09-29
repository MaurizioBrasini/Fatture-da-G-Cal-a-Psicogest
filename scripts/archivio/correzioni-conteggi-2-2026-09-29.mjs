// Seconda tornata di correzioni del 2026-09-29 (richieste di Maurizio):
//  A. Romano A. (14), Michela M. (128), Sergio Andrei (10), Riccardo M. (424):
//     da "sospeso" a "non_fatturato"; tolti i codici R/S dalle note dei futuri.
//  B. Giulia C. (54): la fattura 23/9 (giÃ  su Psicogest) copre 5 sedute ma quelle
//     reali erano 6 -> ancora_valore 1 (la sesta si somma al prossimo ciclo),
//     note 8/9 e 22/9 corrette, futuri rinumerati.
//  C. Luana S. (230): fattura di 5 sedute fino al 10/9, poi conteggio da capo
//     (24/9 = R1). Numero fattura 161. Ancora -> 11/9.
//  D. Elisabetta U. (252): ciclo 6/5-15/7 (5 sedute) mai fatturato (ultima
//     fattura ad aprile) -> fattura n. 162; 2/9 diventa la 1a del nuovo ciclo.
//     Ancora -> 16/7. La 9/16 disdetta non addebitata resta com'Ã¨.
// Le due fatture (C, D) finiscono in un unico Excel per Psicogest nella cartella
// Download e in invoice_history (numero modificabile da Storico > Rigenera).
//
// DRY_RUN=1 (default) stampa e non scrive; DRY_RUN=0 scrive DB + Calendar + Excel.

import fs from "node:fs";
import * as XLSX from "xlsx";
import { fetchGoogleCalendarEvents, updateGoogleCalendarEventDescription } from "../../src/lib/googleCalendar.js";
import {
  computePatientState, computeRinumerazione, matchPatientForEvent, buildInvoiceRow, accumulaContante, stripCodiceEsistente,
  COLUMN_ORDER, DEFAULT_SETTINGS, addDays,
} from "../../src/lib/logic.js";

const DRY_RUN = process.env.DRY_RUN !== "0";
const OGGI = "2026-09-29";
const envRaw = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function supaGet(q) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: H });
  if (!res.ok) throw new Error(`GET fallita: ${await res.text()}`);
  return res.json();
}
async function supaWrite(method, q, body) {
  if (DRY_RUN) { console.log(`[DRY] ${method} ${q}`, JSON.stringify(body)); return; }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, {
    method, headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} fallita (${q}): ${await res.text()}`);
}

let refreshToken;
async function scriviNota(ev, nuova, etichetta) {
  console.log(`  ${etichetta} ${ev.data}: "${(ev.descrizione || "").split("\n")[0]}" -> "${nuova.split("\n")[0]}"`);
  if (!DRY_RUN) { await updateGoogleCalendarEventDescription(refreshToken, ev.id, nuova); await new Promise((r) => setTimeout(r, 150)); }
}

// Cambia solo l'inizio della nota (es. "np 2" -> "np 3"), con guardia sul testo atteso.
let PAZ = [];
async function correggiInizioNota(events, nome, data, vecchio, nuovo) {
  const ev = events.filter((e) => e.data === data && matchPatientForEvent(e.titolo, PAZ)?.patient?.nome_calendario === nome);
  if (ev.length !== 1) throw new Error(`${nome} ${data}: attesi 1 evento, trovati ${ev.length}`);
  const d = ev[0].descrizione || "";
  if (!(d === vecchio || /^[ \n<]/.test(d.slice(vecchio.length)) && d.startsWith(vecchio))) {
    throw new Error(`${nome} ${data}: nota inattesa "${d.slice(0, 40)}" (atteso "${vecchio}")`);
  }
  await scriviNota(ev[0], nuovo + d.slice(vecchio.length), nome);
}

async function scriviPiano(piano) {
  for (const r of piano.filter((r) => r.cambia)) {
    console.log(`  ${r.data}: "${r.descrizioneOriginale.split("\n")[0]}" -> "${r.descrizioneNuova.split("\n")[0]}"`);
    if (!DRY_RUN) { await updateGoogleCalendarEventDescription(refreshToken, r.id, r.descrizioneNuova); await new Promise((x) => setTimeout(x, 150)); }
  }
}

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== SCRITTURA REALE ===");
  const patients = await supaGet("patients?select=*");
  PAZ = patients;
  [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const settingsRow = (await supaGet("settings?select=*"))[0];
  const settings = { ...DEFAULT_SETTINGS, ...settingsRow };
  const events = await fetchGoogleCalendarEvents(refreshToken, "2026-04-01", "2027-02-28");
  const pag = await supaGet("contante_pagamenti?select=*");
  const canc = await supaGet("cancellations?select=*");
  const P = (id) => patients.find((p) => p.id === id);

  // ---------- A ----------
  console.log("\n--- A. Passaggio a non_fatturato ---");
  for (const [id, nome] of [[14, "Romano A."], [128, "Michela M."], [10, "Sergio Andrei"], [424, "Riccardo M."]]) {
    const p = P(id);
    if (!p || p.nome_calendario !== nome) throw new Error(`Paziente ${id} inatteso`);
    console.log(`${nome}: stato ${p.stato} -> non_fatturato`);
    await supaWrite("PATCH", `patients?id=eq.${id}`, { stato: "non_fatturato" });
    for (const e of events.filter((e) => e.data > OGGI && matchPatientForEvent(e.titolo, patients)?.patient === p)) {
      const nuova = stripCodiceEsistente(e.descrizione).trim();
      if (nuova !== (e.descrizione || "").trim()) await scriviNota(e, nuova, "  toglie codice");
    }
  }

  // ---------- B. Giulia C. ----------
  console.log("\n--- B. Giulia C. ---");
  const giulia = P(54);
  if (giulia.nome_calendario !== "Giulia C." || giulia.ancora_data !== "2026-09-23" || giulia.ancora_valore !== 0) throw new Error("Giulia: stato inatteso");
  await correggiInizioNota(events, "Giulia C.", "2026-09-08", "R4", "R5");
  await correggiInizioNota(events, "Giulia C.", "2026-09-22", "R5 fatturare", "R6");
  const giuliaDopo = { ...giulia, ancora_valore: 1 };
  await supaWrite("PATCH", "patients?id=eq.54", { ancora_valore: 1 });
  const rosterG = patients.map((p) => (p.id === 54 ? giuliaDopo : p));
  await scriviPiano(computeRinumerazione(giuliaDopo, events, settings, rosterG, { pagamentiContante: pag.filter((x) => x.patient_id === 54) }));

  // ---------- C + D. Fatture ----------
  const rows = [];
  const fatture = [
    { id: 230, nome: "Luana S.", numero: 161, ultima: "2026-09-10", primi: "2026-06-11", attese: ["2026-06-11", "2026-07-09", "2026-07-22", "2026-09-01", "2026-09-10"] },
    { id: 252, nome: "Elisabetta U.", numero: 162, ultima: "2026-07-15", primi: "2026-05-06", attese: ["2026-05-06", "2026-05-27", "2026-06-10", "2026-06-24", "2026-07-15"] },
  ];
  let fid = 1;
  for (const f of fatture) {
    console.log(`\n--- Fattura ${f.numero}: ${f.nome} ---`);
    const p = P(f.id);
    if (p.nome_calendario !== f.nome) throw new Error(`${f.nome}: id inatteso`);
    const nonAdd = new Set(canc.filter((c) => c.patient_id === f.id && c.billing_status === "not_charged").map((c) => c.original_date));
    const sedute = events.filter((e) => matchPatientForEvent(e.titolo, patients)?.patient === p && e.data >= f.primi && e.data <= f.ultima && !nonAdd.has(e.data)).sort((a, b) => (a.data < b.data ? -1 : 1));
    console.log("Sedute fatturate:", sedute.map((s) => s.data).join(", "));
    if (JSON.stringify(sedute.map((s) => s.data)) !== JSON.stringify(f.attese)) throw new Error(`${f.nome}: sedute diverse dalle attese`);
    if (f.id === 252 && p.ancora_data !== "2026-09-16") throw new Error("Elisabetta: ancora inattesa");
    if (f.id === 230 && p.ancora_data !== "2026-09-10") throw new Error("Luana: ancora inattesa");

    const row = buildInvoiceRow(p, { count: 5 }, settings, OGGI, fid++, f.numero);
    console.log(`Riga: n.${row.fatturaNUMERO} totale=${row.fatturaTOTALE} onorario=${row._onorario} "${row.fatturaPRESTAZIONE}"`);
    rows.push(row);
    await supaWrite("POST", "invoice_history", {
      user_id: p.user_id, patient_id: f.id, data: OGGI, codice_fiscale: row.pazienteID,
      totale_sedute: 5, onorario: row._onorario, note: row.fatturaNOTE, numero: f.numero,
    });
    const nuovaAncora = addDays(f.ultima, 1);
    const patch = { ancora_data: nuovaAncora, ancora_valore: 0 };
    if (p.quota_contante_seduta > 0) patch.contante_dovuto = accumulaContante(p.contante_dovuto, p.quota_contante_seduta, 5);
    console.log(`Ancora ${p.ancora_data}/${p.ancora_valore} -> ${nuovaAncora}/0`, patch.contante_dovuto != null ? `contante_dovuto ${p.contante_dovuto} -> ${patch.contante_dovuto}` : "");
    await supaWrite("PATCH", `patients?id=eq.${f.id}`, patch);

    // note dei giorni passati con numeri sbagliati + rinumerazione dalla nuova ancora
    if (f.id === 230) {
      await correggiInizioNota(events, f.nome, "2026-07-22", "np 2", "np 3");
      await correggiInizioNota(events, f.nome, "2026-09-01", "np 3", "np 4");
      await correggiInizioNota(events, f.nome, "2026-09-10", "R4", "R5 fatturare");
    } else {
      await correggiInizioNota(events, f.nome, "2026-05-27", "Np 1", "Np 2");
      await correggiInizioNota(events, f.nome, "2026-06-10", "Np 2", "Np 3");
      await correggiInizioNota(events, f.nome, "2026-06-24", "Np 3", "Np 4");
      await correggiInizioNota(events, f.nome, "2026-07-15", "Np 4", "Np 5 fatturare");
    }
    const dopo = { ...p, ...patch };
    const roster = patients.map((x) => (x.id === f.id ? dopo : x));
    const piano = computeRinumerazione(dopo, events, settings, roster, { pagamentiContante: pag.filter((x) => x.patient_id === f.id) });
    console.log("Rinumerazione dalla nuova ancora:");
    await scriviPiano(piano);
    const st = computePatientState(dopo, events, settings, canc.filter((c) => c.patient_id === f.id), roster);
    console.log(`Stato dopo: count=${st.count} ${st.stato} usati=${st.usati.map((u) => u.data)}`);
  }

  const ultimo = Math.max(...fatture.map((f) => f.numero)) + 1;
  await supaWrite("PATCH", `settings?user_id=eq.${P(230).user_id}`, { ultimo_numero_fattura: ultimo });
  const ws = XLSX.utils.json_to_sheet(rows.map(({ _onorario, _count, _tariffa, ...r }) => r), { header: COLUMN_ORDER });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Foglio1");
  const xlsPath = `C:\\Users\\mabra\\OneDrive\\Download\\import_fatture_${OGGI}_luana_elisabetta.xls`;
  if (DRY_RUN) console.log(`\n[DRY] scriverei l'Excel: ${xlsPath}`);
  else { XLSX.writeFile(wb, xlsPath, { bookType: "xls" }); console.log(`\n[OK] Excel: ${xlsPath}`); }
  console.log(DRY_RUN ? "\n[DRY RUN COMPLETATO]" : "\n[FATTO]");
}

main().catch((e) => { console.error("ERRORE:", e); process.exit(1); });

