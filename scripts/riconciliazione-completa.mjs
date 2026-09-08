// Riconciliazione "lenta ma solida": per ciascun paziente attivo, ricostruisce
// la sequenza REALE di sedute (dal primo codice NP/NF/R/A/S trovato in avanti
// fino ad ancora_data escluso), applicando reset a soglia, usando un matching
// più permissivo per gli eventi vecchi (ante-settembre) che spesso hanno
// un'abbreviazione diversa da nome_calendario attuale — ma senza confondere
// un paziente singolo con una coppia che condivide un nome (bug scoperto:
// "Giuseppe" -> "Giulia e Giuseppe"). Confronta il risultato con
// patients.ancora_valore/ancora_data attuali. Sola lettura.

import fs from "node:fs";
import { fetchGoogleCalendarEvents } from "../src/lib/googleCalendar.js";

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

function norm(s) {
  return (s || "").toString().trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.,]/g, "").replace(/\s+/g, " ");
}
function isCoppia(nome) { return / E /.test(` ${norm(nome)} `); }

// Matcher permissivo MA che non confonde un singolo con una coppia: se il
// paziente e' una coppia "X e Y", il titolo deve contenere ENTRAMBI i nomi
// (in un ordine o nell'altro); se e' un singolo, il titolo non deve essere
// una coppia (per non prendere "Giuseppe" dentro "Giulia e Giuseppe").
function matchaLargo(titolo, nomeCalendario) {
  const t = norm(titolo);
  const p = norm(nomeCalendario);
  if (!t || !p) return false;
  if (isCoppia(p)) {
    const [n1, , n2] = p.split(" "); // "X E Y" -> n1=X, n2=Y (skip "E")
    return t.includes(n1) && n2 && t.includes(n2);
  }
  if (isCoppia(t)) return false; // il paziente e' singolo, il titolo e' una coppia: non prendere
  const primaParolaPaziente = p.split(" ")[0];
  const primaParolaTitolo = t.split(" ")[0];
  return primaParolaTitolo === primaParolaPaziente;
}

function estraiNumero(codice) {
  if (!codice) return null;
  const m1 = codice.match(/(?:np|npa|nf|pc)\s*(\d+)/i);
  if (m1) return parseInt(m1[1], 10);
  const m2 = codice.match(/(\d+)\s*(?:np|npa|nf|pc)/i);
  if (m2) return parseInt(m2[1], 10);
  const m3 = codice.match(/^\s*([ras])\s*(\d+)/i);
  if (m3) return parseInt(m3[2], 10);
  return null;
}

async function main() {
  const [patientsAll, slotsAttivi, { refresh_token: refreshToken }] = await Promise.all([
    supaGet("patients?select=*&order=id"),
    supaGet("patient_slots?select=patient_id&active=eq.true"),
    supaGet("google_tokens?select=refresh_token").then((r) => r[0]),
  ]);
  const idAttivi = new Set(slotsAttivi.map((s) => s.patient_id));
  const patients = patientsAll.filter((p) => idAttivi.has(p.id));

  const SOGLIA_DATA = "2026-08-31";
  const events = await fetchGoogleCalendarEvents(refreshToken, "2026-01-01", "2026-10-15");
  const soglia = 5;

  const righe = [];
  for (const p of patients) {
    const sogliaPaziente = p.soglia_fatturazione || soglia;
    const matchEventi = events
      .filter((e) => e.data < p.ancora_data && matchaLargo(e.titolo, p.nome_calendario))
      .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

    // Punto di partenza: l'ULTIMO evento con un codice estraibile prima del
    // 31/8 (la fonte che Maurizio ha usato per compilare l'app) — non il
    // primo in assoluto, per non risalire a rumore di mesi/anni fa.
    const candidatiPartenza = matchEventi.filter((e) => e.data <= SOGLIA_DATA && estraiNumero(e.descrizione) !== null);
    if (!candidatiPartenza.length) {
      righe.push({ id: p.id, nome: p.fatturare_a || p.nome_calendario, nome_calendario: p.nome_calendario,
        esito: "nessun codice storico trovato prima del 31/8 (matching largo)", ancora_valore_db: p.ancora_valore, ancora_data_db: p.ancora_data });
      continue;
    }
    const partenza = candidatiPartenza[candidatiPartenza.length - 1];
    let N = estraiNumero(partenza.descrizione);
    if (N >= sogliaPaziente || /fattur|pagat/i.test(partenza.descrizione)) N = 0; // reset al blocco di partenza stesso, se gia' a soglia

    const successivi = matchEventi.filter((e) => e.data > partenza.data);
    for (const ev of successivi) {
      N += 1;
      if (N >= sogliaPaziente) N = 0;
    }

    righe.push({
      id: p.id, nome: p.fatturare_a || p.nome_calendario, nome_calendario: p.nome_calendario,
      partenza_data: partenza.data, partenza_codice: partenza.descrizione,
      eventi_successivi: successivi.map((e) => `${e.data}:"${e.descrizione}"`),
      ancora_valore_ricostruito: N, ancora_valore_db: p.ancora_valore, ancora_data_db: p.ancora_data,
      coincide: N === p.ancora_valore,
    });
  }

  const daRivedere = righe.filter((r) => r.coincide === false || r.esito);
  console.log(`Pazienti totali: ${righe.length}`);
  console.log(`Coincidono: ${righe.filter((r) => r.coincide === true).length}`);
  console.log(`Da rivedere (non coincidono o nessun codice trovato): ${daRivedere.length}\n`);

  for (const r of daRivedere) {
    console.log(`[${r.id}] ${r.nome} (${r.nome_calendario})`);
    if (r.esito) { console.log(`   ${r.esito} — DB: ancora_valore=${r.ancora_valore_db} ancora_data=${r.ancora_data_db}`); console.log(""); continue; }
    console.log(`   Punto di partenza: ${r.partenza_data} "${r.partenza_codice}"`);
    console.log(`   Eventi successivi fino ad ancora_data: ${r.eventi_successivi.length ? r.eventi_successivi.join(", ") : "nessuno"}`);
    console.log(`   ancora_valore ricostruito: ${r.ancora_valore_ricostruito}  vs  DB: ${r.ancora_valore_db}  (ancora_data DB: ${r.ancora_data_db})`);
    console.log("");
  }

  fs.writeFileSync(new URL("./riconciliazione-completa-risultato.json", import.meta.url), JSON.stringify(righe, null, 2));
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
