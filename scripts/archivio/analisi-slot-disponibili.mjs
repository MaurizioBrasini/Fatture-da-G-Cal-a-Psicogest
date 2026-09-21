// Sola lettura. Ricava dalla tabella patient_slots (fonte viva, sostituisce
// "Appunti/CALENDARIO PAZIENTI MENSILE.xlsx") un prospetto di:
//  - slot settimanali (interval_days=7): pieni per definizione, mai liberi
//  - slot quindicinali (interval_days=14): "pieni" (2 pazienti alternati) o
//    con un solo paziente (mezza fascia libera ogni 2 settimane)
//  - slot mensili (interval_days=28): un paziente occupa 1 settimana su 4,
//    le altre 3 sono libere sulla stessa fascia
//  - griglia settimanale weekday x orario con lo stato di ogni fascia,
//    usando come universo delle fasce tutte quelle effettivamente in uso da
//    qualche parte nel roster (nessun slot_template popolato su cui basarsi)
//
// Uso: node scripts/analisi-slot-disponibili.mjs  (stampa e scrive anche
// scripts/output/slot-report.json per il consumo da un report visuale)

import fs from "node:fs";

const envRaw = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
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

const GIORNI = ["Domenica", "Lunedi'", "Martedi'", "Mercoledi'", "Giovedi'", "Venerdi'", "Sabato"];

// Lunedi' di riferimento per calcolare l'indice di settimana e quindi la
// "fase" occupata da ciascun paziente nel ciclo di 1/2/4 settimane della sua
// cadenza (settimanale/quindicinale/mensile). Serve a sapere, per uno slot
// quindicinale o mensile, QUANTE delle 2 o 4 settimane del ciclo sono
// davvero libere (non solo "c'e' gia' qualcuno", ma quante fasce mancano).
const EPOCH = Date.UTC(2020, 0, 6); // lunedi' 2020-01-06
function faseSettimana(anchorDate, intervalDays) {
  const cicloSettimane = intervalDays / 7;
  const [y, m, day] = anchorDate.split("-").map(Number);
  const d = Date.UTC(y, m - 1, day);
  const weekIndex = Math.round((d - EPOCH) / (7 * 86400000));
  return ((weekIndex % cicloSettimane) + cicloSettimane) % cicloSettimane;
}

function main() {
  return supaGet(
    "patient_slots?select=id,weekday,time_of_day,interval_days,anchor_date,alternanza_fissa,patients(id,nome_calendario,fatturare_a,stato)&active=eq.true&order=weekday,time_of_day"
  ).then((slots) => {
    // raggruppa per weekday+time_of_day
    const gruppi = new Map();
    for (const s of slots) {
      const key = `${s.weekday}|${s.time_of_day}`;
      if (!gruppi.has(key)) gruppi.set(key, []);
      gruppi.get(key).push(s);
    }

    const settimanali = [];
    const quindicinaliPieni = [];
    const quindicinaliSingoli = [];
    const mensili = [];

    for (const [key, righe] of gruppi) {
      const [weekday, time] = key.split("|");
      // ciclo del gruppo = il piu' lungo tra le cadenze presenti (una fascia
      // settimanale e una quindicinale non possono coesistere davvero sullo
      // stesso weekday+orario: se capita e' un conflitto di dati, segnalato)
      const cicloMax = Math.max(...righe.map((r) => r.interval_days));
      const faseSlots = cicloMax / 7;
      const fasiOccupate = new Set(righe.map((r) => faseSettimana(r.anchor_date, cicloMax)));
      const info = {
        weekday: Number(weekday),
        giorno: GIORNI[Number(weekday)],
        orario: time.slice(0, 5),
        fasiTotali: faseSlots,
        fasiOccupate: fasiOccupate.size,
        fasiLibere: faseSlots - fasiOccupate.size,
        conflitto: fasiOccupate.size < righe.length, // due pazienti sulla stessa fase = sovrapposizione reale
        pazienti: righe.map((r) => ({
          nome: r.patients?.nome_calendario || "?",
          stato: r.patients?.stato || "?",
          interval_days: r.interval_days,
          anchor_date: r.anchor_date,
        })),
      };
      const intervalli = new Set(righe.map((r) => r.interval_days));
      if (intervalli.has(7)) {
        settimanali.push(info);
      } else if (intervalli.has(14) && !intervalli.has(28)) {
        if (righe.length >= 2) quindicinaliPieni.push(info);
        else quindicinaliSingoli.push(info);
      } else if (intervalli.has(28)) {
        mensili.push(info);
      }
    }

    // universo di tutte le fasce orarie in uso da qualche parte (righe = orari, colonne = giorni 1-4:
    // il venerdi' non e' piu' un giorno dedicato ai pazienti, vedi richiesta 2026-09-15)
    const orariUsati = [...new Set(slots.map((s) => s.time_of_day.slice(0, 5)))].sort();
    const giorniUsati = [1, 2, 3, 4];
    const slotVenerdi = slots.filter((s) => s.weekday === 5);

    const griglia = orariUsati.map((orario) => {
      const riga = { orario, giorni: {} };
      for (const g of giorniUsati) {
        const key = `${g}|${orario}:00`;
        const righe = gruppi.get(key) || [];
        if (righe.length === 0) {
          riga.giorni[g] = { stato: "libero", fasiTotali: null, fasiLibere: null, pazienti: [] };
          continue;
        }
        const cicloMax = Math.max(...righe.map((r) => r.interval_days));
        const faseSlots = cicloMax / 7;
        const fasiOccupate = new Set(righe.map((r) => faseSettimana(r.anchor_date, cicloMax))).size;
        const fasiLibere = faseSlots - fasiOccupate;
        const stato = fasiLibere === 0 ? "pieno" : "parziale";
        riga.giorni[g] = {
          stato,
          cadenza: cicloMax === 7 ? "settimanale" : cicloMax === 14 ? "quindicinale" : "mensile",
          fasiTotali: faseSlots,
          fasiLibere,
          pazienti: righe.map((r) => `${r.patients?.nome_calendario || "?"} (${r.patients?.stato})`),
        };
      }
      return riga;
    });

    const report = {
      settimanali,
      quindicinaliPieni,
      quindicinaliSingoli,
      mensili,
      griglia,
      totaleSlotAttivi: slots.length,
      slotVenerdi: slotVenerdi.map((s) => ({
        orario: s.time_of_day.slice(0, 5),
        nome: s.patients?.nome_calendario || "?",
      })),
    };

    fs.mkdirSync(new URL("output/", import.meta.url), { recursive: true });
    fs.writeFileSync(new URL("output/slot-report.json", import.meta.url), JSON.stringify(report, null, 2));

    const conflitti = [...settimanali, ...quindicinaliPieni, ...quindicinaliSingoli, ...mensili].filter((i) => i.conflitto);

    console.log(`Slot attivi totali: ${slots.length}`);
    console.log(`Fasce settimanali (piene, mai libere): ${settimanali.length}`);
    console.log(`Fasce quindicinali piene (2 pazienti, 0/2 fasi libere): ${quindicinaliPieni.length}`);
    console.log(`Fasce quindicinali con un solo paziente (1/2 fasi libere): ${quindicinaliSingoli.length}`);
    console.log(`Fasce mensili: ${mensili.length} (fasi libere: ${mensili.map((m) => `${m.giorno} ${m.orario}=${m.fasiLibere}/4`).join(", ")})`);
    if (conflitti.length) console.log(`ATTENZIONE - conflitti reali (2 pazienti sulla stessa fase): ${conflitti.length}`);
    console.log("\nScritto scripts/output/slot-report.json");
  });
}

main().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
