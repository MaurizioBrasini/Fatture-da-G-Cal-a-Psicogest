// Popola patients.codice_fiscale, patients.telefono, patients.email (colonne
// gia' esistenti) usando l'export reale Psicogest (Appunti/Settings/
// "psicogest pazienti.xls", letto direttamente con la libreria xlsx - non
// serve piu' un dump CSV manuale). Scrive SOLO i campi vuoti nell'app e SOLO
// quando il match nome+cognome e' univoco; i casi ambigui/non trovati
// restano vuoti, segnalati in output. Non sovrascrive mai un valore gia'
// presente (stessa cautela di scripts/popola-codice-fiscale.mjs, di cui
// questo script e' l'estensione a telefono/email).

import fs from "node:fs";
import XLSX from "xlsx";

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

const APPLY = process.argv.includes("--apply");
const xlsPath = process.argv[2] || "Appunti/Settings/psicogest pazienti.xls";

function loadPsicogest(path) {
  const wb = XLSX.readFile(path);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const header = rows[0];
  const idx = (name) => header.indexOf(name);
  const idxNome = idx("Nome");
  const idxCognome = idx("Cognome");
  const idxCF = idx("Codice Fiscale");
  const idxTel = idx("Telefono 1");
  const idxEmail = idx("Email");
  return rows.slice(1)
    .map((f) => ({
      nome: (f[idxNome] || "").toString().trim(),
      cognome: (f[idxCognome] || "").toString().trim(),
      cf: (f[idxCF] || "").toString().trim(),
      telefono: (f[idxTel] || "").toString().trim(),
      email: (f[idxEmail] || "").toString().trim(),
    }))
    .filter((r) => r.nome && r.cognome);
}

async function main() {
  const psicogest = loadPsicogest(xlsPath);

  // indicizza per "COGNOME NOME" normalizzato -> lista di record (per scovare ambiguita')
  const indice = new Map();
  for (const r of psicogest) {
    const chiave = normalizeName(`${r.cognome} ${r.nome}`);
    if (!indice.has(chiave)) indice.set(chiave, []);
    indice.get(chiave).push(r);
  }

  const patients = await supaGet("patients?select=id,nome_calendario,fatturare_a,codice_fiscale,telefono,email&order=id");
  const daAggiornare = [];
  const nonTrovati = [];
  const ambigui = [];

  for (const p of patients) {
    const mancaCF = !p.codice_fiscale;
    const mancaTel = !p.telefono;
    const mancaEmail = !p.email;
    if (!mancaCF && !mancaTel && !mancaEmail) continue; // niente da fare per questo paziente

    let candidati;
    let via;
    if (p.fatturare_a) {
      const chiave = normalizeName(p.fatturare_a);
      candidati = indice.get(chiave) || [];
      via = "fatturare_a";
    } else {
      // Pazienti "ad hoc" (fatturare_a vuoto): nome_calendario e' del tipo
      // "Nome C." o "Nome C.C." (iniziali del cognome). Le coppie ("X e Y")
      // non hanno corrispondente singolo in Psicogest: restano fuori.
      const nc = (p.nome_calendario || "").trim();
      if (!nc || / e /i.test(nc)) { nonTrovati.push(p); continue; }
      const parti = nc.split(/\s+/);
      const nomeAtteso = normalizeName(parti[0]);
      const iniziali = normalizeName(parti.slice(1).join(" ")).replace(/\./g, "").replace(/\s+/g, "");
      if (!iniziali) { nonTrovati.push(p); continue; }
      candidati = psicogest.filter((r) => {
        if (normalizeName(r.nome) !== nomeAtteso) return false;
        const cogNorm = normalizeName(r.cognome).replace(/\s+/g, " ");
        const paroleCognome = cogNorm.split(" ");
        if (iniziali.length === 1) return cogNorm.startsWith(iniziali);
        if (paroleCognome.length >= iniziali.length) {
          return [...iniziali].every((ch, i) => paroleCognome[i] && paroleCognome[i][0] === ch);
        }
        return cogNorm.startsWith(iniziali);
      });
      via = `nome_calendario`;
    }

    if (candidati.length === 0) { nonTrovati.push(p); continue; }

    // ambiguo se i candidati non concordano tutti sullo stesso valore per
    // almeno uno dei campi che ci servono davvero
    const cfUnici = [...new Set(candidati.map((c) => c.cf).filter(Boolean))];
    const telUnici = [...new Set(candidati.map((c) => c.telefono).filter(Boolean))];
    const emailUnici = [...new Set(candidati.map((c) => c.email).filter(Boolean))];
    if (cfUnici.length > 1 || telUnici.length > 1 || emailUnici.length > 1) {
      ambigui.push({ p, cfUnici, telUnici, emailUnici });
      continue;
    }

    const patch = {};
    if (mancaCF && cfUnici[0]) patch.codice_fiscale = cfUnici[0];
    if (mancaTel && telUnici[0]) patch.telefono = telUnici[0];
    if (mancaEmail && emailUnici[0]) patch.email = emailUnici[0];
    if (Object.keys(patch).length === 0) { nonTrovati.push(p); continue; }

    daAggiornare.push({ p, patch, via: via === "fatturare_a" ? via : `${via} (${candidati[0].nome} ${candidati[0].cognome})` });
  }

  console.log(`Pazienti totali: ${patients.length}`);
  console.log(`Gia' completi (CF+telefono+email): ${patients.filter((p) => p.codice_fiscale && p.telefono && p.email).length}`);
  console.log(`Match trovato, da scrivere: ${daAggiornare.length}`);
  for (const { p, patch, via } of daAggiornare) {
    console.log(`  [${p.id}] "${p.fatturare_a || p.nome_calendario}" -> ${JSON.stringify(patch)}  (via ${via})`);
  }

  console.log(`\nNon trovati nell'export Psicogest (restano come sono): ${nonTrovati.length}`);
  for (const p of nonTrovati) console.log(`  [${p.id}] "${p.fatturare_a}" (${p.nome_calendario})`);

  console.log(`\nAmbigui (piu' di un valore per lo stesso nome, restano come sono): ${ambigui.length}`);
  for (const { p, cfUnici, telUnici, emailUnici } of ambigui) {
    console.log(`  [${p.id}] "${p.fatturare_a}" -> CF:${cfUnici.join("/")} TEL:${telUnici.join("/")} EMAIL:${emailUnici.join("/")}`);
  }

  if (APPLY) {
    console.log("\nScrittura in corso...");
    for (const { p, patch } of daAggiornare) {
      await supaPatch(`patients?id=eq.${p.id}`, patch);
    }
    console.log(`Fatto: ${daAggiornare.length} pazienti aggiornati.`);
  } else {
    console.log("\n(dry-run, passa --apply per scrivere davvero)");
  }
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
