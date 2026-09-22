// Test automatici minimi per src/lib/logic.js — nessun framework, si lancia
// con `npm test`. Obiettivo: prevenire regressioni silenziose come quella di
// addDays (fuso orario) scoperta solo grazie a un caso reale.

import assert from "node:assert/strict";
import {
  addDays,
  daysBetween,
  todayISO,
  normalizeName,
  titleCaseNomeCalendario,
  matchPatientForEvent,
  computePatientState,
  buildInvoiceRow,
  buildPsicogestAnagraficaRow,
  letteraCodice,
  formatCodice,
  stripCodiceEsistente,
  accumulaContante,
  incassaContante,
  buildNuovaDescrizione,
  eventiDiPazienteOrdinati,
  computeRinumerazione,
  analizzaNotaPerAudit,
  DEFAULT_SETTINGS,
  parseBookingInfo,
  matchBookingToPatient,
  matchPatientToGoogleContact,
  computePrenotazioniPreview,
  occorrenzeFuture,
  slotsInConflitto,
  rilevaConflittiChiusura,
  computeImpattoChiusura,
  chiusuraDentroFinestra,
  calcolaRigheChiusuraModificata,
  titoloChiusura,
  notaDaTitoloChiusura,
  computeRiprenotazioniPendenti,
  computePazientiConSalto,
  computeOccorrenzeDaGenerare,
  computeDuplicatiDaRipulire,
  formatDataItaliana,
  personalizzaTesto,
  computeGrigliaDisponibilita,
  computeStatisticheDisdette,
  tempoInZonaRossa,
  bilancioAlla,
  computeConflittiPrenotazioni,
  computeIncassiContantiDaRegistrare,
  rimuoviMarcatoreSaldato,
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
test("titleCaseNomeCalendario uniforma il lettering (tutto maiuscolo -> solo iniziali)", () => {
  assert.equal(titleCaseNomeCalendario("DAVIDE S."), "Davide S.");
  assert.equal(titleCaseNomeCalendario("MIchela M."), "Michela M.");
});
test("titleCaseNomeCalendario tiene minuscolo il connettivo 'e' tra due nomi di coppia", () => {
  assert.equal(titleCaseNomeCalendario("GIULIA E DANIEL"), "Giulia e Daniel");
});
test("titleCaseNomeCalendario preserva iniziali multiple puntate", () => {
  assert.equal(titleCaseNomeCalendario("GIOVANNI D.L."), "Giovanni D.L.");
  assert.equal(titleCaseNomeCalendario("JOSEPHINE P.G."), "Josephine P.G.");
});
test("titleCaseNomeCalendario è idempotente su un nome già corretto", () => {
  assert.equal(titleCaseNomeCalendario("Jessica M."), "Jessica M.");
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

test("computePatientState: paziente concluso sotto soglia -> 'pronto' (fine rapporto, la soglia non conta), mai 'in_corso'/'da_valutare'", () => {
  const events = [{ data: "2020-01-01", titolo: "Mario Rossi" }];
  const poche = { nome_calendario: "Mario Rossi", stato: "concluso", ancora_valore: 0, soglia_fatturazione: 5 };
  assert.equal(computePatientState(poche, events, DEFAULT_SETTINGS).stato, "pronto");
});
test("computePatientState: paziente concluso che ha raggiunto la soglia -> 'pronto' (caso reale Paola e Antonello, soglia 1)", () => {
  const events = [{ data: "2020-01-01", titolo: "Mario Rossi" }];
  const patient = { nome_calendario: "Mario Rossi", stato: "concluso", ancora_valore: 0, soglia_fatturazione: 1 };
  assert.equal(computePatientState(patient, events, DEFAULT_SETTINGS).stato, "pronto");
});
test("computePazientiConSalto: un paziente concluso non compare mai tra quelli da ricontattare", () => {
  const events = [{ data: "2020-01-01", titolo: "Mario Rossi" }];
  const base = { id: 1, nome_calendario: "Mario Rossi" };
  assert.equal(computePazientiConSalto([base], [], events, []).length, 1); // controllo: un attivo senza futuro compare
  assert.equal(computePazientiConSalto([{ ...base, stato: "concluso" }], [], events, []).length, 0);
});
test("computePatientState: paziente concluso senza sedute -> 'senza_sedute'", () => {
  const patient = { nome_calendario: "Mario Rossi", stato: "concluso", ancora_valore: 0, soglia_fatturazione: 5 };
  assert.equal(computePatientState(patient, [], DEFAULT_SETTINGS).stato, "senza_sedute");
});

// Regressione 2026-09-08: due pazienti che condividono lo stesso nome di
// battesimo (es. reale "Francesco All./Man./Mer.") non devono mai contare
// un evento ambiguo (titolo col solo nome, senza l'iniziale del cognome) per
// entrambi — matchPatientForEvent deve vedere l'intera anagrafica (allPatients)
// per rifiutare il match debole quando è ambiguo, non solo il singolo paziente.
test("computePatientState con l'anagrafica completa NON conta un evento ambiguo condiviso da due pazienti omonimi", () => {
  const francesco1 = { nome_calendario: "Francesco All.", ancora_data: "2026-01-01", ancora_valore: 0, soglia_fatturazione: 5 };
  const francesco2 = { nome_calendario: "Francesco Man.", ancora_data: "2026-01-01", ancora_valore: 0, soglia_fatturazione: 5 };
  const roster = [francesco1, francesco2];
  const events = [{ data: "2026-01-05", titolo: "Francesco" }]; // titolo ambiguo, senza iniziale cognome
  assert.equal(computePatientState(francesco1, events, DEFAULT_SETTINGS, [], roster).count, 0);
  assert.equal(computePatientState(francesco2, events, DEFAULT_SETTINGS, [], roster).count, 0);
});
test("computePatientState senza allPatients (fallback [patient]) conta erroneamente l'evento ambiguo per entrambi — limite noto del fallback, non usarlo con più pazienti omonimi in gioco", () => {
  const francesco1 = { nome_calendario: "Francesco All.", ancora_data: "2026-01-01", ancora_valore: 0, soglia_fatturazione: 5 };
  const francesco2 = { nome_calendario: "Francesco Man.", ancora_data: "2026-01-01", ancora_valore: 0, soglia_fatturazione: 5 };
  const events = [{ data: "2026-01-05", titolo: "Francesco" }];
  assert.equal(computePatientState(francesco1, events, DEFAULT_SETTINGS).count, 1);
  assert.equal(computePatientState(francesco2, events, DEFAULT_SETTINGS).count, 1);
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
test("buildInvoiceRow: bonifico → l'IBAN dello studio finisce nelle note", () => {
  const patient = { costo_unitario: 80, tipologia: "individuale", regime_tariffario: "regolare", modalita_pagamento: "Bonifico" };
  const computed = { count: 1, usati: [{ data: "2026-01-10" }], ultimaData: "2026-01-10" };
  const row = buildInvoiceRow(patient, computed, DEFAULT_SETTINGS, "2026-01-15", 1, 100);
  assert.ok(row.fatturaNOTE.includes("IT16D0305801604100572116459"));
});
test("buildInvoiceRow: contante → nessun IBAN nelle note", () => {
  const patient = { costo_unitario: 80, tipologia: "individuale", regime_tariffario: "regolare", modalita_pagamento: "Contante" };
  const computed = { count: 1, usati: [{ data: "2026-01-10" }], ultimaData: "2026-01-10" };
  const row = buildInvoiceRow(patient, computed, DEFAULT_SETTINGS, "2026-01-15", 1, 100);
  assert.ok(!row.fatturaNOTE.includes("IT16"));
});

// --- buildPsicogestAnagraficaRow: export anagrafica per l'import Psicogest ---
test("buildPsicogestAnagraficaRow: valorizza nome/cognome/CF e i default fissi", () => {
  const row = buildPsicogestAnagraficaRow({ nome: "Mario", cognome: "Rossi", codice_fiscale: "RSSMRA80A01H501U", provincia: "RM" });
  assert.equal(row.pazienteNOME, "MARIO");
  assert.equal(row.pazienteCOGNOME, "ROSSI");
  assert.equal(row.pazienteID, "RSSMRA80A01H501U");
  assert.equal(row.pazienteCF, "RSSMRA80A01H501U");
  assert.equal(row.pazientePRIVATO, "s");
  assert.equal(row.pazienteNAZIONE, "IT");
});
test("buildPsicogestAnagraficaRow: nome/cognome in maiuscolo, accenti compresi", () => {
  const row = buildPsicogestAnagraficaRow({ nome: "Josè", cognome: "Saccà", codice_fiscale: "SCCRFL66L14C352K" });
  assert.equal(row.pazienteNOME, "JOSÈ");
  assert.equal(row.pazienteCOGNOME, "SACCÀ");
});
test("buildPsicogestAnagraficaRow: senza provincia (indirizzo estero) niente Nazione/Località/CAP", () => {
  const row = buildPsicogestAnagraficaRow({
    nome: "Mario",
    cognome: "Rossi",
    codice_fiscale: "RSSMRA80A01H501U",
    localita: "Leiden",
    cap: "2311XX",
  });
  assert.ok(!("pazienteNAZIONE" in row));
  assert.ok(!("pazienteLOCALITA" in row));
  assert.ok(!("pazienteCAP" in row));
  assert.ok(!("pazientePROVINCIA" in row));
});
test("buildPsicogestAnagraficaRow: email/telefono/note assenti come chiave se non compilati (non stringa vuota)", () => {
  const row = buildPsicogestAnagraficaRow({ nome: "Mario", cognome: "Rossi", codice_fiscale: "RSSMRA80A01H501U" });
  assert.ok(!("pazienteEMAIL" in row));
  assert.ok(!("pazienteTELEFONO" in row));
  assert.ok(!("pazienteNOTE" in row));
});
test("buildPsicogestAnagraficaRow: email/telefono/note inclusi quando presenti", () => {
  const row = buildPsicogestAnagraficaRow({
    nome: "Mario",
    cognome: "Rossi",
    codice_fiscale: "RSSMRA80A01H501U",
    email: "mario@example.com",
    telefono: "333 1234567",
    note: "deve 50€",
  });
  assert.equal(row.pazienteEMAIL, "mario@example.com");
  assert.equal(row.pazienteTELEFONO, "3331234567");
  assert.equal(row.pazienteNOTE, "deve 50€");
});
test("buildPsicogestAnagraficaRow: telefono - prefisso +39 e spazi rimossi del tutto", () => {
  const patient = { nome: "Mario", cognome: "Rossi", codice_fiscale: "RSSMRA80A01H501U" };
  assert.equal(buildPsicogestAnagraficaRow({ ...patient, telefono: "+39 393 917 4851" }).pazienteTELEFONO, "3939174851");
  assert.equal(buildPsicogestAnagraficaRow({ ...patient, telefono: "+393477581957" }).pazienteTELEFONO, "3477581957");
  assert.equal(buildPsicogestAnagraficaRow({ ...patient, telefono: " 3665465056" }).pazienteTELEFONO, "3665465056");
});
test("buildPsicogestAnagraficaRow: CAP con lettere omesso, CAP numerico incluso e trimmato (solo con provincia)", () => {
  const patient = { nome: "Mario", cognome: "Rossi", codice_fiscale: "RSSMRA80A01H501U", provincia: "RM" };
  assert.ok(!("pazienteCAP" in buildPsicogestAnagraficaRow({ ...patient, cap: "2311XX" })));
  assert.equal(buildPsicogestAnagraficaRow({ ...patient, cap: " 00168 " }).pazienteCAP, "00168");
});
test("buildPsicogestAnagraficaRow: email tronca/invalida omessa", () => {
  const patient = { nome: "Mario", cognome: "Rossi", codice_fiscale: "RSSMRA80A01H501U" };
  assert.ok(!("pazienteEMAIL" in buildPsicogestAnagraficaRow({ ...patient, email: "r.sacca@fondimpres" })));
});

// --- Numerazione sedute su calendario ---
test("letteraCodice: sospeso ha priorità sul regime", () => {
  assert.equal(letteraCodice({ stato: "sospeso", regime_tariffario: "agevolata" }), "S");
  assert.equal(letteraCodice({ regime_tariffario: "agevolata" }), "A");
  assert.equal(letteraCodice({ regime_tariffario: "regolare" }), "R");
});
test("letteraCodice: non_fatturato (NF) ha priorità sul regime, come sospeso", () => {
  assert.equal(letteraCodice({ stato: "non_fatturato", regime_tariffario: "agevolata" }), "NF");
  assert.equal(letteraCodice({ stato: "non_fatturato" }), "NF");
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
test("computeRinumerazione con l'anagrafica completa non abbina l'evento ambiguo di un omonimo (regressione 2026-09-08)", () => {
  const francesco1 = { nome_calendario: "Francesco All.", ancora_data: "2026-01-01", ancora_valore: 0, soglia_fatturazione: 5, regime_tariffario: "regolare" };
  const francesco2 = { nome_calendario: "Francesco Man.", ancora_data: "2026-01-01", ancora_valore: 0, soglia_fatturazione: 5, regime_tariffario: "regolare" };
  const roster = [francesco1, francesco2];
  const events = [
    { id: "ev0", data: "2026-01-05", ora: "10:00", titolo: "Francesco", descrizione: "" }, // ambiguo
    { id: "ev1", data: "2026-01-19", ora: "10:00", titolo: "Francesco All.", descrizione: "" }, // solo di francesco1
  ];
  const piano1 = computeRinumerazione(francesco1, events, DEFAULT_SETTINGS, roster);
  const piano2 = computeRinumerazione(francesco2, events, DEFAULT_SETTINGS, roster);
  assert.deepEqual(piano1.map((r) => r.id), ["ev1"]); // solo il suo, non l'ambiguo
  assert.deepEqual(piano2.map((r) => r.id), []); // nessun evento suo davvero
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

// --- Quota contanti non fatturata ---
test("formatCodice aggiunge il saldo contanti quando presente", () => {
  assert.equal(formatCodice("R", 3, false, 150), "R3 (deve 150€)");
  assert.equal(formatCodice("R", 3, false, 0), "R3");
  assert.equal(formatCodice("R", 3, false, undefined), "R3");
});
test("stripCodiceEsistente riconosce e rimuove anche il tag del saldo contanti", () => {
  assert.equal(stripCodiceEsistente("R3 (deve 150€) link zoom"), "link zoom");
  assert.equal(stripCodiceEsistente("R3 fatturare (deve 50€)"), "");
});
test("computeRinumerazione include il saldo contanti nel codice quando il paziente ce l'ha", () => {
  const patient = { nome_calendario: "Mario Rossi", ancora_data: "2026-01-01", ancora_valore: 0, soglia_fatturazione: 5, contante_dovuto: 150 };
  const events = [{ id: "ev0", data: "2026-01-05", ora: "10:00", titolo: "Mario Rossi", descrizione: "" }];
  const piano = computeRinumerazione(patient, events, DEFAULT_SETTINGS);
  assert.equal(piano[0].codice, "R1 (deve 150€)");
});
test("stripCodiceEsistente toglie anche 'contanti saldati' e le due diciture insieme", () => {
  assert.equal(stripCodiceEsistente("A5 fatturare (contanti saldati 100€) (deve 100€) link"), "link");
  assert.equal(stripCodiceEsistente("A2 (contanti saldati 30€) note"), "note");
});
test("formatCodice: contanti saldati nel giorno dell'incasso, poi il deve residuo", () => {
  assert.equal(formatCodice("A", 2, false, 0, 100), "A2 (contanti saldati 100€)");
  assert.equal(formatCodice("A", 2, false, 40, 60), "A2 (contanti saldati 60€) (deve 40€)");
});

// --- Stato "non_fatturato" (pro bono, supervisioni gratuite, pseudo-pazienti — 2026-09-22) ---
test("computeRinumerazione: non_fatturato non fattura mai, il contatore accumula senza azzerarsi (come sospeso)", () => {
  const patient = { nome_calendario: "Riunione Scienziati", stato: "non_fatturato", ancora_data: "2026-01-01", ancora_valore: 0, soglia_fatturazione: 5 };
  const events = Array.from({ length: 6 }, (_, i) => ({
    id: `e${i + 1}`,
    data: `2026-01-${String(5 + i * 7).padStart(2, "0")}`,
    ora: "10:00",
    titolo: "Riunione Scienziati",
    descrizione: "",
  }));
  const piano = computeRinumerazione(patient, events, DEFAULT_SETTINGS);
  assert.equal(piano[4].codice, "NF5"); // alla 5a seduta, un paziente normale fatturerebbe
  assert.equal(piano[5].codice, "NF6"); // continua a salire, nessun azzeramento
  assert.ok(piano.every((p) => !p.codice.includes("fatturare")));
});
test("computePatientState: non_fatturato non è mai 'pronto' né 'da_valutare', anche molto oltre soglia/giorni_stale", () => {
  const patient = { id: 1, nome_calendario: "Riunione Scienziati", stato: "non_fatturato", ancora_data: "2020-01-01", ancora_valore: 50, soglia_fatturazione: 5, giorni_stale_override: null };
  const events = [{ data: "2020-01-05", titolo: "Riunione Scienziati" }];
  const st = computePatientState(patient, events, DEFAULT_SETTINGS, [], [patient]);
  assert.equal(st.stato, "non_fatturato");
});
test("computePatientState: non_fatturato resta visibile anche a ZERO sedute contate (bug reale 2026-09-22: appena creato spariva)", () => {
  const patient = { id: 1, nome_calendario: "Riunione Scienziati", stato: "non_fatturato", ancora_data: null, ancora_valore: 0, soglia_fatturazione: 5 };
  const st = computePatientState(patient, [], DEFAULT_SETTINGS, [], [patient]);
  assert.equal(st.stato, "non_fatturato");
  assert.equal(st.count, 0);
});
test("computeStatisticheDisdette esclude i pazienti non_fatturato anche se hanno uno slot attivo", () => {
  const patients = [{ id: 1, nome_calendario: "Riunione Scienziati", stato: "non_fatturato" }];
  const slots = [{ patient_id: 1, active: true }];
  const cancellazioni = [{ patient_id: 1, original_date: "2026-01-05", cancelled_at: "2026-01-01T00:00:00Z" }];
  const events = [{ data: "2026-01-12", ora: "10:00", titolo: "Riunione Scienziati" }];
  const stat = computeStatisticheDisdette(patients, slots, events, cancellazioni, { oggi: "2026-01-20" });
  assert.equal(stat.righe.length, 0);
});

// --- Incasso contanti rilevato dalla nota "saldato"/"saldato N" (2026-09-22) ---
test("computeIncassiContantiDaRegistrare: 'saldato' senza numero propone tutto il dovuto", () => {
  const patients = [{ id: 1, nome_calendario: "Mario Rossi", quota_contante_seduta: 20, contante_dovuto: 60 }];
  const events = [{ id: "ev1", data: "2026-01-05", titolo: "Mario Rossi", descrizione: "A3 fatturare (deve 60€) saldato" }];
  const risultati = computeIncassiContantiDaRegistrare(events, patients);
  assert.equal(risultati.length, 1);
  assert.equal(risultati[0].importo, 60);
  assert.equal(risultati[0].saldoAttuale, 60);
  assert.equal(risultati[0].patientId, 1);
});
test("computeIncassiContantiDaRegistrare: 'saldato N' propone solo N (saldo parziale)", () => {
  const patients = [{ id: 1, nome_calendario: "Mario Rossi", quota_contante_seduta: 20, contante_dovuto: 60 }];
  const events = [{ id: "ev1", data: "2026-01-05", titolo: "Mario Rossi", descrizione: "A3 fatturare (deve 60€) saldato 30" }];
  const risultati = computeIncassiContantiDaRegistrare(events, patients);
  assert.equal(risultati[0].importo, 30);
});
test("computeIncassiContantiDaRegistrare ignora pazienti senza quota contanti impostata", () => {
  const patients = [{ id: 1, nome_calendario: "Mario Rossi", quota_contante_seduta: 0, contante_dovuto: 0 }];
  const events = [{ id: "ev1", data: "2026-01-05", titolo: "Mario Rossi", descrizione: "R3 fatturare saldato" }];
  assert.equal(computeIncassiContantiDaRegistrare(events, patients).length, 0);
});
test("computeIncassiContantiDaRegistrare ignora note senza il marcatore 'saldato'", () => {
  const patients = [{ id: 1, nome_calendario: "Mario Rossi", quota_contante_seduta: 20, contante_dovuto: 60 }];
  const events = [{ id: "ev1", data: "2026-01-05", titolo: "Mario Rossi", descrizione: "A3 fatturare (deve 60€)" }];
  assert.equal(computeIncassiContantiDaRegistrare(events, patients).length, 0);
});
test("rimuoviMarcatoreSaldato toglie solo il marcatore, preserva il resto della nota", () => {
  assert.equal(rimuoviMarcatoreSaldato("A3 fatturare (deve 60€) saldato"), "A3 fatturare (deve 60€)");
  assert.equal(rimuoviMarcatoreSaldato("A3 fatturare (deve 60€) saldato 30 link zoom"), "A3 fatturare (deve 60€) link zoom");
  assert.equal(rimuoviMarcatoreSaldato("link zoom"), "link zoom");
});
{
  const patient = { nome_calendario: "Mario Rossi", regime_tariffario: "agevolata", ancora_data: "2026-01-01", ancora_valore: 0, soglia_fatturazione: 5, quota_contante_seduta: 20, contante_dovuto: 0 };
  const sedute = (n, inizio = 5) => Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, data: `2026-01-${String(inizio + i * 7).padStart(2, "0")}`, ora: "10:00", titolo: "Mario Rossi", descrizione: "" }));
  // sedute il 5, 12, 19, 26 gennaio e 2, 9, 16 febbraio... uso solo gennaio (4) + altre date
  const eventi = [...sedute(4), { id: "e5", data: "2026-02-02", ora: "10:00", titolo: "Mario Rossi", descrizione: "" }, { id: "e6", data: "2026-02-09", ora: "10:00", titolo: "Mario Rossi", descrizione: "" }];

  test("computeRinumerazione: alla seduta 'fatturare' compare gia' il deve contanti (quota x sedute) e resta sulle successive", () => {
    const piano = computeRinumerazione(patient, eventi, DEFAULT_SETTINGS);
    assert.equal(piano[3].codice, "A4");
    assert.equal(piano[4].codice, "A5 fatturare (deve 100€)");
    assert.equal(piano[5].codice, "A1 (deve 100€)");
  });

  test("computeRinumerazione: caso cumulativo, debito ancora aperto + nuovo ciclo (100 + 100)", () => {
    const piano = computeRinumerazione({ ...patient, contante_dovuto: 100 }, eventi, DEFAULT_SETTINGS);
    assert.equal(piano[0].codice, "A1 (deve 100€)");
    assert.equal(piano[4].codice, "A5 fatturare (deve 200€)");
    assert.equal(piano[5].codice, "A1 (deve 200€)");
  });

  test("computeRinumerazione: nessuna quota (paga tutto in contanti / non paga) -> nessun deve", () => {
    const piano = computeRinumerazione({ ...patient, quota_contante_seduta: 0 }, eventi, DEFAULT_SETTINGS);
    assert.equal(piano[4].codice, "A5 fatturare");
    assert.equal(piano[5].codice, "A1");
  });

  test("computeRinumerazione: nel giorno del saldo 'contanti saldati', prima resta il deve, dopo sparisce", () => {
    // debito 100 saldato il 19/1 (contante_dovuto attuale = 0, dopo l'incasso)
    const piano = computeRinumerazione({ ...patient, contante_dovuto: 0 }, eventi, DEFAULT_SETTINGS, undefined, {
      pagamentiContante: [{ data: "2026-01-19", importo: 100 }],
    });
    assert.equal(piano[0].codice, "A1 (deve 100€)"); // 5/1: prima del saldo
    assert.equal(piano[1].codice, "A2 (deve 100€)");
    assert.equal(piano[2].codice, "A3 (contanti saldati 100€)"); // 19/1: giorno del saldo
    assert.equal(piano[3].codice, "A4"); // dopo: nessuna scritta
    assert.equal(piano[4].codice, "A5 fatturare (deve 100€)"); // nuovo ciclo: solo la quota nuova
  });

  test("computeRinumerazione: saldo parziale, il deve residuo resta dopo il giorno dell'incasso", () => {
    const piano = computeRinumerazione({ ...patient, contante_dovuto: 40 }, eventi, DEFAULT_SETTINGS, undefined, {
      pagamentiContante: [{ data: "2026-01-19", importo: 60 }],
    });
    assert.equal(piano[1].codice, "A2 (deve 100€)");
    assert.equal(piano[2].codice, "A3 (contanti saldati 60€) (deve 40€)");
    assert.equal(piano[3].codice, "A4 (deve 40€)");
  });

  test("incassaContante: un incasso oltre il saldo diventa credito (anticipo), non viene perso", () => {
    assert.equal(incassaContante(0, 100), -100);
    assert.equal(incassaContante(40, 100), -60);
    assert.equal(incassaContante(100, 40), 60);
  });

  test("computeRinumerazione: incasso alla seduta 5 PRIMA della fattura (credito -100) -> 'saldati' e nessun deve dopo", () => {
    // il 2/2 e' la seduta 5: il paziente paga i 100€ quel giorno, la fattura non e' ancora confermata (saldo = -100)
    const piano = computeRinumerazione({ ...patient, contante_dovuto: -100 }, eventi, DEFAULT_SETTINGS, undefined, {
      pagamentiContante: [{ data: "2026-02-02", importo: 100 }],
    });
    assert.equal(piano[3].codice, "A4");
    assert.equal(piano[4].codice, "A5 fatturare (contanti saldati 100€)");
    assert.equal(piano[5].codice, "A1");
  });

  test("computeRinumerazione: incasso qualche giorno dopo la seduta 5 -> il deve resta su 5 e sparisce dalla successiva", () => {
    const piano = computeRinumerazione({ ...patient, contante_dovuto: -100 }, eventi, DEFAULT_SETTINGS, undefined, {
      pagamentiContante: [{ data: "2026-02-05", importo: 100 }],
    });
    assert.equal(piano[4].codice, "A5 fatturare (deve 100€)");
    assert.equal(piano[5].codice, "A1");
  });

  test("computeRinumerazione: un incasso precedente all'ancora non altera le note", () => {
    const piano = computeRinumerazione(patient, eventi, DEFAULT_SETTINGS, undefined, { pagamentiContante: [{ data: "2025-12-01", importo: 50 }] });
    assert.equal(piano[0].codice, "A1");
  });
}
test("accumulaContante somma la quota per il numero di sedute fatturate", () => {
  assert.equal(accumulaContante(0, 10, 5), 50);
  assert.equal(accumulaContante(50, 10, 5), 100);
  assert.equal(accumulaContante(100, 0, 5), 100);
});

// --- Prenotazioni online (link "Prenotazioni online dr. Brasini") ---
test("parseBookingInfo estrae nome ed email dalla descrizione HTML di Google", () => {
  const info = parseBookingInfo("<b>Prenotato da</b>\nJessica Di Tommaso\njessica@example.com");
  assert.equal(info.nome, "Jessica Di Tommaso");
  assert.equal(info.email, "jessica@example.com");
});
test("parseBookingInfo torna nome/email nulli se la descrizione non ha il formato atteso", () => {
  assert.deepEqual(parseBookingInfo("nota libera qualsiasi"), { nome: null, email: null });
  assert.deepEqual(parseBookingInfo(""), { nome: null, email: null });
});

test("matchBookingToPatient trova un match forte su nome+cognome combacianti", () => {
  const patients = [
    { id: 1, nome: "Chiara", cognome: "Casali", email: "" },
    { id: 2, nome: "Chiara", cognome: "Conte", email: "" },
  ];
  const r = matchBookingToPatient("Chiara Casali", null, patients);
  assert.equal(r.patient.id, 1);
  assert.equal(r.confidence, "forte");
});
test("matchBookingToPatient preferisce l'email quando combacia in modo univoco", () => {
  const patients = [
    { id: 1, nome: "Chiara", cognome: "Casali", email: "vecchia@example.com" },
  ];
  const r = matchBookingToPatient("Nome Diverso Del Tutto", "vecchia@example.com", patients);
  assert.equal(r.patient.id, 1);
  assert.equal(r.confidence, "forte");
});
test("matchBookingToPatient non sceglie da solo se due pazienti condividono lo stesso nome (ambiguo)", () => {
  const patients = [
    { id: 1, nome: "Francesco", cognome: "Neri", email: "" },
    { id: 2, nome: "Francesco", cognome: "Bruni", email: "" },
  ];
  const r = matchBookingToPatient("Francesco", null, patients);
  assert.equal(r.patient, null);
  assert.equal(r.confidence, "ambiguo");
  assert.equal(r.candidati.length, 2);
});
test("matchBookingToPatient torna nessun candidato per un nome che non compare in anagrafica", () => {
  const patients = [{ id: 1, nome: "Chiara", cognome: "Casali", email: "" }];
  const r = matchBookingToPatient("Adriano De Marco", null, patients);
  assert.equal(r.patient, null);
  assert.equal(r.confidence, null);
});

test("matchPatientToGoogleContact trova un match forte su nome+cognome combacianti", () => {
  const contatti = [
    { nome: "Chiara Casali", email: [], telefoni: [] },
    { nome: "Chiara Conte", email: [], telefoni: [] },
  ];
  const r = matchPatientToGoogleContact({ nome: "Chiara", cognome: "Casali", email: "" }, contatti);
  assert.equal(r.contact.nome, "Chiara Casali");
  assert.equal(r.confidence, "forte");
});
test("matchPatientToGoogleContact preferisce l'email quando combacia in modo univoco", () => {
  const contatti = [{ nome: "Nome Diverso Del Tutto", email: ["vecchia@example.com"], telefoni: [] }];
  const r = matchPatientToGoogleContact({ nome: "Chiara", cognome: "Casali", email: "vecchia@example.com" }, contatti);
  assert.equal(r.contact.nome, "Nome Diverso Del Tutto");
  assert.equal(r.confidence, "forte");
});
test("matchPatientToGoogleContact non sceglie da solo con più candidati con lo stesso nome (ambiguo)", () => {
  const contatti = [
    { nome: "Francesco Neri", email: [], telefoni: [] },
    { nome: "Francesco Bruni", email: [], telefoni: [] },
  ];
  const r = matchPatientToGoogleContact({ nome: "Francesco", cognome: "", email: "" }, contatti);
  assert.equal(r.contact, null);
  assert.equal(r.confidence, "ambiguo");
});
test("matchPatientToGoogleContact torna nessun candidato se il nome non compare nei contatti", () => {
  const contatti = [{ nome: "Chiara Casali", email: [], telefoni: [] }];
  const r = matchPatientToGoogleContact({ nome: "Adriano", cognome: "De Marco", email: "" }, contatti);
  assert.equal(r.contact, null);
  assert.equal(r.confidence, null);
});

test("computePrenotazioniPreview classifica correttamente pronte/in attesa/ambigue/nuove", () => {
  const patients = [
    { id: 1, nome: "Chiara", cognome: "Casali", nome_calendario: "Chiara C.", email: "" }, // pronta
    { id: 2, nome: "Giulia", cognome: "Verde", nome_calendario: "", email: "" }, // in attesa (nome_calendario vuoto)
  ];
  const events = [
    { id: "e1", data: "2026-10-08", ora: "11:30", titolo: "Prenotazioni online dr. Brasini (Chiara Casali)", descrizione: "<b>Prenotato da</b>\nChiara Casali\nc@example.com", colorId: "3" },
    { id: "e2", data: "2026-10-09", ora: "10:00", titolo: "Prenotazioni online dr. Brasini (Giulia Verde)", descrizione: "<b>Prenotato da</b>\nGiulia Verde\ng@example.com", colorId: "3" },
    { id: "e3", data: "2026-10-10", ora: "09:00", titolo: "Prenotazioni online dr. Brasini (Nuovo Utente)", descrizione: "<b>Prenotato da</b>\nNuovo Utente\nn@example.com", colorId: "3" },
    { id: "e4", data: "2026-10-11", ora: "09:00", titolo: "Appuntamento normale, non una prenotazione", descrizione: "", colorId: null },
  ];
  const { pronte, inAttesa, ambigue, nuove } = computePrenotazioniPreview(events, patients);
  assert.equal(pronte.length, 1);
  assert.equal(pronte[0].eventId, "e1");
  assert.equal(inAttesa.length, 1);
  assert.equal(inAttesa[0].eventId, "e2");
  assert.equal(ambigue.length, 0);
  assert.equal(nuove.length, 1);
  assert.equal(nuove[0].eventId, "e3");
});

// --- Chiusure/indisponibilità e slittamento delle occorrenze future ---
test("occorrenzeFuture scala in avanti di una settimana quando incontra una chiusura", () => {
  const slot = { weekday: 1, time_of_day: "15:00:00", interval_days: 14, anchor_date: "2026-10-05" };
  const closures = [{ weekday: 1, time_of_day: "15:00:00", closure_date: "2026-10-05" }];
  const date = occorrenzeFuture(slot, closures, 60, "2026-10-01");
  assert.equal(date[0], "2026-10-12"); // slitta di 7gg invece di saltare al giro dopo
  assert.equal(date[1], "2026-10-26"); // il ritmo quindicinale riparte dalla nuova data
});
test("occorrenzeFuture con alternanza_fissa ignora del tutto le chiusure", () => {
  const slot = { weekday: 1, time_of_day: "15:00:00", interval_days: 14, anchor_date: "2026-10-05", alternanza_fissa: true };
  const closures = [{ weekday: 1, time_of_day: "15:00:00", closure_date: "2026-10-05" }];
  const date = occorrenzeFuture(slot, closures, 30, "2026-10-01");
  assert.equal(date[0], "2026-10-05"); // resta sulla data originale, nessuno slittamento
});
test("occorrenzeFuture: due pazienti alternati sulla stessa fascia restano ordinati dopo una pausa lunga", () => {
  // Coppia quindicinale sfalsata di una settimana sulla stessa fascia:
  // Paziente A l'ultimo lunedì utile prima di una pausa di 3 settimane,
  // Paziente B una settimana prima ancora.
  const slotA = { weekday: 1, time_of_day: "18:00:00", interval_days: 14, anchor_date: "2026-11-30" };
  const slotB = { weekday: 1, time_of_day: "18:00:00", interval_days: 14, anchor_date: "2026-11-23" };
  const closures = ["2026-12-07", "2026-12-14", "2026-12-21"].map((d) => ({ weekday: 1, time_of_day: "18:00:00", closure_date: d }));
  const dateA = occorrenzeFuture(slotA, closures, 90, "2026-11-25");
  const dateB = occorrenzeFuture(slotB, closures, 90, "2026-11-25");
  assert.equal(dateA[0], "2026-11-30"); // A: ultimo turno pre-pausa, non toccato (prima della prima chiusura)
  assert.equal(dateB[0], "2026-12-28"); // B (penultimo turno pre-pausa): riprende sul primo lunedì libero dopo il rientro
  assert.equal(dateA[1], "2027-01-04"); // A (ultimo turno pre-pausa): riprende sul SECONDO lunedì dopo il rientro, come da regola di Maurizio
});

test("rilevaConflittiChiusura ignora un paziente il cui orario rientrerebbe nella finestra ma che quel giorno non ha nessun appuntamento reale (bug reale 2026-09-10)", () => {
  // Caso reale: chiudendo giovedì dalle 14:30, Simone Z. (15:30) aveva già
  // disdetto per conto suo — nessun evento quel giorno — e non deve essere
  // toccato. Solo Livia e Pietro (18:30) hanno davvero un appuntamento nella
  // finestra, e Romano condivide la loro stessa fascia.
  const patientSlots = [
    { active: true, patient_id: 1, weekday: 4, time_of_day: "15:30:00", interval_days: 14, anchor_date: "2026-09-10" }, // Simone Z.
    { active: true, patient_id: 2, weekday: 4, time_of_day: "18:30:00", interval_days: 14, anchor_date: "2026-09-17" }, // Romano
    { active: true, patient_id: 3, weekday: 4, time_of_day: "18:30:00", interval_days: 14, anchor_date: "2026-09-24" }, // Livia e Pietro
  ];
  const patients = [
    { id: 1, nome_calendario: "Simone Z." },
    { id: 2, nome_calendario: "Romano A." },
    { id: 3, nome_calendario: "Livia e Pietro" },
  ];
  const events = [
    // Simone Z.: nessun evento il 24/9 (ha disdetto per conto suo) — solo prima/dopo
    { id: "s1", data: "2026-09-10", ora: "15:30", titolo: "Simone Z." },
    { id: "s2", data: "2026-10-08", ora: "15:30", titolo: "Simone Z." },
    // Romano: nessun evento il 24/9 (non è il suo turno)
    { id: "r1", data: "2026-09-17", ora: "18:30", titolo: "Romano A." },
    { id: "r2", data: "2026-10-01", ora: "18:30", titolo: "Romano A." },
    // Livia e Pietro: appuntamento reale il 24/9, dentro la finestra chiusa
    { id: "l1", data: "2026-09-24", ora: "18:30", titolo: "Livia e Pietro" },
  ];
  const conflitti = rilevaConflittiChiusura(patientSlots, patients, events, {
    dataInizio: "2026-09-24", oraInizio: "14:30", dataFine: "2026-09-24", oraFine: null, note: null,
  });
  assert.equal(conflitti.length, 1);
  assert.equal(conflitti[0].patientId, 3);
  assert.equal(conflitti[0].closure_date, "2026-09-24");
  assert.equal(conflitti[0].time_of_day, "18:30:00");
});
test("rilevaConflittiChiusura ignora un evento reale fuori dall'orario richiesto (prima di oraInizio)", () => {
  const patientSlots = [{ active: true, patient_id: 1, weekday: 4, time_of_day: "12:00:00", interval_days: 14, anchor_date: "2026-09-10" }];
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const events = [{ id: "e1", data: "2026-09-24", ora: "12:00", titolo: "Mario R." }];
  const conflitti = rilevaConflittiChiusura(patientSlots, patients, events, {
    dataInizio: "2026-09-24", oraInizio: "14:30", dataFine: "2026-09-24", oraFine: null, note: null,
  });
  assert.equal(conflitti.length, 0);
});
test("rilevaConflittiChiusura: paziente senza patient_slot (fuori schema/consulenza) non genera conflitti", () => {
  const patientSlots = [];
  const patients = [{ id: 1, nome_calendario: "Chiara C." }];
  const events = [{ id: "e1", data: "2026-09-24", ora: "16:00", titolo: "Chiara C." }];
  const conflitti = rilevaConflittiChiusura(patientSlots, patients, events, {
    dataInizio: "2026-09-24", oraInizio: "14:30", dataFine: "2026-09-24", oraFine: null, note: null,
  });
  assert.equal(conflitti.length, 0);
});

test("computeImpattoChiusura propone la cancellazione solo per gli eventi 'da confermare', segnala gli altri", () => {
  const patientSlots = [
    { active: true, patient_id: 1, weekday: 1, time_of_day: "15:00:00", interval_days: 14, anchor_date: "2026-10-05" },
    { active: true, patient_id: 2, weekday: 1, time_of_day: "15:00:00", interval_days: 14, anchor_date: "2026-10-05", alternanza_fissa: true },
  ];
  const patients = [
    { id: 1, nome_calendario: "Mario R." },
    { id: 2, nome_calendario: "Anna B." },
  ];
  const closures = [{ weekday: 1, time_of_day: "15:00:00", closure_date: "2026-10-05" }];
  const nuoveChiusure = closures;
  const events = [
    // evento "vecchio" ancora sulla data ora chiusa, mai confermato: da cancellare
    { id: "ev1", data: "2026-10-05", ora: "15:00", titolo: "Mario R.", colorId: "6" },
    // Anna ha alternanza_fissa sulla stessa fascia: esclusa dal ricalcolo a monte, mai auto-cancellato
    { id: "ev2", data: "2026-10-05", ora: "15:00", titolo: "Anna B.", colorId: null },
  ];
  const { daCancellare, daVerificare, alternanzaCoinvolta } = computeImpattoChiusura(
    patientSlots, patients, events, closures, nuoveChiusure, 60, "2026-10-01"
  );
  assert.equal(daCancellare.length, 1);
  assert.equal(daCancellare[0].eventId, "ev1");
  assert.equal(daVerificare.length, 0); // Anna ha alternanza_fissa: esclusa dal ricalcolo, segnalata a parte
  assert.equal(alternanzaCoinvolta.length, 1);
  assert.equal(alternanzaCoinvolta[0].patientId, 2);
});

test("computeImpattoChiusura non tocca MAI uno slot la cui fascia non è tra le chiusure appena proposte (bug reale 2026-09-10)", () => {
  // Bug reale: chiudendo un solo giorno/fascia (martedì 15:00), la prima
  // versione ricontrollava TUTTI gli slot attivi, non solo quello coinvolto
  // — un paziente su una fascia completamente diversa (mercoledì 18:00) con
  // uno scarto storico preesistente tra anchor_date e il calendario reale
  // (niente a che vedere con questa chiusura) veniva proposto per errore in
  // cancellazione.
  const patientSlots = [
    { active: true, patient_id: 1, weekday: 2, time_of_day: "15:00:00", interval_days: 14, anchor_date: "2026-10-06" }, // il paziente coinvolto dalla chiusura
    { active: true, patient_id: 2, weekday: 3, time_of_day: "18:00:00", interval_days: 7, anchor_date: "2026-01-01" }, // slot estraneo, con anchor_date lontano/sfasato
  ];
  const patients = [
    { id: 1, nome_calendario: "Mario R." },
    { id: 2, nome_calendario: "Estraneo E." },
  ];
  const closures = [{ weekday: 2, time_of_day: "15:00:00", closure_date: "2026-10-06" }];
  const nuoveChiusure = closures;
  const events = [
    { id: "ev1", data: "2026-10-06", ora: "15:00", titolo: "Mario R.", colorId: "6" },
    // Evento reale dello slot estraneo, su una data che il ricalcolo puro da anchor_date="2026-01-01" non riprodurrebbe mai identica
    { id: "ev2", data: "2026-10-07", ora: "18:00", titolo: "Estraneo E.", colorId: "6" },
  ];
  const { daCancellare } = computeImpattoChiusura(patientSlots, patients, events, closures, nuoveChiusure, 60, "2026-10-01");
  assert.equal(daCancellare.length, 1);
  assert.equal(daCancellare[0].eventId, "ev1"); // solo lo slot davvero coinvolto dalla chiusura, mai "ev2"
});

// --- modifica/eliminazione di una chiusura già registrata ---
test("chiusuraDentroFinestra: date intere, ore assenti = nessun limite", () => {
  const f = { dataInizio: "2026-12-24", oraInizio: null, dataFine: "2027-01-06", oraFine: null };
  assert.equal(chiusuraDentroFinestra({ closure_date: "2026-12-24", time_of_day: "08:00:00" }, f), true);
  assert.equal(chiusuraDentroFinestra({ closure_date: "2027-01-06", time_of_day: "20:00:00" }, f), true);
  assert.equal(chiusuraDentroFinestra({ closure_date: "2026-12-23", time_of_day: "15:00:00" }, f), false);
  assert.equal(chiusuraDentroFinestra({ closure_date: "2027-01-07", time_of_day: "15:00:00" }, f), false);
});
test("chiusuraDentroFinestra: ora inizio inclusa, ora fine esclusa", () => {
  const f = { dataInizio: "2026-10-05", oraInizio: "14:30", dataFine: "2026-10-05", oraFine: "18:00" };
  assert.equal(chiusuraDentroFinestra({ closure_date: "2026-10-05", time_of_day: "14:30:00" }, f), true);
  assert.equal(chiusuraDentroFinestra({ closure_date: "2026-10-05", time_of_day: "14:00:00" }, f), false);
  assert.equal(chiusuraDentroFinestra({ closure_date: "2026-10-05", time_of_day: "18:00:00" }, f), false);
});
test("calcolaRigheChiusuraModificata: accorciando la finestra le righe fuori vengono rimosse e quelle dentro restano anche senza evento reale", () => {
  const vecchie = [
    { weekday: 1, time_of_day: "15:00:00", closure_date: "2026-12-28" },
    { weekday: 1, time_of_day: "15:00:00", closure_date: "2027-01-04" },
  ];
  // nuova finestra più corta: il 4/1 esce; il 28/12 non ha più un evento reale (cancellato dalla chiusura stessa) ma deve restare
  const finestra = { dataInizio: "2026-12-24", oraInizio: null, dataFine: "2026-12-31", oraFine: null };
  const { tenute, rimosse, aggiunte } = calcolaRigheChiusuraModificata(vecchie, [], finestra);
  assert.deepEqual(tenute.map((r) => r.closure_date), ["2026-12-28"]);
  assert.deepEqual(rimosse.map((r) => r.closure_date), ["2027-01-04"]);
  assert.equal(aggiunte.length, 0);
});
test("calcolaRigheChiusuraModificata: allungando la finestra si aggiungono solo i conflitti non già coperti", () => {
  const vecchie = [{ weekday: 1, time_of_day: "15:00:00", closure_date: "2026-12-28" }];
  const conflitti = [
    { weekday: 1, time_of_day: "15:00:00", closure_date: "2026-12-28" }, // già coperto
    { weekday: 1, time_of_day: "15:00:00", closure_date: "2027-01-11" }, // nuovo
  ];
  const finestra = { dataInizio: "2026-12-24", oraInizio: null, dataFine: "2027-01-15", oraFine: null };
  const { tenute, rimosse, aggiunte } = calcolaRigheChiusuraModificata(vecchie, conflitti, finestra);
  assert.equal(tenute.length, 1);
  assert.equal(rimosse.length, 0);
  assert.deepEqual(aggiunte.map((r) => r.closure_date), ["2027-01-11"]);
});
test("calcolaRigheChiusuraModificata: senza finestra (eliminazione) rimuove tutto", () => {
  const vecchie = [
    { weekday: 1, time_of_day: "15:00:00", closure_date: "2026-12-28" },
    { weekday: 3, time_of_day: "18:00:00", closure_date: "2026-12-30" },
  ];
  const { tenute, rimosse, aggiunte } = calcolaRigheChiusuraModificata(vecchie, [], null);
  assert.equal(tenute.length, 0);
  assert.equal(rimosse.length, 2);
  assert.equal(aggiunte.length, 0);
});
test("titoloChiusura e notaDaTitoloChiusura sono uno l'inverso dell'altro", () => {
  assert.equal(titoloChiusura("ferie natalizie"), "Indisponibile — ferie natalizie");
  assert.equal(titoloChiusura(null), "Indisponibile");
  assert.equal(notaDaTitoloChiusura("Indisponibile — ferie natalizie"), "ferie natalizie");
  assert.equal(notaDaTitoloChiusura("Indisponibile"), null);
  assert.equal(notaDaTitoloChiusura("Indisponibile per lavori"), undefined); // non creato dall'app
  assert.equal(notaDaTitoloChiusura("Mario R."), undefined);
});

// --- computeRiprenotazioniPendenti ---
test("computeRiprenotazioniPendenti propone una disdetta senza email di riprenotazione già mandata", () => {
  const cancellazioni = [{ patient_id: 1, original_date: "2026-09-10", billing_status: "not_charged", created_at: "2026-09-10T10:00:00Z" }];
  const patients = [{ id: 1, nome_calendario: "Mario R.", email: "mario@example.com" }];
  const r = computeRiprenotazioniPendenti(cancellazioni, patients, []);
  assert.equal(r.length, 1);
  assert.equal(r[0].patientId, 1);
});
test("computeRiprenotazioniPendenti esclude chi ha già ricevuto l'email dopo quella disdetta", () => {
  const cancellazioni = [{ patient_id: 1, original_date: "2026-09-10", billing_status: "not_charged", created_at: "2026-09-10T10:00:00Z" }];
  const patients = [{ id: 1, nome_calendario: "Mario R.", email: "mario@example.com" }];
  const emailLog = [{ patient_id: 1, created_at: "2026-09-10T11:00:00Z" }];
  const r = computeRiprenotazioniPendenti(cancellazioni, patients, emailLog);
  assert.equal(r.length, 0);
});
test("computeRiprenotazioniPendenti ripropone una NUOVA disdetta anche se una email precedente era già stata mandata", () => {
  const cancellazioni = [
    { patient_id: 1, original_date: "2026-09-01", billing_status: "not_charged", created_at: "2026-09-01T10:00:00Z" },
    { patient_id: 1, original_date: "2026-09-10", billing_status: "not_charged", created_at: "2026-09-10T10:00:00Z" },
  ];
  const patients = [{ id: 1, nome_calendario: "Mario R.", email: "mario@example.com" }];
  const emailLog = [{ patient_id: 1, created_at: "2026-09-01T11:00:00Z" }]; // mandata dopo la prima disdetta, non dopo la seconda
  const r = computeRiprenotazioniPendenti(cancellazioni, patients, emailLog);
  assert.equal(r.length, 1);
  assert.equal(r[0].data, "2026-09-10");
});
test("computeRiprenotazioniPendenti ignora pazienti senza email", () => {
  const cancellazioni = [{ patient_id: 1, original_date: "2026-09-10", billing_status: "not_charged", created_at: "2026-09-10T10:00:00Z" }];
  const patients = [{ id: 1, nome_calendario: "Mario R.", email: null }];
  const r = computeRiprenotazioniPendenti(cancellazioni, patients, []);
  assert.equal(r.length, 0);
});

// --- computeConflittiPrenotazioni (regola: un solo appuntamento ogni 14 giorni) ---
{
  const patients = [
    { id: 1, nome_calendario: "Mario Rossi" }, // su richiesta (nessuno slot attivo)
    { id: 2, nome_calendario: "Luca Bianchi" }, // slot fisso attivo
  ];
  const slots = [{ patient_id: 2, active: true }];
  const ev = (data, titolo = "Mario Rossi", extra = {}) => ({ data, ora: "10:00", titolo, ...extra });
  const riga = (eventId, data, patientId = 1) => ({ eventId, data, ora: "10:00", patientId });

  test("computeConflittiPrenotazioni: una prenotazione a meno di 14 giorni da un appuntamento esistente è in conflitto (anche passato)", () => {
    const events = [ev("2026-10-10")]; // appuntamento già presente (già passato: oggi = 1/11)
    // 13 giorni dopo -> conflitto; 14 giorni dopo -> ok; 5 giorni PRIMA -> conflitto
    const c = computeConflittiPrenotazioni([riga("a", "2026-10-23"), riga("b", "2026-10-24"), riga("c", "2026-10-05")], events, patients, slots, { oggi: "2026-11-01" });
    assert.deepEqual(Object.keys(c).sort(), ["a", "c"]);
    assert.deepEqual(c.a, [{ data: "2026-10-10", ora: "10:00", tipo: "appuntamento" }]);
  });

  test("computeConflittiPrenotazioni: paziente libero, un solo appuntamento futuro alla volta (anche oltre i 14 giorni)", () => {
    // ha già un appuntamento futuro il 10/10: una prenotazione il 24/10 (14 gg dopo) è comunque la seconda
    const c = computeConflittiPrenotazioni([riga("a", "2026-10-24")], [ev("2026-10-10")], patients, slots, { oggi: "2026-10-01" });
    assert.equal(c.a[0].unaSola, true);
    assert.equal(c.a[0].data, "2026-10-10");
    // due prenotazioni lontane fra loro: resta la prima
    const d = computeConflittiPrenotazioni([riga("p1", "2026-10-10"), riga("p2", "2026-11-10")], [], patients, slots, { oggi: "2026-10-01" });
    assert.deepEqual(Object.keys(d), ["p2"]);
    assert.equal(d.p2[0].tipo, "prenotazione");
    assert.equal(d.p2[0].unaSola, true);
    // dopo l'appuntamento (passato) la prenotazione torna possibile
    assert.deepEqual(computeConflittiPrenotazioni([riga("q", "2026-10-24")], [ev("2026-10-10")], patients, slots, { oggi: "2026-10-15" }), {});
  });

  test("computeConflittiPrenotazioni: tre prenotazioni in una settimana -> resta la prima, le altre in conflitto", () => {
    const c = computeConflittiPrenotazioni([riga("x3", "2026-10-15"), riga("x1", "2026-10-12"), riga("x2", "2026-10-13")], [], patients, slots);
    assert.deepEqual(Object.keys(c).sort(), ["x2", "x3"]);
    assert.equal(c.x2[0].tipo, "prenotazione");
    assert.equal(c.x1, undefined);
  });

  test("computeConflittiPrenotazioni: pazienti con slot fisso attivo sono esclusi; eventi di altri pazienti e con nota 'disdetto' non contano", () => {
    const events = [ev("2026-10-10", "Luca Bianchi"), ev("2026-10-09", "Mario Rossi", { descrizione: "disdetto" })];
    const c = computeConflittiPrenotazioni([riga("f", "2026-10-11", 2), riga("g", "2026-10-11", 1)], events, patients, slots);
    assert.deepEqual(c, {}); // f: slot fisso; g: l'unico evento di Mario e' disdetto, quello di Luca non e' suo
  });

  // Luca: quindicinale, lunedì 5/10, 19/10, 2/11...
  const slotQuindicinale = [{ patient_id: 2, active: true, weekday: 1, time_of_day: "10:00", interval_days: 14, anchor_date: "2026-10-05" }];
  const evL = (data, extra = {}) => ev(data, "Luca Bianchi", extra);

  test("computeConflittiPrenotazioni: slot fisso, seduta disdetta -> una prenotazione a recupero e' ok, la seconda no", () => {
    const events = [evL("2026-10-05"), evL("2026-10-19", { descrizione: "disdetto" }), evL("2026-11-02")];
    const c = computeConflittiPrenotazioni([riga("r1", "2026-10-21", 2), riga("r2", "2026-10-23", 2)], events, patients, slotQuindicinale);
    assert.equal(c.r1, undefined);
    assert.deepEqual(Object.keys(c), ["r2"]);
    assert.equal(c.r2[0].cadenza, 14);
  });

  test("computeConflittiPrenotazioni: slot fisso, nessuna disdetta -> la prenotazione e' una seduta in piu' (conflitto)", () => {
    const events = [evL("2026-10-05"), evL("2026-10-19"), evL("2026-11-02")];
    const c = computeConflittiPrenotazioni([riga("x", "2026-10-21", 2), riga("y", "2026-10-12", 2)], events, patients, slotQuindicinale);
    assert.deepEqual(Object.keys(c).sort(), ["x", "y"]);
  });

  test("computeConflittiPrenotazioni: slot fisso, il recupero puo' anche anticipare la seduta disdetta", () => {
    const events = [evL("2026-10-05"), evL("2026-10-19", { descrizione: "disdetto" }), evL("2026-11-02")];
    const c = computeConflittiPrenotazioni([riga("p", "2026-10-13", 2)], events, patients, slotQuindicinale);
    assert.deepEqual(c, {});
  });

  test("computeConflittiPrenotazioni: slot fisso, un recupero troppo a ridosso dell'appuntamento in agenda e' inutile (buco)", () => {
    const slotDom = [{ patient_id: 2, active: true, weekday: 0, time_of_day: "10:00", interval_days: 14, anchor_date: "2026-09-20" }];
    const events = [evL("2026-09-20"), evL("2026-10-04", { descrizione: "disdetto" }), evL("2026-10-18"), evL("2026-11-01")];
    const conf = (data) => computeConflittiPrenotazioni([riga("v", data, 2)], events, patients, slotDom).v;
    assert.equal(conf("2026-10-16")[0].troppoVicina, 6); // 2 giorni dal 18/10: no
    assert.ok(conf("2026-10-13")); // 5 giorni: no
    assert.equal(conf("2026-10-12"), undefined); // 6 giorni: ok
    assert.equal(conf("2026-10-08"), undefined); // 10 giorni: ok
  });

  test("computeConflittiPrenotazioni: slot fisso, orizzonte massimo — oltre l'ultimo appuntamento in calendario e' bloccata, anche se la seduta sembrerebbe libera", () => {
    // calendario popolato fino al 2/11 (l'ultimo, disdetto, conta comunque: e' ancora nello schema)
    const events = [evL("2026-10-05"), evL("2026-10-19"), evL("2026-11-02", { descrizione: "disdetto" })];
    const c = computeConflittiPrenotazioni([riga("lontana", "2026-12-14", 2), riga("subito", "2026-11-09", 2), riga("ok", "2026-10-30", 2)], events, patients, slotQuindicinale);
    assert.equal(c.lontana[0].oltreOrizzonte, true);
    assert.equal(c.lontana[0].data, "2026-11-02");
    assert.equal(c.subito[0].oltreOrizzonte, true);
    assert.equal(c.ok, undefined); // recupero della seduta disdetta del 2/11, prima dell'orizzonte
  });

  test("computeConflittiPrenotazioni: slot fisso, l'orizzonte non si applica ai pazienti senza slot ne' con calendario vuoto", () => {
    assert.deepEqual(computeConflittiPrenotazioni([riga("m", "2027-03-01", 1)], [], patients, slotQuindicinale), {});
  });

  test("computeConflittiPrenotazioni: fasce riservate — un giorno/orario dello schema fisso non ancora popolato non e' prenotabile da chi e' libero", () => {
    // Luca: quindicinale lunedì 10:00 (5/10, 19/10, 2/11, 16/11...), calendario popolato fino al 2/11.
    const events = [evL("2026-10-05"), evL("2026-10-19"), evL("2026-11-02")];
    const oggi = "2026-10-01";
    const conf = (data, ora = "10:00", pid = 1) => computeConflittiPrenotazioni([{ eventId: "z", data, ora, patientId: pid }], events, patients, slotQuindicinale, { oggi }).z;
    assert.equal(conf("2026-11-16")[0].riservato, true); // lunedì di Luca oltre il 2/11: non ancora popolato
    assert.equal(conf("2026-11-16", "10:30")[0].riservato, true); // orario sovrapposto (<60 min)
    assert.equal(conf("2026-11-09"), undefined); // lunedì della settimana "libera" del ciclo quindicinale: davvero libero
    assert.equal(conf("2026-11-17"), undefined); // altro giorno della settimana
    assert.equal(conf("2026-11-16", "15:00"), undefined); // altro orario
    assert.equal(conf("2026-10-19"), undefined); // gia' popolato (evento di Luca a calendario)
    // vale anche per chi non e' ancora abbinato a un paziente
    assert.equal(conf("2026-11-16", "10:00", null)[0].riservato, true);
  });

  test("computeConflittiPrenotazioni: fasce riservate — uno slot senza alcun evento a calendario e' riservato per tutte le date future dello schema", () => {
    const c = computeConflittiPrenotazioni([{ eventId: "z", data: "2026-10-19", ora: "10:00", patientId: 1 }], [], patients, slotQuindicinale, { oggi: "2026-10-01" });
    assert.equal(c.z[0].riservato, true);
  });

  test("computeConflittiPrenotazioni: una prenotazione gia' rinominata (titolo del paziente) conta come appuntamento esistente, non come prenotazione da riconciliare", () => {
    const events = [ev("2026-10-14", "Prenotazioni online dr. Brasini"), ev("2026-10-20", "Mario Rossi")];
    // la prima e' una prenotazione grezza (non conta come esistente), la seconda e' un appuntamento vero a 6 gg
    const c = computeConflittiPrenotazioni([riga("n", "2026-10-14")], events, patients, slots);
    assert.deepEqual(c.n, [{ data: "2026-10-20", ora: "10:00", tipo: "appuntamento" }]);
  });
}

// --- computeStatisticheDisdette ---
{
  const patients = [
    { id: 1, nome_calendario: "Mario Rossi" },
    { id: 2, nome_calendario: "Luca Bianchi" },
  ];
  const slots = [{ patient_id: 1, active: true }, { patient_id: 2, active: false }];
  const ev = (data, titolo = "Mario Rossi") => ({ data, ora: "10:00", titolo });
  const OGGI = "2026-10-20";

  test("computeStatisticheDisdette: senza disdette registrate non c'è inizio rilevazione", () => {
    const r = computeStatisticheDisdette(patients, slots, [ev("2026-10-01")], [], { oggi: OGGI });
    assert.equal(r.inizio, null);
    assert.equal(r.righe.length, 0);
  });

  test("computeStatisticheDisdette: una buca addebitata (evento + disdetta stessa data) non si conta due volte", () => {
    const events = ["2026-10-06", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"].map((d) => ev(d));
    const canc = [
      { patient_id: 1, original_date: "2026-10-06", billing_status: "not_charged" }, // evento eliminato: assente da events
      { patient_id: 1, original_date: "2026-10-13", billing_status: "charged" }, // evento ancora presente
    ];
    // events contiene anche 10-06 solo per verificare che l'unione non lo raddoppi
    const r = computeStatisticheDisdette(patients, slots, events, canc, { oggi: OGGI });
    const riga = r.righe.find((x) => x.patientId === 1);
    assert.equal(riga.appuntamenti, 5);
    assert.equal(riga.disdette, 2);
    assert.equal(riga.percentuale, 0.4);
    assert.equal(riga.segnalato, true);
  });

  test("computeStatisticheDisdette: sotto il minimo di appuntamenti non segnala mai (1 disdetta su 3)", () => {
    const canc = [{ patient_id: 1, original_date: "2026-10-06", billing_status: "not_charged" }];
    const events = [ev("2026-10-13"), ev("2026-10-20")];
    const riga = computeStatisticheDisdette(patients, slots, events, canc, { oggi: OGGI }).righe[0];
    assert.equal(riga.appuntamenti, 3);
    assert.equal(riga.datiInsufficienti, true);
    assert.equal(riga.segnalato, false);
  });

  test("computeStatisticheDisdette: esclusi slot non attivi, date future e eventi precedenti all'inizio rilevazione", () => {
    const canc = [
      { patient_id: 1, original_date: "2026-10-06", billing_status: "not_charged" },
      { patient_id: 2, original_date: "2026-10-06", billing_status: "not_charged" }, // slot non attivo
      { patient_id: 1, original_date: "2026-11-03", billing_status: "not_charged" }, // futura
    ];
    const events = [ev("2026-09-01"), ev("2026-10-13"), ev("2026-11-10"), ev("2026-10-13", "Luca Bianchi")];
    const r = computeStatisticheDisdette(patients, slots, events, canc, { oggi: OGGI });
    assert.equal(r.righe.length, 1);
    assert.equal(r.righe[0].patientId, 1);
    assert.equal(r.righe[0].appuntamenti, 2); // 10-06 (disdetta) + 10-13
    assert.equal(r.righe[0].disdette, 1);
  });

  test("tempoInZonaRossa: somma i giorni di tutti i periodi (entrate e uscite), il periodo aperto arriva a oggi", () => {
    const pt = (data, a, d) => ({ data, appuntamenti: a, disdette: d });
    // Sopra soglia (>20%) dal 29/10 (2/5=40%); esce il 12/11 (2/10=20%, non oltre);
    // rientra il 26/11 (3/11=27%) e ci resta fino a oggi (30/11).
    const andamento = [
      pt("2026-10-01", 1, 0), pt("2026-10-15", 3, 0), pt("2026-10-22", 4, 1),
      pt("2026-10-29", 5, 2), pt("2026-11-05", 6, 2), pt("2026-11-12", 10, 2),
      pt("2026-11-26", 11, 3),
    ];
    const t = tempoInZonaRossa(andamento, 0.2, 5, "2026-11-30");
    assert.deepEqual(t.periodi, [{ da: "2026-10-29", a: "2026-11-12" }, { da: "2026-11-26", a: null }]);
    assert.equal(t.giorniTotali, 14 + 4); // 29/10->12/11 = 14 gg, 26/11->30/11 = 4 gg
    assert.equal(t.inCorso, true);
    assert.equal(t.primoIngresso, "2026-10-29");
  });
  test("bilancioAlla: 'negli ultimi N giorni' come differenza di cumulati, estremo iniziale incluso", () => {
    // 8 appuntamenti settimanali dal 2026-01-05, disdette al 2° e al 6° (cumulato, un punto per appuntamento)
    const date = ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02", "2026-02-09", "2026-02-16", "2026-02-23"];
    const disdetteIdx = new Set([1, 5]);
    let dis = 0;
    const andamento = date.map((data, i) => {
      if (disdetteIdx.has(i)) dis++;
      return { data, appuntamenti: i + 1, disdette: dis };
    });
    // tutto il periodo
    assert.deepEqual(bilancioAlla(andamento, "2026-02-23", null), { appuntamenti: 8, disdette: 2 });
    assert.deepEqual(bilancioAlla(andamento, "2026-02-23", 182), { appuntamenti: 8, disdette: 2 });
    // ultimi 21 gg: la finestra parte il 2026-02-02 (estremo incluso) -> 4 appuntamenti, 1 disdetta (la 6ª)
    assert.deepEqual(bilancioAlla(andamento, "2026-02-23", 21), { appuntamenti: 4, disdette: 1 });
    // data di fine precedente all'ultimo punto: i punti successivi non contano
    assert.deepEqual(bilancioAlla(andamento, "2026-01-26", null), { appuntamenti: 4, disdette: 1 });
    // nessun dato
    assert.deepEqual(bilancioAlla([], "2026-07-01", 182), { appuntamenti: 0, disdette: 0 });
  });
  test("tempoInZonaRossa: con un periodo, una vecchia disdetta che esce dalla finestra chiude la zona rossa anche senza nuovi appuntamenti", () => {
    const pt = (data, a, d) => ({ data, appuntamenti: a, disdette: d });
    // 5 appuntamenti a settimana da 09-01, 2 disdette (40%) al 5°; poi nessun nuovo appuntamento
    const andamento = [pt("2026-09-01", 1, 0), pt("2026-09-08", 2, 1), pt("2026-09-15", 3, 1), pt("2026-09-22", 4, 2), pt("2026-09-29", 5, 2)];
    // finestra di 30 gg: al 09-29 e' rosso (2/5). Al 12-01 la finestra parte dal 11-01: nessun appuntamento -> non rosso
    const t = tempoInZonaRossa(andamento, 0.2, 5, "2026-12-01", 30);
    assert.equal(t.inCorso, false);
    assert.equal(t.periodi[0].da, "2026-09-29");
    assert.equal(t.periodi[0].a, "2026-12-01");
  });
  test("tempoInZonaRossa: uscito e mai rientrato conserva lo storico (inCorso false); mai rosso o sotto il minimo -> null", () => {
    const pt = (data, a, d) => ({ data, appuntamenti: a, disdette: d });
    const uscito = [pt("2026-10-29", 5, 2), pt("2026-11-12", 10, 2)];
    const t = tempoInZonaRossa(uscito, 0.2, 5, "2026-12-01");
    assert.equal(t.inCorso, false);
    assert.equal(t.giorniTotali, 14);
    // 1/4 = 25% ma sotto il minimo di 5 appuntamenti: non è mai rosso
    assert.equal(tempoInZonaRossa([pt("2026-10-22", 4, 1)], 0.2, 5, "2026-12-01"), null);
    assert.equal(tempoInZonaRossa([pt("2026-10-29", 5, 0)], 0.2, 5, "2026-12-01"), null);
  });

  test("computeStatisticheDisdette: tendenza recente e andamento mensile", () => {
    const events = ["2026-09-09", "2026-09-16", "2026-09-23", "2026-10-06", "2026-10-13", "2026-10-15"].map((d) => ev(d));
    const canc = [
      { patient_id: 1, original_date: "2026-09-09", billing_status: "not_charged" },
      { patient_id: 1, original_date: "2026-10-13", billing_status: "not_charged" },
    ];
    const r = computeStatisticheDisdette(patients, slots, events, canc, { oggi: OGGI, giorniPeriodo: 14 });
    const riga = r.righe[0];
    assert.equal(riga.appuntamenti, 3); // nel periodo: 10-06, 10-13, 10-15
    assert.equal(riga.disdette, 1);
    // il mensile resta sempre sull'intera rilevazione, indipendente dal periodo
    assert.deepEqual(r.mensile.map((m) => [m.mese, m.appuntamenti, m.disdette]), [["2026-09", 3, 1], ["2026-10", 3, 1]]);
    // periodo null = dall'inizio: tutti e 6 gli appuntamenti
    assert.equal(computeStatisticheDisdette(patients, slots, events, canc, { oggi: OGGI, giorniPeriodo: null }).righe[0].appuntamenti, 6);
  });
}

// --- computePazientiConSalto ---
test("computePazientiConSalto segnala un salto solo se c'è ANCHE una disdetta recente (gap doppio da solo non basta)", () => {
  const oggi = todayISO();
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const slots = [{ patient_id: 1, active: true, interval_days: 7 }];
  const events = [
    { data: addDays(oggi, -10), titolo: "Mario R." },
    { data: addDays(oggi, 4), titolo: "Mario R." },
  ]; // gap = 14 giorni = 2x7
  const cancellazioniRecenti = [{ patient_id: 1, cancelled_at: `${addDays(oggi, -2)}T10:00:00Z` }];
  assert.equal(computePazientiConSalto(patients, slots, events, []).length, 0, "senza disdetta recente non deve segnalare");
  const r = computePazientiConSalto(patients, slots, events, cancellazioniRecenti);
  assert.equal(r.length, 1);
  assert.equal(r[0].tipo, "salto");
  assert.equal(r[0].gapGiorni, 14);
});
test("computePazientiConSalto non segnala nulla se il gap è quello normale, anche con una disdetta recente", () => {
  const oggi = todayISO();
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const slots = [{ patient_id: 1, active: true, interval_days: 7 }];
  const events = [
    { data: addDays(oggi, -3), titolo: "Mario R." },
    { data: addDays(oggi, 4), titolo: "Mario R." },
  ]; // gap = 7 giorni, normale
  const cancellazioniRecenti = [{ patient_id: 1, cancelled_at: `${addDays(oggi, -2)}T10:00:00Z` }];
  const r = computePazientiConSalto(patients, slots, events, cancellazioniRecenti);
  assert.equal(r.length, 0);
});
test("computePazientiConSalto segnala chi ha uno slot attivo, una disdetta recente, e nessun appuntamento futuro", () => {
  const oggi = todayISO();
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const slots = [{ patient_id: 1, active: true, interval_days: 14 }];
  const events = [{ data: addDays(oggi, -5), titolo: "Mario R." }];
  const cancellazioniRecenti = [{ patient_id: 1, cancelled_at: `${addDays(oggi, -1)}T10:00:00Z` }];
  const r = computePazientiConSalto(patients, slots, events, cancellazioniRecenti);
  assert.equal(r.length, 1);
  assert.equal(r[0].tipo, "nessun_futuro");
});
test("computePazientiConSalto ignora una disdetta troppo vecchia (fuori dalla finestra)", () => {
  const oggi = todayISO();
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const slots = [{ patient_id: 1, active: true, interval_days: 7 }];
  const events = [
    { data: addDays(oggi, -10), titolo: "Mario R." },
    { data: addDays(oggi, 4), titolo: "Mario R." },
  ];
  const cancellazioniVecchie = [{ patient_id: 1, cancelled_at: `${addDays(oggi, -90)}T10:00:00Z` }];
  const r = computePazientiConSalto(patients, slots, events, cancellazioniVecchie);
  assert.equal(r.length, 0);
});
test("computePazientiConSalto segnala uno schema libero senza appuntamenti futuri, anche SENZA disdetta recente", () => {
  const oggi = todayISO();
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const events = [{ data: addDays(oggi, -30), titolo: "Mario R." }];
  const r = computePazientiConSalto(patients, [], events, []); // nessuna disdetta, nessuno slot
  assert.equal(r.length, 1);
  assert.equal(r[0].tipo, "schema_libero_senza_data");
});
test("computePazientiConSalto NON segnala uno schema libero che ha comunque una data futura", () => {
  const oggi = todayISO();
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const events = [
    { data: addDays(oggi, -30), titolo: "Mario R." },
    { data: addDays(oggi, 10), titolo: "Mario R." },
  ];
  const r = computePazientiConSalto(patients, [], events, []);
  assert.equal(r.length, 0);
});
test("computePazientiConSalto NON segnala uno schema libero mai visto prima (nessuno storico)", () => {
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const r = computePazientiConSalto(patients, [], [], []);
  assert.equal(r.length, 0);
});

// --- computeOccorrenzeDaGenerare ---
test("computeOccorrenzeDaGenerare propone come 'mancante' una data mai generata prima", () => {
  const slots = [{ patient_id: 1, active: true, weekday: 2, time_of_day: "15:00:00", interval_days: 7, anchor_date: "2026-10-06" }];
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const { mancanti, anomale } = computeOccorrenzeDaGenerare(slots, patients, [], [], new Set(), new Set(), 14, "2026-10-01");
  assert.equal(anomale.length, 0);
  assert.equal(mancanti.length, 1);
  assert.deepEqual(mancanti[0].date, ["2026-10-06", "2026-10-13"]);
});
test("computeOccorrenzeDaGenerare segnala come 'anomala' (mai come mancante) una data gia' generata in passato e ora assente, non skippata (bug reale 2026-09-11)", () => {
  const slots = [{ patient_id: 1, active: true, weekday: 2, time_of_day: "15:00:00", interval_days: 7, anchor_date: "2026-10-06" }];
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const generatedSet = new Set(["1|2026-10-06"]);
  const { mancanti, anomale } = computeOccorrenzeDaGenerare(slots, patients, [], [], new Set(), generatedSet, 14, "2026-10-01");
  assert.equal(anomale.length, 1);
  assert.equal(anomale[0].data, "2026-10-06");
  assert.ok(!mancanti.some((p) => p.date.includes("2026-10-06")));
  assert.deepEqual(mancanti[0].date, ["2026-10-13"]);
});
test("computeOccorrenzeDaGenerare non propone nulla per una data gia' skippata, anche se era stata generata", () => {
  const slots = [{ patient_id: 1, active: true, weekday: 2, time_of_day: "15:00:00", interval_days: 7, anchor_date: "2026-10-06" }];
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const skippedSet = new Set(["1|2026-10-06"]);
  const generatedSet = new Set(["1|2026-10-06"]);
  const { mancanti, anomale } = computeOccorrenzeDaGenerare(slots, patients, [], [], skippedSet, generatedSet, 14, "2026-10-01");
  assert.equal(anomale.length, 0);
  assert.deepEqual(mancanti[0].date, ["2026-10-13"]);
});
test("computeOccorrenzeDaGenerare non propone nulla per una data con un evento reale gia' presente", () => {
  const slots = [{ patient_id: 1, active: true, weekday: 2, time_of_day: "15:00:00", interval_days: 7, anchor_date: "2026-10-06" }];
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const events = [{ data: "2026-10-06", ora: "15:00", titolo: "Mario R.", descrizione: "" }];
  const { mancanti, anomale } = computeOccorrenzeDaGenerare(slots, patients, events, [], new Set(), new Set(), 14, "2026-10-01");
  assert.equal(anomale.length, 0);
  assert.deepEqual(mancanti[0].date, ["2026-10-13"]);
});
test("computeOccorrenzeDaGenerare: slot.durata_minuti ha la precedenza sull'ultimo evento reale (2026-09-22, caso 'riunione 2 ore')", () => {
  const slots = [{ patient_id: 1, active: true, weekday: 2, time_of_day: "15:00:00", interval_days: 7, anchor_date: "2026-10-06", durata_minuti: 120 }];
  const patients = [{ id: 1, nome_calendario: "Riunione Scienziati" }];
  // Un evento reale passato da 60' non deve far scendere la durata sotto i 120' impostati sullo slot.
  const events = [{ data: "2026-09-29", ora: "15:00", titolo: "Riunione Scienziati", descrizione: "", durataMinuti: 60 }];
  const { mancanti } = computeOccorrenzeDaGenerare(slots, patients, events, [], new Set(), new Set(), 14, "2026-10-01");
  assert.equal(mancanti[0].durataMinuti, 120);
});
test("computeOccorrenzeDaGenerare: senza slot.durata_minuti, torna a indovinare dall'ultimo evento reale come prima", () => {
  const slots = [{ patient_id: 1, active: true, weekday: 2, time_of_day: "15:00:00", interval_days: 7, anchor_date: "2026-10-06" }];
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const events = [{ data: "2026-09-29", ora: "15:00", titolo: "Mario R.", descrizione: "", durataMinuti: 90 }];
  const { mancanti } = computeOccorrenzeDaGenerare(slots, patients, events, [], new Set(), new Set(), 14, "2026-10-01");
  assert.equal(mancanti[0].durataMinuti, 90);
});

// --- computeDuplicatiDaRipulire ---
test("computeDuplicatiDaRipulire trova un evento reale ancora presente per una disdetta già registrata (bug reale 2026-09-11)", () => {
  const cancellazioni = [{ patient_id: 1, original_date: "2026-09-15", billing_status: "not_charged" }];
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const events = [{ id: "ev1", data: "2026-09-15", ora: "13:30", titolo: "Mario R.", descrizione: "R3" }];
  const r = computeDuplicatiDaRipulire(events, patients, cancellazioni);
  assert.equal(r.length, 1);
  assert.equal(r[0].eventId, "ev1");
});
test("computeDuplicatiDaRipulire non propone nulla se l'evento è già stato davvero cancellato", () => {
  const cancellazioni = [{ patient_id: 1, original_date: "2026-09-15", billing_status: "not_charged" }];
  const patients = [{ id: 1, nome_calendario: "Mario R." }];
  const r = computeDuplicatiDaRipulire([], patients, cancellazioni);
  assert.equal(r.length, 0);
});

// --- personalizzaTesto / formatDataItaliana (mail merge Comunicazioni) ---
test("personalizzaTesto sostituisce [nome] e [data]", () => {
  assert.equal(
    personalizzaTesto("Gentile [nome], il suo appuntamento del [data] è confermato.", { nome: "Jessica", data: "28 settembre 2026" }),
    "Gentile Jessica, il suo appuntamento del 28 settembre 2026 è confermato."
  );
});
test("personalizzaTesto sostituisce più occorrenze dello stesso segnaposto", () => {
  assert.equal(personalizzaTesto("[nome] [nome]", { nome: "Mario" }), "Mario Mario");
});
test("personalizzaTesto lascia vuoto un segnaposto senza valore, senza sollevare errori", () => {
  assert.equal(personalizzaTesto("Gentile [nome], del [data]", { nome: "Mario" }), "Gentile Mario, del ");
});
test("formatDataItaliana formatta una data ISO in italiano esteso", () => {
  assert.equal(formatDataItaliana("2026-09-28"), "28 settembre 2026");
});

// --- computeGrigliaDisponibilita (pagina Disponibilità) ---
test("computeGrigliaDisponibilita: slot settimanale risulta sempre pieno (0 fasi libere)", () => {
  const r = computeGrigliaDisponibilita([{ weekday: 1, time_of_day: "09:30:00", interval_days: 7, anchor_date: "2026-09-07", nome: "Mario R.", stato: "attivo" }]);
  assert.equal(r.settimanali.length, 1);
  assert.equal(r.settimanali[0].fasiLibere, 0);
});
test("computeGrigliaDisponibilita: quindicinale con un solo paziente ha 1 fase libera su 2", () => {
  const r = computeGrigliaDisponibilita([{ weekday: 2, time_of_day: "10:30:00", interval_days: 14, anchor_date: "2026-09-08", nome: "Anna B.", stato: "attivo" }]);
  assert.equal(r.quindicinaliSingoli.length, 1);
  assert.equal(r.quindicinaliSingoli[0].fasiLibere, 1);
});
test("computeGrigliaDisponibilita: quindicinale con due pazienti alternati sfasati di 7gg è pieno", () => {
  const r = computeGrigliaDisponibilita([
    { weekday: 2, time_of_day: "10:30:00", interval_days: 14, anchor_date: "2026-09-08", nome: "Anna B.", stato: "attivo" },
    { weekday: 2, time_of_day: "10:30:00", interval_days: 14, anchor_date: "2026-09-15", nome: "Bruno C.", stato: "attivo" },
  ]);
  assert.equal(r.quindicinaliPieni.length, 1);
  assert.equal(r.quindicinaliPieni[0].fasiLibere, 0);
  assert.equal(r.quindicinaliPieni[0].conflitto, false);
});
test("computeGrigliaDisponibilita: mensile con due pazienti su fasi diverse lascia 2 settimane su 4 libere", () => {
  const r = computeGrigliaDisponibilita([
    { weekday: 4, time_of_day: "13:30:00", interval_days: 28, anchor_date: "2026-09-24", nome: "Silvia M.", stato: "attivo" },
    { weekday: 4, time_of_day: "13:30:00", interval_days: 28, anchor_date: "2026-10-01", nome: "Jessica M.", stato: "attivo" },
  ]);
  assert.equal(r.mensili.length, 1);
  assert.equal(r.mensili[0].fasiLibere, 2);
});
test("computeGrigliaDisponibilita: due pazienti sulla stessa identica fase segnalano un conflitto", () => {
  const r = computeGrigliaDisponibilita([
    { weekday: 3, time_of_day: "11:30:00", interval_days: 14, anchor_date: "2026-09-09", nome: "X", stato: "attivo" },
    { weekday: 3, time_of_day: "11:30:00", interval_days: 14, anchor_date: "2026-09-23", nome: "Y", stato: "attivo" },
  ]);
  assert.equal(r.quindicinaliPieni[0].conflitto, true);
});
test("computeGrigliaDisponibilita: un quindicinale dentro un ciclo mensile occupa 2 fasi, non 1 (bug reale Nele e Enzo/Giovedì 13:30)", () => {
  const r = computeGrigliaDisponibilita([
    { weekday: 4, time_of_day: "13:30:00", interval_days: 28, anchor_date: "2026-09-24", nome: "Silvia M.", stato: "attivo" },
    { weekday: 4, time_of_day: "13:30:00", interval_days: 28, anchor_date: "2026-10-01", nome: "Jessica M.", stato: "attivo" },
    { weekday: 4, time_of_day: "13:30:00", interval_days: 14, anchor_date: "2026-10-08", nome: "Nele e Enzo", stato: "attivo" },
  ]);
  assert.equal(r.mensili.length, 1);
  // Il quindicinale (interval14, ancora 2 settimane dopo Silvia) occupa la
  // stessa fase parity di Silvia due volte ogni 4 settimane: vero conflitto
  // ricorrente con lei, mai con Jessica.
  assert.equal(r.mensili[0].conflitto, true);
  assert.equal(r.mensili[0].conflittiDettaglio.length, 1);
  assert.deepEqual(new Set(r.mensili[0].conflittiDettaglio[0]), new Set(["Silvia M.", "Nele e Enzo"]));
  assert.equal(r.mensili[0].fasiLibere, 1);
});
test("computeGrigliaDisponibilita: quindicinale senza conflitto dentro un ciclo mensile occupa comunque 2 fasi (non sovrastima la disponibilità)", () => {
  const r = computeGrigliaDisponibilita([
    { weekday: 4, time_of_day: "13:30:00", interval_days: 28, anchor_date: "2026-09-24", nome: "Silvia M.", stato: "attivo" },
    { weekday: 4, time_of_day: "13:30:00", interval_days: 14, anchor_date: "2026-10-01", nome: "Quindicinale Q.", stato: "attivo" },
  ]);
  assert.equal(r.mensili.length, 1);
  assert.equal(r.mensili[0].conflitto, false);
  // Prima del fix: 2 fasi libere (contava il quindicinale come 1 sola
  // fase occupata). Reale: il quindicinale occupa 2 fasi su 4, quindi ne
  // resta libera solo 1.
  assert.equal(r.mensili[0].fasiLibere, 1);
});
test("computeGrigliaDisponibilita: sottoSlot — settimanale in entrambe le caselle, quindicinale in una sola, mensili della stessa parità insieme", () => {
  const r = computeGrigliaDisponibilita([
    { weekday: 1, time_of_day: "09:30:00", interval_days: 7, anchor_date: "2026-09-07", nome: "Domizia S.", stato: "attivo" },
    { weekday: 2, time_of_day: "10:30:00", interval_days: 14, anchor_date: "2026-09-08", nome: "Anna B.", stato: "attivo" },
    { weekday: 3, time_of_day: "18:30:00", interval_days: 28, anchor_date: "2026-09-09", nome: "Enrico O.", stato: "attivo" },
    { weekday: 3, time_of_day: "18:30:00", interval_days: 28, anchor_date: "2026-09-23", nome: "Susanna e Simone", stato: "attivo" },
  ]);
  const cella = (orario, g) => r.griglia.find((x) => x.orario === orario).giorni[g].sottoSlot.map((s) => s.pazienti.map((p) => p.nome));
  assert.deepEqual(cella("09:30", 1), [["Domizia S."], ["Domizia S."]]);
  const anna = cella("10:30", 2);
  assert.equal(anna.filter((n) => n.length === 0).length, 1);
  assert.equal(anna.filter((n) => n[0] === "Anna B.").length, 1);
  const mensili = cella("18:30", 3);
  assert.equal(mensili.filter((n) => n.length === 0).length, 1);
  assert.deepEqual(new Set(mensili.find((n) => n.length).sort()), new Set(["Enrico O.", "Susanna e Simone"]));
  // fascia senza nessuno: due caselle vuote
  assert.deepEqual(r.griglia.find((x) => x.orario === "09:30").giorni[2].sottoSlot.map((s) => s.pazienti.length), [0, 0]);
});
test("computeGrigliaDisponibilita: sottoSlot — un mensile da solo occupa la casella ma resta 'parziale'; due mensili nella stessa parità la riempiono", () => {
  const solo = computeGrigliaDisponibilita([{ weekday: 2, time_of_day: "18:30:00", interval_days: 28, anchor_date: "2026-09-08", nome: "Paolo S.", stato: "attivo" }]);
  const s = solo.griglia.find((x) => x.orario === "18:30").giorni[2].sottoSlot;
  assert.deepEqual(s.map((x) => x.parziale).sort(), [false, true]);
  assert.equal(s.find((x) => x.parziale).pazienti[0].nome, "Paolo S.");
  const due = computeGrigliaDisponibilita([
    { weekday: 2, time_of_day: "18:30:00", interval_days: 28, anchor_date: "2026-09-08", nome: "Paolo S.", stato: "attivo" },
    { weekday: 2, time_of_day: "18:30:00", interval_days: 28, anchor_date: "2026-09-22", nome: "Enrico O.", stato: "attivo" },
  ]);
  assert.ok(due.griglia.find((x) => x.orario === "18:30").giorni[2].sottoSlot.every((x) => !x.parziale));
});
test("computeGrigliaDisponibilita: la griglia copre sempre 08:30–20:30 ogni mezz'ora, anche le fasce senza alcun paziente (richiesta di Maurizio 2026-09-22)", () => {
  const r = computeGrigliaDisponibilita([{ weekday: 2, time_of_day: "11:00:00", interval_days: 7, anchor_date: "2026-09-08", nome: "Mario R.", stato: "attivo" }]);
  assert.equal(r.griglia.length, 25); // 08:30..20:30 ogni 30' = 25 righe
  assert.equal(r.griglia[0].orario, "08:30");
  assert.equal(r.griglia[r.griglia.length - 1].orario, "20:30");
  const rigaVuota = r.griglia.find((x) => x.orario === "08:30");
  assert.equal(rigaVuota.giorni[2].stato, "libero");
});
test("computeGrigliaDisponibilita: un orario reale fuori dal range canonico (es. non allineato alla mezz'ora) non sparisce dalla griglia", () => {
  const r = computeGrigliaDisponibilita([{ weekday: 2, time_of_day: "21:00:00", interval_days: 7, anchor_date: "2026-09-08", nome: "Mario R.", stato: "attivo" }]);
  assert.ok(r.griglia.some((x) => x.orario === "21:00"));
});
test("computeGrigliaDisponibilita: la griglia settimanale segna 'libero' una fascia senza pazienti", () => {
  const r = computeGrigliaDisponibilita([{ weekday: 1, time_of_day: "09:30:00", interval_days: 7, anchor_date: "2026-09-07", nome: "Mario R.", stato: "attivo" }]);
  const riga = r.griglia.find((x) => x.orario === "09:30");
  assert.equal(riga.giorni[1].stato, "pieno");
  assert.equal(riga.giorni[3].stato, "libero");
});
// --- Modello unificato "G-Cal" (2026-09-22): ogni slot ha una durata reale
// (durata_minuti, assegnata a tutti gli slot esistenti — 60' di default,
// diversa solo per i casi reali come "Riunione Scienziati", 120') e occupa
// ogni fascia da 30' che attraversa davvero. Stessa regola per tutti,
// nessun caso speciale — a differenza dei due tentativi precedenti.
test("computeGrigliaDisponibilita: un paziente normale da 60' occupa la propria fascia E la successiva", () => {
  const r = computeGrigliaDisponibilita([
    { weekday: 1, time_of_day: "09:30:00", interval_days: 7, anchor_date: "2026-09-07", nome: "Mario R.", stato: "attivo", durata_minuti: 60 },
  ]);
  const nomiIn = (orario) => r.griglia.find((x) => x.orario === orario).giorni[1].pazienti.map((p) => p.nome);
  assert.deepEqual(nomiIn("09:30"), ["Mario R."]);
  assert.deepEqual(nomiIn("10:00"), ["Mario R."]);
  assert.deepEqual(nomiIn("09:00"), []);
  assert.deepEqual(nomiIn("10:30"), []);
});
test("computeGrigliaDisponibilita: una riunione di 2 ore occupa esattamente le 4 fasce da 30' che attraversa, non una di più né di meno (caso reale 'Riunione Scienziati')", () => {
  const r = computeGrigliaDisponibilita([
    { weekday: 3, time_of_day: "09:00:00", interval_days: 14, anchor_date: "2026-09-09", nome: "Riunione Scienziati", stato: "non_fatturato", durata_minuti: 120 },
  ]);
  const nomiIn = (orario) => r.griglia.find((x) => x.orario === orario).giorni[3].pazienti.map((p) => p.nome);
  for (const orario of ["09:00", "09:30", "10:00", "10:30"]) assert.deepEqual(nomiIn(orario), ["Riunione Scienziati"]);
  assert.deepEqual(nomiIn("08:30"), []);
  assert.deepEqual(nomiIn("11:00"), []);
});
test("computeGrigliaDisponibilita: due pazienti da 60' offset di mezz'ora sullo STESSO giorno reale sono un vero conflitto", () => {
  const r = computeGrigliaDisponibilita([
    { weekday: 2, time_of_day: "09:00:00", interval_days: 7, anchor_date: "2026-09-08", nome: "Mario R.", stato: "attivo", durata_minuti: 60 },
    { weekday: 2, time_of_day: "09:30:00", interval_days: 7, anchor_date: "2026-09-08", nome: "Anna B.", stato: "attivo", durata_minuti: 60 },
  ]);
  const riga930 = r.griglia.find((x) => x.orario === "09:30").giorni[2];
  assert.deepEqual(riga930.pazienti.map((p) => p.nome).sort(), ["Anna B.", "Mario R."]);
  assert.equal(riga930.conflitto, true);
});
test("computeGrigliaDisponibilita: stesso offset di mezz'ora ma quindicinali su settimane alternate — nessun conflitto reale (mai lo stesso giorno)", () => {
  const r = computeGrigliaDisponibilita([
    { weekday: 2, time_of_day: "09:00:00", interval_days: 14, anchor_date: "2026-09-08", nome: "Mario R.", stato: "attivo", durata_minuti: 60 },
    { weekday: 2, time_of_day: "09:30:00", interval_days: 14, anchor_date: "2026-09-15", nome: "Anna B.", stato: "attivo", durata_minuti: 60 },
  ]);
  const riga930 = r.griglia.find((x) => x.orario === "09:30").giorni[2];
  assert.equal(riga930.conflitto, false);
});
test("slotsInConflitto: due slot da 60' offset di mezz'ora, stesso giorno reale, sono in conflitto", () => {
  const a = { weekday: 2, time_of_day: "09:00:00", interval_days: 7, anchor_date: "2026-09-08", durata_minuti: 60 };
  const b = { weekday: 2, time_of_day: "09:30:00", interval_days: 7, anchor_date: "2026-09-08", durata_minuti: 60 };
  assert.equal(slotsInConflitto(a, b), true);
});
test("slotsInConflitto: due slot da 60' consecutivi (9-10 e 10-11) NON sono in conflitto — si toccano, non si sovrappongono", () => {
  const a = { weekday: 2, time_of_day: "09:00:00", interval_days: 7, anchor_date: "2026-09-08", durata_minuti: 60 };
  const b = { weekday: 2, time_of_day: "10:00:00", interval_days: 7, anchor_date: "2026-09-08", durata_minuti: 60 };
  assert.equal(slotsInConflitto(a, b), false);
});
test("slotsInConflitto: uno slot di 2 ore (riunione) e un nuovo slot da 60' che inizia mezz'ora dopo, stesso giorno reale — conflitto", () => {
  const riunione = { weekday: 3, time_of_day: "09:00:00", interval_days: 14, anchor_date: "2026-09-09", durata_minuti: 120 };
  const nuovo = { weekday: 3, time_of_day: "09:30:00", interval_days: 14, anchor_date: "2026-09-09", durata_minuti: 60 };
  assert.equal(slotsInConflitto(riunione, nuovo), true);
});
test("slotsInConflitto: senza durata_minuti (rete di sicurezza), il default 60' vale per entrambi come prima", () => {
  const a = { weekday: 2, time_of_day: "10:30:00", interval_days: 14, anchor_date: "2026-09-08" };
  const b = { weekday: 2, time_of_day: "10:30:00", interval_days: 14, anchor_date: "2026-09-15" }; // alternati, mai lo stesso giorno
  assert.equal(slotsInConflitto(a, b), false);
  const c = { weekday: 2, time_of_day: "10:30:00", interval_days: 14, anchor_date: "2026-09-08" };
  assert.equal(slotsInConflitto(a, c), true);
});

console.log(`\n${passed} test superati.`);
if (process.exitCode) {
  console.error("Alcuni test sono falliti.");
} else {
  console.log("Tutti i test sono passati.");
}
