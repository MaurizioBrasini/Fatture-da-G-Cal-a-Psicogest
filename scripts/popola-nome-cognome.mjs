// Da lanciare DOPO che Maurizio ha eseguito schema_addendum5.sql su Supabase
// (aggiunge patients.nome/patients.cognome). Popola i due campi separando
// "fatturare_a" (formato attuale "COGNOME Nome") SOLO quando è composto da
// esattamente due parole — i casi ambigui (cognomi/nomi composti da più
// parole, es. "DE LUCA MARIA") restano vuoti, da completare a mano in app,
// come richiesto esplicitamente da Maurizio invece di indovinare.

import fs from "node:fs";

const envRaw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
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

function titleCase(w) {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

const APPLY = process.argv.includes("--apply");

async function main() {
  const patients = await supaGet("patients?select=id,nome,cognome,fatturare_a,nome_calendario&order=id");
  let popolati = 0;
  const ambigui = [];

  for (const p of patients) {
    if (p.nome || p.cognome) continue; // già valorizzato, non sovrascrivo
    const parole = (p.fatturare_a || "").trim().split(/\s+/).filter(Boolean);
    if (parole.length !== 2) {
      if (p.fatturare_a) ambigui.push(`id=${p.id} nome_calendario="${p.nome_calendario}" fatturare_a="${p.fatturare_a}"`);
      continue;
    }
    const cognome = titleCase(parole[0]);
    const nome = titleCase(parole[1]);
    console.log(`id=${p.id} "${p.fatturare_a}" -> nome="${nome}" cognome="${cognome}"`);
    if (APPLY) await supaPatch(`patients?id=eq.${p.id}`, { nome, cognome });
    popolati++;
  }

  console.log(`\n${APPLY ? "Scritti" : "Da scrivere (dry-run, passa --apply)"}: ${popolati} pazienti.`);
  if (ambigui.length) {
    console.log(`\nCasi ambigui lasciati vuoti, da completare a mano in app (${ambigui.length}):`);
    ambigui.forEach((l) => console.log("  " + l));
  }
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
