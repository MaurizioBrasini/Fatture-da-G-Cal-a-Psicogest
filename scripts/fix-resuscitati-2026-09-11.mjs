// Esegue le due correzioni confermate da Maurizio il 2026-09-11:
// 1) Registra la disdetta di Elisabetta U. (id 252) per il 16/9 esattamente
//    come farebbe "Registra disdette" -> "Conferma" (stessa logica di
//    aggiorna-confirm/route.js): riga in cancellations, cancellazione
//    dell'evento dal calendario, upsert in skipped_occurrences per impedire
//    che "Genera occorrenze future" la ricrei ancora.
// 2) Elimina la riga duplicata (id 62) dello slot fisso di Silvia F. (id 394)
//    creata due volte per lo stesso cambio di programmazione (bug trovato
//    stasera, vedi scripts/audit-resuscitati-completo.mjs sezione D).
// Dry-run di default, --apply per scrivere davvero.

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
async function supaPost(pathAndQuery, body, extraHeaders = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal", ...extraHeaders },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase POST fallita: ${await res.text()}`);
}
async function supaDelete(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase DELETE fallita: ${await res.text()}`);
}

const APPLY = process.argv.includes("--apply");

const ELISABETTA = {
  patientId: 252,
  eventId: "gdh3cie6mtvhc9siaeil7u0ll0",
  originalDate: "2026-09-16",
  cancelledAt: "2026-09-11T09:37:22Z", // e.updated dell'evento, stessa fonte usata da computeAggiornamentoPreview
  billingStatus: "not_charged", // 5 giorni di preavviso, ben oltre le 48h
};
const SLOT_DUPLICATO_ID = 62; // Silvia F. (patient_id 394) - tenuta la riga 61, identica ma creata per prima

async function main() {
  const tokenRows = await supaGet("google_tokens?select=refresh_token,user_id");
  const { refresh_token: refreshToken, user_id: userId } = tokenRows[0] || {};
  if (!refreshToken || !userId) throw new Error("Nessun refresh_token/user_id trovato in google_tokens.");

  console.log("=== 1) Elisabetta U. — registrazione disdetta 16/9 ===");
  console.log(`  cancellations: patient_id=${ELISABETTA.patientId} original_date=${ELISABETTA.originalDate} billing_status=${ELISABETTA.billingStatus}`);
  console.log(`  calendario: cancella evento ${ELISABETTA.eventId}`);
  console.log(`  skipped_occurrences: patient_id=${ELISABETTA.patientId} data=${ELISABETTA.originalDate}`);

  console.log("\n=== 2) Silvia F. — rimozione slot duplicato ===");
  console.log(`  patient_slots: DELETE id=${SLOT_DUPLICATO_ID}`);

  if (!APPLY) {
    console.log("\n(dry-run, passa --apply per scrivere davvero)");
    return;
  }

  console.log("\nScrittura in corso...");

  await supaPost("cancellations", {
    user_id: userId,
    patient_id: ELISABETTA.patientId,
    event_id: ELISABETTA.eventId,
    original_date: ELISABETTA.originalDate,
    cancelled_at: ELISABETTA.cancelledAt,
    billing_status: ELISABETTA.billingStatus,
  });
  console.log("  cancellations: OK");

  await deleteGoogleCalendarEvent(refreshToken, ELISABETTA.eventId);
  console.log("  evento calendario cancellato: OK");

  await supaPost(
    "skipped_occurrences",
    { user_id: userId, patient_id: ELISABETTA.patientId, data: ELISABETTA.originalDate },
    { Prefer: "resolution=ignore-duplicates,return=minimal" }
  );
  console.log("  skipped_occurrences: OK");

  await supaDelete(`patient_slots?id=eq.${SLOT_DUPLICATO_ID}`);
  console.log("  slot duplicato Silvia F. eliminato: OK");

  console.log("\nFatto.");
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
