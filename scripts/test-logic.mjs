// Test automatici minimi per src/lib/logic.js — nessun framework, si lancia
// con `npm test`. Obiettivo: prevenire regressioni silenziose come quella di
// addDays (fuso orario) scoperta solo grazie a un caso reale.

import assert from "node:assert/strict";
import {
  addDays,
  daysBetween,
  normalizeName,
  matchPatientForEvent,
  computePatientState,
  buildInvoiceRow,
  letteraCodice,
  formatCodice,
  stripCodiceEsistente,
  buildNuovaDescrizione,
  eventiDiPazienteOrdinati,
  computeRinumerazione,
  analizzaNotaPerAudit,
  DEFAULT_SETTINGS,
} from "../src/lib/logic.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    console.error(`  ${e.message}`);
    process.exitCode = 1;
  }
}

// --- addDays: il bug del fuso orario che ha causato doppio conteggio ---
test("addDays avanza di un giorno dentro lo stesso mese", () => {
  assert.equal(addDays("2026-03-10", 1), "2026-03-11");
});
test("addDays attraversa il cambio mese", () => {
  assert.equal(addDays("2026-03-31", 1), "2026-04-01");
});
test("addDays attraversa il cambio anno", () => {
  assert.equal(addDays("2025-12-31", 1), "2026-01-01");
});
test("addDays gestisce anno bisestile (29 febbraio)", () => {
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2028-02-29", 1), "2028-03-01");
});

test("daysBetween conta i giorni tra due date", () => {
  assert.equal(daysBetween("2026-01-01", "2026-01-10"), 9);
});

// --- normalizeName / matchPatientForEvent ---
test("normalizeName ignora accenti, maiuscole e spazi doppi", () => {
  assert.equal(normalizeName("  Andréa   Ross  "), "ANDREA ROSS");
});
test("matchPatientForEvent trova corrispondenza esatta", () => {
  const patients = [{ nome_calendario: "Mario Rossi" }];
  const m = matchPatientForEvent("Mario Rossi", patients);
  assert.equal(m.confidence, "esatto");
});
test("matchPatientForEvent trova corrispondenza parziale (es. titolo con note extra)", () => {
  const patients = [{ nome_calendario: "Mario Rossi" }];
  const m = matchPatientForEvent("Mario Rossi - online", patients);
  assert.equal(m.confidence, "parziale");
});
test("matchPatientForEvent non trova nulla se il nome non compare", () => {
  const patients = [{ nome_calendario: "Mario Rossi" }];
  assert.equal(matchPatientForEvent("Luigi Bianchi", patients), null);
});

// --- computePatientState ---
test("computePatientState conta solo le sedute dopo ancora_data", () => {
  const patient = { nome_calendario: "Mario Rossi", ancora_data: "2026-02-01", ancora_valore: 0, soglia_fatturazione: 5 };
  const events = [
    { data: "2026-01-15", titolo: "Mario Rossi" }, // prima dell'ancora, non contata
    { data: "2026-02-10", titolo: "Mario Rossi" },
    { data: "2026-02-17", titolo: "Mario Rossi" },
  ];
  const st = computePatientState(patient, events, DEFAULT_SETTINGS);
  assert.equal(st.count, 2);
});
test("computePatientState somma ancora_valore alle sedute nuove", () => {
  const patient = { nome_calendario: "Mario Rossi", ancora_data: "2026-02-01", ancora_valore: 3, soglia_fatturazione: 5 };
  const events = [{ data: "2026-02-10", titolo: "Mario Rossi" }];
  const st = computePatientState(patient, events, DEFAULT_SETTINGS);
  assert.equal(st.count, 4);
});
test("computePatientState segnala 'pronto' solo al raggiungimento della soglia", () => {
  const patient = { nome_calendario: "Mario Rossi", ancora_valore: 4, soglia_fatturazione: 5 };
  const events = [{ data: "2020-01-01", titolo: "Mario Rossi" }];
  const st = computePatientState(patient, events, DEFAULT_SETTINGS);
  assert.equal(st.stato, "pronto");
});
test("computePatientState: paziente sospeso resta 'sospeso' anche sopra soglia", () => {
  const patient = { nome_calendario: "Mario Rossi", stato: "sospeso", ancora_valore: 9, soglia_fatturazione: 5 };
  const st = computePatientState(patient, [], DEFAULT_SETTINGS);
  assert.equal(st.stato, "sospeso");
});

