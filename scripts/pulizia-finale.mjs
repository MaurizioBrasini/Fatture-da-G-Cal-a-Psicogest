// Esecuzione: cancella i 15 residui duplicati (tenendo l'evento nuovo),
// scrive patients.note per i 4 pazienti con nota extra trovata. Poi il
// chiamante rilancia trova-doppioni.mjs per la verifica finale.

import fs from "node:fs";
import { deleteGoogleCalendarEvent } from "../src/lib/googleCalendar.js";

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
async function supaPatch(pathAndQuery, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH fallita: ${await res.text()}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DA_CANCELLARE = [
  ["Teresa F.", "6pgjip1pcgoj2b9ocdh6cb9k6opm4bb2ckr36b9hckp38dpkc9h3icr2co_20260908T073000Z"],
  ["Emanuela P.", "6gsm2db360q3gb9oc8qmab9kcopj0b9o64r68b9mclhjacpkc9j34eb26k_20260908T083000Z"],
  ["Chiara P.", "ccs62chocksj2b9kc8oj2b9k70p6abb16grjeb9o6di3gc1h60rmcp1j6k_20260908T113000Z"],
  ["Alessia e Pierluigi", "c5hjacpiccs6ab9kccsm4b9kc9gjeb9o6gr62b9pcgs66cj1ckoj2p1i6g_20260908T153000Z"],
  ["Susanna e Simone", "c4r36p9iccp3gbb170p64b9kc9hjcbb26gpj4b9n6cqm2phmccq66pj664_20260908T163000Z"],
  ["Luana S.", "3gk3kfm6e8fi9bolil3e4poemh_20260910T103000Z"],
  ["Simone Z.", "7e0thhhccc4tsercccvk33b9om_20260910T133000Z"],
  ["Antonietta F. (test residuo)", "6gqm2oj364qm2bb4cdgj4b9kclj32bb169gj8b9j74s34dj6cdi34phj74"],
  ["Giulia e Daniel", "4lntkf40fatkd9s0o2u90pcaeq_20260914T113000Z"],
  ["Francesca F.", "64p3cd1p6ph3eb9k71j68b9kccp3ibb260p32b9mcgom8phocksjad3160_20260915T093000Z"],
  ["Caterina e Filippo", "c5gj0dj66pij6b9h6himcb9k6go3cbb16dgj0bb4c4oj0p336koj4p9jc4_20260915T143000Z"],
  ["Bice C.", "2niuhgi9in4rd18movkvgsrkqg_20260916T083000Z"],
  ["Alessia e Salvatore", "dfot1i3rqjoensftcjla9j8cul_20260916T153000Z"],
  ["Ida B.", "6gs34e9pc8rm8b9k74qm2b9k6thmabb26dijeb9gcgs32p1mckp6ccpi6k_20260917T083000Z"],
  ["Daniela e Massimiliano", "jqohpf8l7552e2go58ci05me5a_20260923T103000Z"],
];

const NOTE_DA_SCRIVERE = [
  { id: 395, nome: "Giuseppe L.", note: "+ 20 dati 250 = deve 430€" },
  { id: 258, nome: "Simone Z.", note: "deve 25 sedute" },
  { id: 56, nome: "Jacopo C.", note: "(+ contanti?)" },
  { id: 178, nome: "Silvia P.", note: "deve 100€" },
];

async function main() {
  const [{ refresh_token: refreshToken }] = await supaGet("google_tokens?select=refresh_token");

  console.log("=== Cancellazione dei 15 residui duplicati ===");
  for (const [nome, id] of DA_CANCELLARE) {
    try {
      await deleteGoogleCalendarEvent(refreshToken, id);
      console.log(`  [OK] ${nome}: ${id}`);
    } catch (e) {
      console.log(`  [ERRORE] ${nome}: ${e.message}`);
    }
    await sleep(150);
  }

  console.log("\n=== Scrittura patients.note ===");
  for (const p of NOTE_DA_SCRIVERE) {
    try {
      await supaPatch(`patients?id=eq.${p.id}`, { note: p.note });
      console.log(`  [OK] ${p.nome}: note = "${p.note}"`);
    } catch (e) {
      console.log(`  [ERRORE] ${p.nome}: ${e.message}`);
    }
  }

  console.log("\nFatto.");
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
