// Prende il risultato di riconciliazione-ferragosto.mjs (ultimo codice
// NP/NF/pc prima del 31/8 per paziente) e verifica se, applicando la stessa
// logica di conteggio a blocchi di 5 usata da computeRinumerazione (reset a
// 0 dopo "fatturare"), sommata agli eventi reali avvenuti tra quella data e
// ancora_data, si ottiene esattamente l'ancora_valore oggi in DB. Sola
// lettura: stampa solo il confronto, non scrive nulla.

import fs from "node:fs";
import { fetchGoogleCalendarEvents } from "../src/lib/googleCalendar.js";
import { matchPatientForEvent } from "../src/lib/logic.js";

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

function estraiNumero(codice) {
  if (!codice) return null;
  const m1 = codice.match(/(?:np|npa|nf|pc)\s*(\d+)/i);
  if (m1) return parseInt(m1[1], 10);
  const m2 = codice.match(/(\d+)\s*(?:np|npa|nf|pc)/i);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

async function main() {
  const righe = JSON.parse(fs.readFileSync(new URL("./riconciliazione-risultato.json", import.meta.url), "utf8"));
  const patients = await supaGet("patients?select=*&order=id");
  const byId = Object.fromEntries(patients.map((p) => [p.id, p]));
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");
  const events = await fetchGoogleCalendarEvents(refreshToken, "2026-06-01", "2026-10-15");
  const oggi = "2026-09-08";

  const problemi = [];
  const soglia = 5;

  for (const r of righe) {
    const p = byId[r.id];
    if (!p) continue;
    const N = estraiNumero(r.ultimo_live_codice);
    if (N === null || !r.ultimo_live_data) { problemi.push({ ...r, motivo: "codice pre-31/8 non estraibile o assente, verificare a mano" }); continue; }
    const sogliaPaziente = p.soglia_fatturazione || soglia;
    // Il blocco si chiude (reset a 0) sia quando il numero ha gia' raggiunto
    // la soglia (l'ipotesi che si sia sempre fatturato/pagato appena
    // raggiunto il blocco, come fa il sistema nuovo), sia quando il testo lo
    // dice esplicitamente.
    const eraFatturare = N >= sogliaPaziente || /fattur|pagat/i.test(r.ultimo_live_codice);

    // eventi reali per questo paziente tra il codice pre-31/8 (escluso) e ancora_data (escluso)
    const intermedi = events
      .filter((e) => e.data > r.ultimo_live_data && e.data < p.ancora_data && matchPatientForEvent(e.titolo, [p]))
      .sort((a, b) => (a.data < b.data ? -1 : 1));

    let contatore = eraFatturare ? 0 : N;
    for (const ev of intermedi) {
      contatore += 1;
      if (contatore >= sogliaPaziente) contatore = 0;
    }
    const ancoraAttesa = contatore;

    if (ancoraAttesa !== p.ancora_valore) {
      problemi.push({
        id: p.id, nome: p.fatturare_a || p.nome_calendario, nome_calendario: p.nome_calendario,
        ultimo_codice_preAgosto: r.ultimo_live_codice, ultimo_data_preAgosto: r.ultimo_live_data, N, eraFatturare,
        eventiIntermedi: intermedi.map((e) => `${e.data}:"${e.titolo}"`),
        ancora_valore_atteso: ancoraAttesa, ancora_valore_db: p.ancora_valore, ancora_data_db: p.ancora_data,
      });
    }
  }

  console.log(`Pazienti con ancora_valore NON spiegato da (codice pre-31/8 + eventi intermedi): ${problemi.length} / ${righe.length}\n`);
  for (const pr of problemi) {
    console.log(`[${pr.id}] ${pr.nome} (${pr.nome_calendario})`);
    if (pr.motivo) { console.log(`   ${pr.motivo}`); console.log(""); continue; }
    console.log(`   ultimo codice pre-31/8: "${pr.ultimo_codice_preAgosto}" (${pr.ultimo_data_preAgosto}) -> N=${pr.N}${pr.eraFatturare ? " [marcato fatturare/pagato: assunto reset a 0]" : ""}`);
    console.log(`   eventi intermedi (tra quella data e ancora_data=${pr.ancora_data_db}): ${pr.eventiIntermedi.length ? pr.eventiIntermedi.join(", ") : "nessuno"}`);
    console.log(`   ancora_valore ATTESO (ricostruito): ${pr.ancora_valore_atteso}  vs  DB attuale: ${pr.ancora_valore_db}`);
    console.log("");
  }
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
