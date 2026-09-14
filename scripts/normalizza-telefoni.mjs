// Normalizza patients.telefono: rimuove il prefisso "+39" e tutti gli spazi
// dai numeri italiani (es. "+39 348 0050 430" -> "3480050430"). I numeri con
// altro prefisso internazionale (es. "+49...") mantengono il prefisso ma
// perdono comunque gli spazi, per coerenza. Numeri gia' puliti non vengono
// toccati. Dry-run di default, --apply per scrivere.

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

function normalizzaTelefono(raw) {
  const s = (raw || "").trim();
  if (!s) return s;
  if (s.startsWith("+39")) {
    return s.slice(3).replace(/\s+/g, "");
  }
  // altri prefissi internazionali: tolgo solo gli spazi, mantengo il prefisso
  return s.replace(/\s+/g, "");
}

const APPLY = process.argv.includes("--apply");

async function main() {
  const patients = await supaGet("patients?select=id,nome_calendario,fatturare_a,telefono&order=id");
  const daAggiornare = [];

  for (const p of patients) {
    if (!p.telefono) continue;
    const nuovo = normalizzaTelefono(p.telefono);
    if (nuovo !== p.telefono) daAggiornare.push({ p, nuovo });
  }

  console.log(`Pazienti totali: ${patients.length}`);
  console.log(`Telefoni da normalizzare: ${daAggiornare.length}`);
  for (const { p, nuovo } of daAggiornare) {
    console.log(`  [${p.id}] "${p.fatturare_a || p.nome_calendario}": "${p.telefono}" -> "${nuovo}"`);
  }

  if (APPLY) {
    console.log("\nScrittura in corso...");
    for (const { p, nuovo } of daAggiornare) {
      await supaPatch(`patients?id=eq.${p.id}`, { telefono: nuovo });
    }
    console.log(`Fatto: ${daAggiornare.length} numeri aggiornati.`);
  } else {
    console.log("\n(dry-run, passa --apply per scrivere davvero)");
  }
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
