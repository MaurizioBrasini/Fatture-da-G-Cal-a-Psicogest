// Prova in Node della logica pura dello script (senza Google): stub minimo di Utilities.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const codice = fs.readFileSync(new URL("./google-apps-script/prenotazioni-doppie.gs", import.meta.url), "utf8");
const Utilities = {
  formatDate(d, tz, fmt) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(d).map((x) => [x.type, x.value])
    );
    return `${p.year}-${p.month}-${p.day}`;
  },
};
const ctx = vm.createContext({ Utilities, Math, Date, Object, JSON });
vm.runInContext(codice + "\nthis.trova = trovaDaCancellare_;", ctx);
const trova = ctx.trova;

const G = "Prenotazioni online dr. Brasini";
const ev = (id, iso, titolo, email = ["mario@x.it"], extra = {}) => ({ id, titolo, descrizione: "", inizio: new Date(iso), tuttoIlGiorno: false, email, ...extra });
const ids = (r) => Array.from(r, (x) => x.evento.id).sort();

// 1) tre prenotazioni: 1 ott, 10 ott, 20 ott -> B cancellata (9 gg da A), C resta (19 gg da A)
assert.deepEqual(ids(trova([ev("A", "2026-10-01T10:00:00Z", G), ev("B", "2026-10-10T10:00:00Z", G), ev("C", "2026-10-20T10:00:00Z", G)], [])), ["B"]);

// 2) evento reale successivo: la prenotazione precedente (5 gg prima) va cancellata, non quello reale
assert.deepEqual(ids(trova([ev("R", "2026-10-20T10:00:00Z", "Mario Rossi"), ev("P", "2026-10-15T10:00:00Z", G)], [])), ["P"]);

// 3) evento reale passato di 5 giorni: conta
assert.deepEqual(ids(trova([ev("R", "2026-10-10T10:00:00Z", "Mario Rossi"), ev("P", "2026-10-15T10:00:00Z", G)], [])), ["P"]);

// 4) cambio ora legale: 14 giorni di calendario esatti (25 ott 2026 = fine ora legale) NON e' conflitto
assert.deepEqual(ids(trova([ev("R", "2026-10-19T08:00:00Z", "Mario Rossi"), ev("P", "2026-11-02T09:00:00Z", G)], [])), []);
// ...ma 13 giorni si'
assert.deepEqual(ids(trova([ev("R", "2026-10-19T08:00:00Z", "Mario Rossi"), ev("P", "2026-11-01T08:00:00Z", G)], [])), ["P"]);

// 5) evento reale con nota "disdett*" non blocca
assert.deepEqual(ids(trova([ev("R", "2026-10-10T10:00:00Z", "Mario Rossi", ["mario@x.it"], { descrizione: "disdetto" }), ev("P", "2026-10-15T10:00:00Z", G)], [])), []);

// 6) email diverse non si mescolano; evento senza invitati mai toccato; tutto il giorno ignorato
assert.deepEqual(ids(trova([ev("A", "2026-10-01T10:00:00Z", G, ["a@x.it"]), ev("B", "2026-10-03T10:00:00Z", G, ["b@x.it"]), ev("N", "2026-10-02T10:00:00Z", G, [])], [])), []);
assert.deepEqual(ids(trova([ev("A", "2026-10-01T10:00:00Z", G), ev("B", "2026-10-03T10:00:00Z", G, ["mario@x.it"], { tuttoIlGiorno: true })], [])), []);

// 7) un evento NON prenotazione (es. riunione con invitato) non viene mai cancellato, anche se vicino a un altro
assert.deepEqual(ids(trova([ev("M1", "2026-10-01T10:00:00Z", "Riunione"), ev("M2", "2026-10-03T10:00:00Z", "Riunione")], [])), []);

// 8) email esclusa: mai toccata
assert.deepEqual(ids(trova([ev("A", "2026-10-01T10:00:00Z", G), ev("B", "2026-10-03T10:00:00Z", G)], ["mario@x.it"])), []);

console.log("Tutti i controlli della logica dello script sono passati.");
