// Francesca S. (id 222): conferma la fattura delle 5 sedute agevolate
// (19/5..29/9, vedi scripts/archivio/fix-francesca-s.mjs per la diagnosi
// dell'ancora_data), registra i 100€ di contanti versati oggi, e imposta il
// passaggio a cadenza mensile a partire dal 9/11 (anzichè dal 12/10, mai
// avvenuto per davvero) con il conteggio agevolata che riparte da 1.
//
// DRY_RUN=1 (default): stampa tutto senza scrivere nulla. DRY_RUN=0: scrive
// per davvero (DB + Google Calendar). Eseguire prima in dry-run e controllare
// l'output riga per riga.

import fs from "node:fs";
import { fetchGoogleCalendarEvents, updateGoogleCalendarEventDescription, deleteGoogleCalendarEvent } from "../../src/lib/googleCalendar.js";
import { computePatientState, computeRinumerazione, buildInvoiceRow, accumulaContante, incassaContante, COLUMN_ORDER, DEFAULT_SETTINGS, addDays, todayISO } from "../../src/lib/logic.js";
import * as XLSX from "xlsx";

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

async function supaGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET fallita: ${await res.text()}`);
  return res.json();
}
async function supaPatch(pathAndQuery, body) {
  if (DRY_RUN) { console.log(`[DRY] PATCH ${pathAndQuery}`, JSON.stringify(body)); return; }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH fallita (${pathAndQuery}): ${await res.text()}`);
}
async function supaInsert(pathAndQuery, body) {
  if (DRY_RUN) { console.log(`[DRY] INSERT ${pathAndQuery}`, JSON.stringify(body)); return; }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase INSERT fallita (${pathAndQuery}): ${await res.text()}`);
}

const PATIENT_ID = 222;
const NUMERO_FATTURA = 160; // 154 emesse su Psicogest + 5 già in coda nell'app (155-159, non ancora importate) = 160 libera (corretto da Maurizio, non il suggerimento automatico 155)
const DATA_FATTURA = "2026-09-29"; // ultima seduta del ciclo, coerente con todayISO() di oggi
const IMPORTO_CONTANTI = 100;
const DATA_CONTANTI = "2026-09-29"; // versati oggi, stessa data della seduta
const NUOVO_SLOT_ID = 82;
const NUOVA_ANCORA_SLOT = "2026-11-09";
const EVENTO_OTTOBRE_DA_ELIMINARE = "6sr34e9kcgojcbb2ccr3eb9k64s3ab9p6ti3ibb16kp64e3374o3aor36c"; // 2026-10-12 "A1", da rimuovere: niente seduta in ottobre

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN (nessuna scrittura) ===" : "=== SCRITTURA REALE ===");

  const allPatients = await supaGet("patients?select=*");
  const patient = allPatients.find((p) => p.id === PATIENT_ID);
  if (!patient) throw new Error("Paziente non trovato");
  if (patient.ancora_data !== "2026-05-06") throw new Error(`ancora_data inattesa (${patient.ancora_data}), atteso 2026-05-06 (fix-francesca-s.mjs già eseguito?)`);

  const cancellazioni = await supaGet(`cancellations?select=*&patient_id=eq.${PATIENT_ID}`);
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const settingsRow = (await supaGet("settings?select=*"))[0];
  const settings = { ...DEFAULT_SETTINGS, ...settingsRow };
  const events = await fetchGoogleCalendarEvents(refreshToken, "2026-01-01", "2027-02-28");

  // --- 1. Stato attuale e riga fattura ---
  const computed = computePatientState(patient, events, settings, cancellazioni, allPatients);
  console.log("\nStato attuale:", JSON.stringify({ count: computed.count, stato: computed.stato, usati: computed.usati.map((u) => u.data) }));
  if (computed.count !== 5 || computed.stato !== "pronto") throw new Error("Stato inatteso, mi fermo.");

  const row = buildInvoiceRow(patient, computed, settings, DATA_FATTURA, 1, NUMERO_FATTURA);
  console.log("\nRiga fattura:", JSON.stringify(row, null, 2));

  // --- 2. Excel per Psicogest (stesso formato di eseguiGenerazioneBatch) ---
  const { _onorario, _count, _tariffa, ...exportRow } = row;
  const ws = XLSX.utils.json_to_sheet([exportRow], { header: COLUMN_ORDER });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Foglio1");
  const xlsPath = `C:\\Users\\mabra\\OneDrive\\Download\\import_fatture_${DATA_FATTURA}_francesca_s.xls`;
  if (DRY_RUN) {
    console.log(`\n[DRY] scriverei l'Excel in: ${xlsPath}`);
  } else {
    XLSX.writeFile(wb, xlsPath, { bookType: "xls" });
    console.log(`\n[OK] Excel scritto in: ${xlsPath}`);
  }

  // --- 3. invoice_history + patients (ancora, contante_dovuto) + settings.ultimo_numero_fattura ---
  await supaInsert("invoice_history", {
    user_id: patient.user_id,
    patient_id: PATIENT_ID,
    data: DATA_FATTURA,
    codice_fiscale: row.pazienteID,
    totale_sedute: row._count,
    onorario: row._onorario,
    note: row.fatturaNOTE,
    numero: NUMERO_FATTURA,
  });

  const nuovaAncoraData = addDays(DATA_FATTURA, 1); // 2026-09-30, giorno dopo l'ultima seduta fatturata
  const dovutoAccumulato = accumulaContante(patient.contante_dovuto || 0, patient.quota_contante_seduta, row._count); // 0 + 20*5 = 100
  const dovutoDopoIncasso = incassaContante(dovutoAccumulato, IMPORTO_CONTANTI); // 100 - 100 = 0
  console.log(`\nAncora: ${patient.ancora_data} -> ${nuovaAncoraData} (valore resta 0)`);
  console.log(`Contante dovuto: ${patient.contante_dovuto} -> accumulo ${dovutoAccumulato} -> dopo incasso ${dovutoDopoIncasso}`);
  await supaPatch(`patients?id=eq.${PATIENT_ID}`, { ancora_data: nuovaAncoraData, ancora_valore: 0, contante_dovuto: dovutoDopoIncasso });

  await supaInsert("contante_pagamenti", {
    user_id: patient.user_id,
    patient_id: PATIENT_ID,
    importo: IMPORTO_CONTANTI,
    data: DATA_CONTANTI,
  });

  await supaPatch(`settings?user_id=eq.${patient.user_id}`, { ultimo_numero_fattura: NUMERO_FATTURA + 1 });

  // --- 4. Slot mensile: anchor -> 9/11, elimina l'occorrenza di ottobre ---
  await supaPatch(`patient_slots?id=eq.${NUOVO_SLOT_ID}`, { anchor_date: NUOVA_ANCORA_SLOT });

  console.log(`\nElimino da Google Calendar l'evento del 12/10 (${EVENTO_OTTOBRE_DA_ELIMINARE}), nessuna seduta prevista in ottobre.`);
  if (DRY_RUN) {
    console.log("[DRY] deleteGoogleCalendarEvent", EVENTO_OTTOBRE_DA_ELIMINARE);
  } else {
    await deleteGoogleCalendarEvent(refreshToken, EVENTO_OTTOBRE_DA_ELIMINARE);
    console.log("[OK] evento del 12/10 eliminato.");
  }

  // --- 5. Rinumerazione: verifica che il 9/11 diventi "A1" con la nuova ancora ---
  const patientDopo = { ...patient, ancora_data: nuovaAncoraData, ancora_valore: 0, contante_dovuto: dovutoDopoIncasso };
  const rosterDopo = allPatients.map((p) => (p.id === PATIENT_ID ? patientDopo : p));
  const eventiSenzaOttobre = events.filter((e) => e.id !== EVENTO_OTTOBRE_DA_ELIMINARE);
  const pagamenti = [{ data: DATA_CONTANTI, importo: IMPORTO_CONTANTI }];
  const piano = computeRinumerazione(patientDopo, eventiSenzaOttobre, settings, rosterDopo, { pagamentiContante: pagamenti });
  console.log("\ncomputeRinumerazione con la nuova ancora e senza l'evento di ottobre:");
  for (const r of piano) console.log(`  ${r.data} ${r.ora} : "${r.descrizioneOriginale}" -> "${r.descrizioneNuova}"`);

  const primaRiga = piano[0];
  if (!primaRiga || primaRiga.data !== "2026-11-09" || primaRiga.codice !== "A1") {
    throw new Error(`Atteso 2026-11-09 = "A1" come prima riga del piano, trovato: ${JSON.stringify(primaRiga)}. NON scrivo le note.`);
  }
  console.log("\n[OK] 2026-11-09 risulta A1, come richiesto.");

  for (const r of piano.filter((r) => r.cambia)) {
    if (DRY_RUN) {
      console.log(`[DRY] scriverei su ${r.data} "${r.descrizioneNuova}"`);
    } else {
      await updateGoogleCalendarEventDescription(refreshToken, r.id, r.descrizioneNuova);
      console.log(`  scritto ${r.data} "${r.descrizioneNuova}"`);
      await new Promise((res) => setTimeout(res, 150));
    }
  }

  console.log(DRY_RUN ? "\n[DRY RUN COMPLETATO — nessuna scrittura reale eseguita]" : "\n[FATTO]");
}

main().catch((e) => { console.error("ERRORE:", e); process.exit(1); });
