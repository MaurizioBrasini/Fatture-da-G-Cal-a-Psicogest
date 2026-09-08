// Elimina le 2 righe spurie di invoice_history (id 1 e 2), confermate da
// Maurizio: non corrispondono a nessuna fattura reale Psicogest (le uniche
// con onorario esattamente 400,00 per Forcina/Alliata, mentre le fatture
// reali #140/#141 hanno 245,10 e 392,16). Le righe id 3 e 4 (quelle vere)
// restano intatte.

import fs from "node:fs";
const envRaw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const before = await fetch(`${SUPABASE_URL}/rest/v1/invoice_history?select=*&id=in.(1,2)`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).then((r) => r.json());
  console.log("Righe da eliminare (verifica finale):", JSON.stringify(before, null, 2));
  if (before.length !== 2 || before.some((r) => r.onorario !== 400)) {
    console.error("ATTENZIONE: le righe non corrispondono a quanto atteso, mi fermo senza cancellare.");
    process.exit(1);
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/invoice_history?id=in.(1,2)`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: "return=representation" },
  });
  console.log("DELETE status:", res.status);
  console.log(await res.text());
}
main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
