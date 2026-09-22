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
  return res.json();
}

const patients = await supaGet("patients?nome_calendario=ilike.*Francesco+Mer*&select=id,nome_calendario,quota_contante_seduta,contante_dovuto,stato,ancora_data");
console.log("Paziente:", JSON.stringify(patients, null, 2));
if (patients[0]) {
  const pagamenti = await supaGet(`contante_pagamenti?patient_id=eq.${patients[0].id}&select=*&order=data.desc`);
  console.log("Storico incassi:", JSON.stringify(pagamenti, null, 2));
}
