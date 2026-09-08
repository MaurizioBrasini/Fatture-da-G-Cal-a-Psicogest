// Popola patients.codice_fiscale (colonna gia' esistente) usando l'export
// reale Psicogest (Appunti/Settings/psicogest pazienti.xls, gia' dumpato in
// CSV). Scrive SOLO dove codice_fiscale e' vuoto e il match nome+cognome e'
// univoco; i casi ambigui/non trovati restano vuoti, segnalati in output.

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

function normalizeName(s) {
  return (s || "").toString().trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
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

const APPLY = process.argv.includes("--apply");
const csvPath = process.argv[2];

async function main() {
  const text = fs.readFileSync(csvPath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const header = parseCsvLine(lines[0]);
  const idxNome = header.indexOf("Nome");
  const idxCognome = header.indexOf("Cognome");
  const idxCF = header.indexOf("Codice Fiscale");
  const psicogest = lines.slice(1).map(parseCsvLine)
    .map((f) => ({ nome: f[idxNome], cognome: f[idxCognome], cf: f[idxCF] }))
    .filter((r) => r.nome && r.cognome && r.cf);

  // indicizza per "COGNOME NOME" normalizzato -> lista di CF (per scovare ambiguita')
  const indice = new Map();
  for (const r of psicogest) {
    const chiave = normalizeName(`${r.cognome} ${r.nome}`);
    if (!indice.has(chiave)) indice.set(chiave, []);
    indice.get(chiave).push(r.cf);
  }

  const patients = await supaGet("patients?select=id,nome_calendario,fatturare_a,codice_fiscale&order=id");
  const daAggiornare = [];
  const nonTrovati = [];
  const ambigui = [];

  for (const p of patients) {
    if (p.codice_fiscale) continue; // non sovrascrivo mai un CF gia' presente

    if (p.fatturare_a) {
      // Caso normale: fatturare_a e' gia' "COGNOME Nome" completo.
      const chiave = normalizeName(p.fatturare_a);
      const match = indice.get(chiave);
      if (!match) { nonTrovati.push(p); continue; }
      const cfUnici = [...new Set(match)];
      if (cfUnici.length > 1) { ambigui.push({ p, cfUnici }); continue; }
      daAggiornare.push({ p, cf: cfUnici[0], via: "fatturare_a" });
      continue;
    }

    // Caso pazienti "ad hoc" (fatturare_a vuoto): nome_calendario e' del tipo
    // "Nome C." o "Nome C.C." (iniziali del cognome, anche multiplo). Le
    // coppie ("X e Y") non hanno un corrispondente singolo in Psicogest, non
    // provo a indovinare: restano fuori (nonTrovati).
    const nc = (p.nome_calendario || "").trim();
    if (!nc || / e /i.test(nc)) { nonTrovati.push(p); continue; }
    const parti = nc.split(/\s+/);
    const nomeAtteso = normalizeName(parti[0]);
    const iniziali = normalizeName(parti.slice(1).join(" ")).replace(/\./g, "").replace(/\s+/g, "");
    if (!iniziali) { nonTrovati.push(p); continue; }
    const candidati = psicogest.filter((r) => {
      if (normalizeName(r.nome) !== nomeAtteso) return false;
      const cogNorm = normalizeName(r.cognome).replace(/\s+/g, " ");
      const paroleCognome = cogNorm.split(" ");
      // ogni iniziale deve prefissare, in ordine, una parola del cognome
      // (gestisce sia cognomi singoli "Panzieri"->"P" sia doppi "La Verde"->"L.V.")
      if (iniziali.length === 1) return cogNorm.startsWith(iniziali);
      if (paroleCognome.length >= iniziali.length) {
        return [...iniziali].every((ch, i) => paroleCognome[i] && paroleCognome[i][0] === ch);
      }
      return cogNorm.startsWith(iniziali);
    });
    const cfUnici = [...new Set(candidati.map((c) => c.cf))];
    if (cfUnici.length === 0) { nonTrovati.push(p); continue; }
    if (cfUnici.length > 1 || candidati.length > 1) { ambigui.push({ p, cfUnici, candidati }); continue; }
    daAggiornare.push({ p, cf: cfUnici[0], via: `nome_calendario (${candidati[0].nome} ${candidati[0].cognome})` });
  }

  console.log(`Pazienti totali: ${patients.length}`);
  console.log(`Gia' con CF: ${patients.filter((p) => p.codice_fiscale).length}`);
  console.log(`Match univoco trovato (da scrivere): ${daAggiornare.length}`);
  for (const { p, cf, via } of daAggiornare) console.log(`  [${p.id}] "${p.fatturare_a || p.nome_calendario}" -> ${cf}  (via ${via})`);

  console.log(`\nNon trovati nell'export Psicogest (restano vuoti): ${nonTrovati.length}`);
  for (const p of nonTrovati) console.log(`  [${p.id}] "${p.fatturare_a}" (${p.nome_calendario})`);

  console.log(`\nAmbigui (piu' di un CF per lo stesso nome, restano vuoti): ${ambigui.length}`);
  for (const { p, cfUnici } of ambigui) console.log(`  [${p.id}] "${p.fatturare_a}" -> ${cfUnici.join(" / ")}`);

  if (APPLY) {
    console.log("\nScrittura in corso...");
    for (const { p, cf } of daAggiornare) {
      await supaPatch(`patients?id=eq.${p.id}`, { codice_fiscale: cf });
    }
    console.log(`Fatto: ${daAggiornare.length} codici fiscali scritti.`);
  } else {
    console.log("\n(dry-run, passa --apply per scrivere davvero)");
  }
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
