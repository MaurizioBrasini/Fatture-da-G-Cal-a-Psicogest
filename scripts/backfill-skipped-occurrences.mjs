// One-off, da lanciare una sola volta dopo il fix in aggiorna-confirm
// (0689823): retroattivamente scrive in skipped_occurrences le disdette
// paziente (cancellations, billing_status=not_charged) registrate PRIMA del
// fix, che quindi non avevano mai ricevuto la riga. Sola scrittura
// bookkeeping, idempotente (onConflict ignora se già presente) — non tocca
// calendario, patients, ne' cancellations.

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

async function main() {
  const [cancellazioni, tokenRows] = await Promise.all([
    supaGet("cancellations?select=patient_id,original_date,user_id&billing_status=eq.not_charged"),
    supaGet("google_tokens?select=user_id"),
  ]);
  const userId = tokenRows[0]?.user_id;
  if (!userId) throw new Error("Nessun user_id trovato in google_tokens.");

  const righe = cancellazioni.map((c) => ({
    user_id: c.user_id || userId,
    patient_id: c.patient_id,
    data: c.original_date,
    note: "backfill retroattivo post-fix 0689823",
  }));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/skipped_occurrences?on_conflict=patient_id,data`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify(righe),
  });
  if (!res.ok) throw new Error(`Upsert fallito: ${await res.text()}`);
  const inserite = await res.json();
  console.log(`Righe proposte: ${righe.length}. Effettivamente inserite (nuove): ${inserite.length}.`);
  for (const r of inserite) console.log(`  + patient_id=${r.patient_id} data=${r.data}`);
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