// --- buildInvoiceRow: scorporo onorario/ENPAP/bollo ---
test("buildInvoiceRow: onorario + ENPAP torna esattamente alla tariffa tonda", () => {
  const patient = { costo_unitario: 80, tipologia: "individuale", regime_tariffario: "regolare" };
  const computed = { count: 1, usati: [{ data: "2026-01-10" }], ultimaData: "2026-01-10" };
  const row = buildInvoiceRow(patient, computed, DEFAULT_SETTINGS, "2026-01-15", 1, 100);
  assert.equal(Math.round((row.fatturaONORARIO + row.fatturaENPAP) * 100) / 100, 80);
});
test("buildInvoiceRow: bollo 2€ solo sopra la soglia impostata", () => {
  const patientSopra = { costo_unitario: 80, tipologia: "individuale", regime_tariffario: "regolare" };
  const patientSotto = { costo_unitario: 50, tipologia: "individuale", regime_tariffario: "agevolata" };
  const computed = { count: 1, usati: [{ data: "2026-01-10" }], ultimaData: "2026-01-10" };
  const rowSopra = buildInvoiceRow(patientSopra, computed, DEFAULT_SETTINGS, "2026-01-15", 1, 100);
  const rowSotto = buildInvoiceRow(patientSotto, computed, DEFAULT_SETTINGS, "2026-01-15", 1, 100);
  assert.equal(rowSopra.fatturaBOLLO, 2);
  assert.equal(rowSotto.fatturaBOLLO, 0);
});
test("buildInvoiceRow: regime agevolato aggiunge la dicitura in prestazione", () => {
  const patient = { costo_unitario: 50, tipologia: "individuale", regime_tariffario: "agevolata" };
  const computed = { count: 1, usati: [{ data: "2026-01-10" }], ultimaData: "2026-01-10" };
  const row = buildInvoiceRow(patient, computed, DEFAULT_SETTINGS, "2026-01-15", 1, 100);
  assert.ok(row.fatturaPRESTAZIONE.includes("tariffa agevolata"));
});
test("buildInvoiceRow: fatturaDATA è un vero oggetto Date, non una stringa", () => {
  const patient = { costo_unitario: 80, tipologia: "individuale", regime_tariffario: "regolare" };
  const computed = { count: 1, usati: [{ data: "2026-01-10" }], ultimaData: "2026-01-10" };
  const row = buildInvoiceRow(patient, computed, DEFAULT_SETTINGS, "2026-01-15", 1, 100);
  assert.ok(row.fatturaDATA instanceof Date);
});
test("buildInvoiceRow: fatturaDATAPAGAMENTO non è presente come chiave (non pagato)", () => {
  const patient = { costo_unitario: 80, tipologia: "individuale", regime_tariffario: "regolare" };
  const computed = { count: 1, usati: [{ data: "2026-01-10" }], ultimaData: "2026-01-10" };
  const row = buildInvoiceRow(patient, computed, DEFAULT_SETTINGS, "2026-01-15", 1, 100);
  assert.ok(!("fatturaDATAPAGAMENTO" in row));
});

// --- Numerazione sedute su calendario ---
test("letteraCodice: sospeso ha priorità sul regime", () => {
  assert.equal(letteraCodice({ stato: "sospeso", regime_tariffario: "agevolata" }), "S");
  assert.equal(letteraCodice({ regime_tariffario: "agevolata" }), "A");
  assert.equal(letteraCodice({ regime_tariffario: "regolare" }), "R");
});
test("formatCodice aggiunge 'fatturare' solo quando richiesto", () => {
  assert.equal(formatCodice("R", 3, false), "R3");
  assert.equal(formatCodice("R", 5, true), "R5 fatturare");
});
test("stripCodiceEsistente riconosce i vecchi formati scritti a mano", () => {
  assert.equal(stripCodiceEsistente("Np 3 link zoom"), "link zoom");
  assert.equal(stripCodiceEsistente("3 np link zoom"), "link zoom");
  assert.equal(stripCodiceEsistente("NpA4 - deve 100 euro"), "- deve 100 euro");
  assert.equal(stripCodiceEsistente("nf 8"), "");
  assert.equal(stripCodiceEsistente("pc 13 promemoria"), "promemoria");
});
test("stripCodiceEsistente riconosce il nuovo formato scritto dall'app", () => {
  assert.equal(stripCodiceEsistente("R4 link meet"), "link meet");
  assert.equal(stripCodiceEsistente("A5 fatturare"), "");
});
test("stripCodiceEsistente lascia intatto il testo senza codice riconosciuto", () => {
  assert.equal(stripCodiceEsistente("link meet https://..."), "link meet https://...");
});
test("buildNuovaDescrizione preserva il resto della nota (link, promemoria)", () => {
  assert.equal(buildNuovaDescrizione("Np 3 https://meet.example/xyz", "R4"), "R4 https://meet.example/xyz");
});
test("buildNuovaDescrizione è idempotente: rilanciata due volte non duplica testo", () => {
  const prima = buildNuovaDescrizione("Np 3 https://meet.example/xyz", "R4");
  const seconda = buildNuovaDescrizione(prima, "R5");
  assert.equal(seconda, "R5 https://meet.example/xyz");
});

