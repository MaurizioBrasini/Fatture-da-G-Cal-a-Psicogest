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
  saldaContante,
  buildNuovaDescrizione,
  eventiDiPazienteOrdinati,
  computeRinumerazione,
  analizzaNotaPerAudit,
  DEFAULT_SETTINGS,
  parseBookingInfo,
  matchBookingToPatient,
  computePrenotazioniPreview,
  occorrenzeFuture,
  rilevaConflittiChiusura,
  computeImpattoChiusura,
  computeRiprenotazioniPendenti,
  computePazientiConSalto,
  computeOccorrenzeDaGenerare,
  computeDuplicatiDaRipulire,
  formatDataItaliana,
  personalizzaTesto,
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

// --- buildPsicogestAnagraficaRow: export anagrafica per l'import Psicogest ---
test("buildPsicogestAnagraficaRow: valorizza nome/cognome/CF e i default fissi", () => {
  const row = buildPsicogestAnagraficaRow({ nome: "Mario", cognome: "Rossi", codice_fiscale: "RSSMRA80A01H501U", provincia: "RM" });
  assert.equal(row.pazienteNOME, "Mario");
  assert.equal(row.pazienteCOGNOME, "Rossi");
  assert.equal(row.pazienteID, "RSSMRA80A01H501U");
  assert.equal(row.pazienteCF, "RSSMRA80A01H501U");
  assert.equal(row.pazientePRIVATO, "s");
  assert.equal(row.pazienteNAZIONE, "IT");
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
test("accumulaContante somma la quota per il numero di sedute fatturate", () => {
  assert.equal(accumulaContante(0, 10, 5), 50);
  assert.equal(accumulaContante(50, 10, 5), 100);
  assert.equal(accumulaContante(100, 0, 5), 100);
});
test("saldaContante sottrae un incasso, anche parziale, senza andare sotto zero", () => {
  assert.equal(saldaContante(300, 150), 150);
  assert.equal(saldaContante(150, 150), 0);
  assert.equal(saldaContante(50, 150), 0);
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

console.log(`\n${passed} test superati.`);
if (process.exitCode) {
  console.error("Alcuni test sono falliti.");
} else {
  console.log("Tutti i test sono passati.");
}
