// Popola patients.indirizzo/localita/provincia/cap (nuove colonne,
// schema_addendum9.sql) usando lo stesso export reale Psicogest gia' letto
// da popola-contatti-da-psicogest.mjs (Appunti/Settings/"psicogest
// pazienti.xls", colonne "Indirizzo 1", "Localita'", "Provincia", "CAP").
//
// A differenza dello script precedente, qui il match avviene PRIMA per
// Codice Fiscale (ora compilato per 70/81 pazienti, molto piu' affidabile
// di nome+cognome perche' univoco per costruzione) e solo come fallback per
// nome+cognome (stesso criterio gia' usato, incluso il caso "ad hoc" via
// nome_calendario). Scrive SOLO i campi vuoti, non sovrascrive mai un
// valore gia' presente. Dry-run di default, --apply per scrivere davvero.

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
function normalizeCF(s) {
  return (s || "").toString().trim().toUpperCase();
}

const APPLY = process.argv.includes("--apply");
const xlsPath = process.argv.slice(2).find((a) => !a.startsWith("--")) || "Appunti/Settings/psicogest pazienti.xls";

function loadPsicogest(path) {
  const wb = XLSX.readFile(path);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const header = rows[0];
  const idx = (name) => header.indexOf(name);
  const idxNome = idx("Nome");
  const idxCognome = idx("Cognome");
  const idxCF = idx("Codice Fiscale");
  const idxIndirizzo = idx("Indirizzo 1");
  const idxLocalita = idx("Località");
  const idxProvincia = idx("Provincia");
  const idxCap = idx("CAP");
  return rows.slice(1)
    .map((f) => ({
      nome: (f[idxNome] || "").toString().trim(),
      cognome: (f[idxCognome] || "").toString().trim(),
      cf: normalizeCF(f[idxCF]),
      indirizzo: (f[idxIndirizzo] || "").toString().trim(),
      localita: (f[idxLocalita] || "").toString().trim(),
      provincia: (f[idxProvincia] || "").toString().trim(),
      cap: (f[idxCap] || "").toString().trim(),
    }))
    .filter((r) => r.nome && r.cognome);
}

async function main() {
  const psicogest = loadPsicogest(xlsPath);

  const perCF = new Map();
  for (const r of psicogest) {
    if (!r.cf) continue;
    if (!perCF.has(r.cf)) perCF.set(r.cf, []);
    perCF.get(r.cf).push(r);
  }
  const perNome = new Map();
  for (const r of psicogest) {
    const chiave = normalizeName(`${r.cognome} ${r.nome}`);
    if (!perNome.has(chiave)) perNome.set(chiave, []);
    perNome.get(chiave).push(r);
  }

  const patients = await supaGet("patients?select=id,nome_calendario,fatturare_a,codice_fiscale,indirizzo,localita,provincia,cap&order=id");
  const daAggiornare = [];
  const nonTrovati = [];
  const ambigui = [];

  for (const p of patients) {
    const mancaIndirizzo = !p.indirizzo;
    const mancaLocalita = !p.localita;
    const mancaProvincia = !p.provincia;
    const mancaCap = !p.cap;
    if (!mancaIndirizzo && !mancaLocalita && !mancaProvincia && !mancaCap) continue;

    let candidati;
    let via;
    const cf = normalizeCF(p.codice_fiscale);
    if (cf && perCF.has(cf)) {
      candidati = perCF.get(cf);
      via = "codice_fiscale";
    } else if (p.fatturare_a) {
      const chiave = normalizeName(p.fatturare_a);
      candidati = perNome.get(chiave) || [];
      via = "fatturare_a";
    } else {
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
      via = "nome_calendario";
    }

    if (!candidati || candidati.length === 0) { nonTrovati.push(p); continue; }

    const indirizzoUnici = [...new Set(candidati.map((c) => c.indirizzo).filter(Boolean))];
    const localitaUnici = [...new Set(candidati.map((c) => c.localita).filter(Boolean))];
    const provinciaUnici = [...new Set(candidati.map((c) => c.provincia).filter(Boolean))];
    const capUnici = [...new Set(candidati.map((c) => c.cap).filter(Boolean))];
    if (indirizzoUnici.length > 1 || localitaUnici.length > 1 || provinciaUnici.length > 1 || capUnici.length > 1) {
      ambigui.push({ p, indirizzoUnici, localitaUnici, provinciaUnici, capUnici });
      continue;
    }

    const patch = {};
    if (mancaIndirizzo && indirizzoUnici[0]) patch.indirizzo = indirizzoUnici[0];
    if (mancaLocalita && localitaUnici[0]) patch.localita = localitaUnici[0];
    if (mancaProvincia && provinciaUnici[0]) patch.provincia = provinciaUnici[0];
    if (mancaCap && capUnici[0]) patch.cap = capUnici[0];
    if (Object.keys(patch).length === 0) { nonTrovati.push(p); continue; }

    daAggiornare.push({ p, patch, via });
  }

  console.log(`Pazienti totali: ${patients.length}`);
  console.log(`Gia' completi (indirizzo+localita+provincia+cap): ${patients.filter((p) => p.indirizzo && p.localita && p.provincia && p.cap).length}`);
  console.log(`Match trovato, da scrivere: ${daAggiornare.length}`);
  for (const { p, patch, via } of daAggiornare) {
    console.log(`  [${p.id}] "${p.fatturare_a || p.nome_calendario}" -> ${JSON.stringify(patch)}  (via ${via})`);
  }

  console.log(`\nNon trovati nell'export Psicogest (restano come sono): ${nonTrovati.length}`);
  for (const p of nonTrovati) console.log(`  [${p.id}] "${p.fatturare_a || p.nome_calendario}"`);

  console.log(`\nAmbigui (piu' di un valore per lo stesso identificatore, restano come sono): ${ambigui.length}`);
  for (const { p, indirizzoUnici, localitaUnici, provinciaUnici, capUnici } of ambigui) {
    console.log(`  [${p.id}] "${p.fatturare_a}" -> IND:${indirizzoUnici.join("/")} LOC:${localitaUnici.join("/")} PROV:${provinciaUnici.join("/")} CAP:${capUnici.join("/")}`);
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
