// Confronta i dati di origine (CALENDARIO PAZIENTI MENSILE.xlsx, Foglio2 —
// "numero inc." = numero seduta atteso per quell'appuntamento al momento
// della migrazione) con lo stato attuale di patients (ancora_valore/data) e
// con la nota REALMENTE scritta sull'evento calendario di quel giorno.
// Sola lettura.

import fs from "node:fs";
import { fetchGoogleCalendarEvents } from "../src/lib/googleCalendar.js";
import { matchPatientForEvent, normalizeName, letteraCodice, formatCodice, computeRinumerazione, DEFAULT_SETTINGS } from "../src/lib/logic.js";

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

function parseCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) { if (c === '"') { if (line[i+1]==='"'){cur+='"';i++;} else inQ=false; } else cur+=c; }
    else { if (c === '"') inQ=true; else if (c===",") { out.push(cur); cur=""; } else cur+=c; }
  }
  out.push(cur);
  return out;
}

function ddmmyyToIso(s) {
  const [d, m, y] = s.split("/");
  return `20${y}-${m}-${d}`;
}

// Riduce un nome ad una "base" per il match: prima parola (nome) + iniziale
// del resto (cognome/abbreviazione), tutto normalizzato.
function baseMatch(nome) {
  const norm = normalizeName(nome).replace(/\./g, "");
  const parole = norm.split(" ").filter(Boolean);
  return parole;
}

function trovaPaziente(nomeFoglio, patients) {
  // 1. match esatto su nome_calendario
  const norm = normalizeName(nomeFoglio);
  let m = patients.find((p) => normalizeName(p.nome_calendario || "") === norm);
  if (m) return m;
  // 2. match esatto su nome_calendario ignorando i punti
  const normNoDot = norm.replace(/\./g, "");
  m = patients.find((p) => normalizeName(p.nome_calendario || "").replace(/\./g, "") === normNoDot);
  if (m) return m;
  // 3. match "debole": stessa prima parola (nome/nome coppia) + iniziale cognome coincide
  const parole = baseMatch(nomeFoglio);
  const primaParola = parole[0];
  const candidati = patients.filter((p) => {
    const pn = baseMatch(p.nome_calendario || "");
    return pn[0] === primaParola;
  });
  if (candidati.length === 1) return candidati[0];
  // 4. per le coppie "X e Y": confronta le due prime parole (nome1, "e", nome2)
  if (parole.includes("E")) {
    const idx = parole.indexOf("E");
    const nome1 = parole[0], nome2 = parole[idx + 1];
    const candidati2 = patients.filter((p) => {
      const pn = baseMatch(p.nome_calendario || "");
      return pn[0] === nome1 && pn.includes(nome2);
    });
    if (candidati2.length === 1) return candidati2[0];
  }
  return null;
}

async function main() {
  const csvPath = process.argv[2];
  const text = fs.readFileSync(csvPath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const rows = lines.slice(1).map(parseCsvLine).map(([paziente, giorno, orario, freq, numeroInc, stato]) => ({
    paziente, giorno: ddmmyyToIso(giorno), orario, freq, numeroInc: parseInt(numeroInc, 10), stato,
  }));

  const patients = await supaGet("patients?select=*&order=id");
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const settingsRows = await supaGet("settings?select=*");
  const settings = { ...DEFAULT_SETTINGS, ...(settingsRows[0] || {}) };
  const events = await fetchGoogleCalendarEvents(refreshToken, "2026-06-01", "2026-11-30");

  console.log(`Righe Foglio2: ${rows.length}\n`);

  const problemi = [];
  for (const r of rows) {
    const p = trovaPaziente(r.paziente, patients);
    if (!p) {
      console.log(`[NON TROVATO] "${r.paziente}" (${r.giorno}) — nessun paziente corrispondente in patients`);
      continue;
    }
    const ancoraAtteso = r.numeroInc - 1;
    const lettera = letteraCodice(p);
    const soglia = p.soglia_fatturazione || 5;
    const fatturare = lettera !== "S" && r.numeroInc >= soglia;
    const codiceAtteso = formatCodice(lettera, r.numeroInc, fatturare, p.contante_dovuto);

    // trova l'evento calendario reale per questo paziente in quel giorno
    const evento = events.find((e) => e.data === r.giorno && matchPatientForEvent(e.titolo, [p]));
    const codiceReale = evento ? evento.descrizione : "(evento non trovato)";

    // cosa dice il motore Rinumera DAL VIVO (adesso) per quello stesso evento
    const piano = computeRinumerazione(p, events, settings);
    const pianoRiga = piano.find((x) => x.data === r.giorno);
    const codiceLive = pianoRiga ? pianoRiga.codice : "(nessun piano per questa data)";

    const ancoraValoreOk = p.ancora_valore === ancoraAtteso;
    const codiceOkVsFonte = codiceReale === codiceAtteso;
    const codiceOkVsLive = codiceReale === codiceLive;

    if (!ancoraValoreOk || !codiceOkVsFonte || !codiceOkVsLive) {
      problemi.push({
        paziente: r.paziente, id: p.id, nome_calendario: p.nome_calendario, giorno: r.giorno, numeroInc: r.numeroInc,
        ancora_valore_db: p.ancora_valore, ancora_valore_atteso: ancoraAtteso, ancoraValoreOk,
        ancora_data_db: p.ancora_data,
        codice_reale: codiceReale, codice_atteso_fonte: codiceAtteso, codiceOkVsFonte,
        codice_live: codiceLive, codiceOkVsLive,
      });
    }
  }

  console.log("=== DISALLINEAMENTI rispetto al Foglio2 (fonte originale migrazione) e/o al motore live ===\n");
  for (const pr of problemi) {
    console.log(`[${pr.id}] ${pr.paziente} (${pr.nome_calendario}) — giorno ${pr.giorno}, numero atteso da fonte ${pr.numeroInc}`);
    console.log(`   ancora_valore: DB=${pr.ancora_valore_db} atteso=${pr.ancora_valore_atteso} ${pr.ancoraValoreOk ? "OK" : "<<< DIVERSO"}  (ancora_data DB=${pr.ancora_data_db})`);
    console.log(`   codice su calendario (reale): "${pr.codice_reale}"`);
    console.log(`   codice atteso da FONTE originale: "${pr.codice_atteso_fonte}" ${pr.codiceOkVsFonte ? "OK" : "<<< DIVERSO"}`);
    console.log(`   codice atteso da Rinumera LIVE (adesso): "${pr.codice_live}" ${pr.codiceOkVsLive ? "OK (combacia col reale)" : "<<< DIVERSO DAL REALE"}`);
    console.log("");
  }
  console.log(`Totale righe con disallineamento: ${problemi.length} / ${rows.length}`);
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