test("eventiDiPazienteOrdinati filtra da ancora_data e ordina cronologicamente", () => {
  const patient = { nome_calendario: "Mario Rossi", ancora_data: "2026-02-01" };
  const events = [
    { id: "a", data: "2026-01-15", ora: "10:00", titolo: "Mario Rossi", descrizione: "" }, // escluso
    { id: "b", data: "2026-02-17", ora: "09:00", titolo: "Mario Rossi", descrizione: "" },
    { id: "c", data: "2026-02-10", ora: "11:00", titolo: "Mario Rossi", descrizione: "" },
  ];
  const ordinati = eventiDiPazienteOrdinati(patient, events);
  assert.deepEqual(ordinati.map((e) => e.id), ["c", "b"]);
});

test("computeRinumerazione: il contatore riparte da 1 dopo la soglia (non sospeso)", () => {
  const patient = { nome_calendario: "Mario Rossi", ancora_data: "2026-01-01", ancora_valore: 0, soglia_fatturazione: 3, regime_tariffario: "regolare" };
  const events = ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02"].map((data, i) => ({
    id: `ev${i}`,
    data,
    ora: "10:00",
    titolo: "Mario Rossi",
    descrizione: "",
  }));
  const piano = computeRinumerazione(patient, events, DEFAULT_SETTINGS);
  assert.deepEqual(piano.map((r) => r.codice), ["R1", "R2", "R3 fatturare", "R1", "R2"]);
});
test("computeRinumerazione: paziente sospeso accumula senza mai azzerarsi", () => {
  const patient = { nome_calendario: "Mario Rossi", ancora_data: "2026-01-01", ancora_valore: 0, soglia_fatturazione: 3, stato: "sospeso" };
  const events = ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"].map((data, i) => ({
    id: `ev${i}`,
    data,
    ora: "10:00",
    titolo: "Mario Rossi",
    descrizione: "",
  }));
  const piano = computeRinumerazione(patient, events, DEFAULT_SETTINGS);
  assert.deepEqual(piano.map((r) => r.codice), ["S1", "S2", "S3", "S4"]);
});
test("computeRinumerazione: riparte da ancora_valore, non da zero", () => {
  const patient = { nome_calendario: "Mario Rossi", ancora_data: "2026-01-01", ancora_valore: 2, soglia_fatturazione: 3, regime_tariffario: "regolare" };
  const events = [{ id: "ev0", data: "2026-01-05", ora: "10:00", titolo: "Mario Rossi", descrizione: "" }];
  const piano = computeRinumerazione(patient, events, DEFAULT_SETTINGS);
  assert.deepEqual(piano.map((r) => r.codice), ["R3 fatturare"]);
});
test("computeRinumerazione: 'cambia' è false se la nota è già corretta", () => {
  const patient = { nome_calendario: "Mario Rossi", ancora_data: "2026-01-01", ancora_valore: 0, soglia_fatturazione: 5, regime_tariffario: "regolare" };
  const events = [{ id: "ev0", data: "2026-01-05", ora: "10:00", titolo: "Mario Rossi", descrizione: "R1" }];
  const piano = computeRinumerazione(patient, events, DEFAULT_SETTINGS);
  assert.equal(piano[0].cambia, false);
});

// --- analizzaNotaPerAudit (prova a vuoto sulle note storiche) ---
test("analizzaNotaPerAudit non segnala un formato già riconosciuto (nf/np/pc/R/A/S)", () => {
  assert.equal(analizzaNotaPerAudit("NF2 qualcosa").sospetta, false);
  assert.equal(analizzaNotaPerAudit("S3").sospetta, false);
});
test("analizzaNotaPerAudit segnala un possibile codice mai visto prima", () => {
  assert.equal(analizzaNotaPerAudit("Ctr 4 nota").sospetta, true);
});
test("analizzaNotaPerAudit non segnala testo libero senza pattern codice", () => {
  assert.equal(analizzaNotaPerAudit("link meet https://...").sospetta, false);
});
test("analizzaNotaPerAudit non segnala una nota vuota", () => {
  assert.equal(analizzaNotaPerAudit("").sospetta, false);
});
test("analizzaNotaPerAudit non segnala 'Deve 100' (parola di 4 lettere, non una sigla)", () => {
  assert.equal(analizzaNotaPerAudit("Deve 100").sospetta, false);
  assert.equal(analizzaNotaPerAudit("Deve 100 euro").sospetta, false);
});
test("analizzaNotaPerAudit non segnala parole comuni brevi seguite da un numero (es. 'Ore 15')", () => {
  assert.equal(analizzaNotaPerAudit("Ore 15").sospetta, false);
  assert.equal(analizzaNotaPerAudit("Dal 3 al 5").sospetta, false);
});

console.log(`\n${passed} test superati.`);
if (process.exitCode) {
  console.error("Alcuni test sono falliti.");
} else {
  console.log("Tutti i test sono passati.");
}
