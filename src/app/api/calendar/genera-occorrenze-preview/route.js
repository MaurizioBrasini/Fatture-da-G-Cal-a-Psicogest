// Calcola l'anteprima delle occorrenze future MANCANTI sul calendario, per
// tutti i pazienti con patient_slot attivo: usa occorrenzeFuture (stessa
// logica del motore appuntamenti) per sapere quali date dovrebbero esistere
// entro l'orizzonte scelto, poi scarta quelle che hanno gia' un evento reale
// abbinato (matchPatientForEvent) — cosi' rilanciarlo ogni settimana genera
// solo la fascia nuova, mai duplicati. Non scrive nulla: solo l'anteprima.

import { createClient } from "@/lib/supabase/server";
import { fetchGoogleCalendarEvents } from "@/lib/googleCalendar";
import { computeOccorrenzeDaGenerare, todayISO, addDays } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const giorniAvanti = Number(body.giorniAvanti) || 45;

  const [{ data: slots }, { data: patients }, { data: closures }, { data: skipped }, { data: generated }, { data: tokenRow, error: tokenError }] =
    await Promise.all([
      supabase.from("patient_slots").select("*").eq("active", true),
      supabase.from("patients").select("*"),
      supabase.from("slot_closures").select("*"),
      supabase.from("skipped_occurrences").select("patient_id, data"),
      supabase.from("generated_occurrences").select("patient_id, data"),
      supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
    ]);
  const skippedSet = new Set((skipped || []).map((s) => `${s.patient_id}|${s.data}`));
  const generatedSet = new Set((generated || []).map((g) => `${g.patient_id}|${g.data}`));

  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }

  const oggi = todayISO();
  const dataMassima = addDays(oggi, giorniAvanti);

  try {
    // Orizzonte di lettura leggermente piu' ampio all'indietro, per essere
    // sicuri di intercettare eventi gia' generati anche se con qualche
    // giorno di scarto rispetto alla data "grezza" attesa (chiusure ecc.).
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, addDays(oggi, -14), dataMassima);

    const { mancanti, anomale } = computeOccorrenzeDaGenerare(
      slots || [],
      patients || [],
      events,
      closures || [],
      skippedSet,
      generatedSet,
      giorniAvanti,
      oggi
    );

    return NextResponse.json({ ok: true, pazienti: mancanti, anomalie: anomale, dataMassima });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
