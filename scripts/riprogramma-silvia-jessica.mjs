// One-off: riprogramma le proiezioni future di Silvia M. e Jessica M. per
// lasciare spazio a Nele e Enzo (quindicinale, Giovedi 13:30, ancora 8/10).
// Piano confermato da Maurizio 2026-09-16:
//   8/10 Nele e Enzo (invariato) - 15/10 vuoto - 22/10 Nele e Enzo -
//   29/10 Silvia M. - 5/11 Nele e Enzo - 12/11 Jessica M. - poi si regolarizza
//   (Silvia ogni 4 sett da 29/10, Jessica ogni 4 sett da 12/11).
// Non tocca gli appuntamenti gia' "presi": 24/9 Silvia (colorId 6, ma
// imminente, lasciato) e 1/10 Jessica (colorId default = confermato).
// Cancella SOLO i due placeholder "da confermare" (colorId 6) generati in
// automatico l'11/9 che non servono piu' con il nuovo piano (22/10 Silvia,
// 29/10 Jessica), e registra skipped_occurrences per non farli ricomparire
// come "anomali" al prossimo giro di "Genera occorrenze future".
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const APPLY = process.argv.includes("--apply");

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter(Boolean).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
);
process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;

const { fetchGoogleCalendarEvents, deleteGoogleCalendarEvent } = await import("../src/lib/googleCalendar.js");

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: tokenRow } = await supabase.from("google_tokens").select("refresh_token, user_id").limit(1).single();
const refreshToken = tokenRow.refresh_token;

const events = await fetchGoogleCalendarEvents(refreshToken, "2026-10-15", "2026-11-05");
const silviaEvt = events.find((e) => e.titolo === "Silvia M." && e.data === "2026-10-22");
const jessicaEvt = events.find((e) => e.titolo === "Jessica M." && e.data === "2026-10-29");

console.log("Evento Silvia 22/10 trovato:", silviaEvt ? `${silviaEvt.id} colorId=${silviaEvt.colorId ?? "(default)"}` : "NON TROVATO");
console.log("Evento Jessica 29/10 trovato:", jessicaEvt ? `${jessicaEvt.id} colorId=${jessicaEvt.colorId ?? "(default)"}` : "NON TROVATO");

if (!silviaEvt || !jessicaEvt) {
  console.error("Uno dei due eventi attesi non e' stato trovato - controllo manuale necessario prima di procedere.");
  process.exit(1);
}
if (silviaEvt.colorId !== "6" || jessicaEvt.colorId !== "6") {
  console.error("Uno dei due eventi non e' 'da confermare' (colorId 6) come atteso - controllo manuale necessario.");
  process.exit(1);
}

if (!APPLY) {
  console.log("\nDRY RUN (nessuna scrittura). Rilancia con --apply per eseguire davvero:");
  console.log("1. patient_slots id=60 (Silvia M.) anchor_date 2026-09-24 -> 2026-10-29");
  console.log("2. patient_slots id=31 (Jessica M.) anchor_date 2026-10-01 -> 2026-11-12");
  console.log(`3. Cancella evento calendario Silvia M. 22/10 (${silviaEvt.id})`);
  console.log(`4. Cancella evento calendario Jessica M. 29/10 (${jessicaEvt.id})`);
  console.log("5. Inserisce skipped_occurrences per (413, 2026-10-22) e (115, 2026-10-29)");
  process.exit(0);
}

const { error: errSilviaSlot } = await supabase
  .from("patient_slots")
  .update({ anchor_date: "2026-10-29" })
  .eq("id", 60);
if (errSilviaSlot) throw errSilviaSlot;
console.log("OK: patient_slots id=60 (Silvia M.) -> anchor_date 2026-10-29");

const { error: errJessicaSlot } = await supabase
  .from("patient_slots")
  .update({ anchor_date: "2026-11-12" })
  .eq("id", 31);
if (errJessicaSlot) throw errJessicaSlot;
console.log("OK: patient_slots id=31 (Jessica M.) -> anchor_date 2026-11-12");

await deleteGoogleCalendarEvent(refreshToken, silviaEvt.id);
console.log("OK: evento Silvia M. 22/10 cancellato dal calendario");

await deleteGoogleCalendarEvent(refreshToken, jessicaEvt.id);
console.log("OK: evento Jessica M. 29/10 cancellato dal calendario");

const { error: errSkip } = await supabase.from("skipped_occurrences").insert([
  { user_id: tokenRow.user_id, patient_id: 413, data: "2026-10-22" },
  { user_id: tokenRow.user_id, patient_id: 115, data: "2026-10-29" },
]);
if (errSkip) throw errSkip;
console.log("OK: skipped_occurrences registrate per (413, 2026-10-22) e (115, 2026-10-29)");

console.log("\nFatto. Prossimo passo: in app, 'Genera occorrenze future' per creare i nuovi eventi (Silvia 29/10 e successivi, Jessica 12/11 e successivi, Nele e Enzo 8/10 e successivi).");
