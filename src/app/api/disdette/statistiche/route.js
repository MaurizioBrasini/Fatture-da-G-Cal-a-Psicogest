// Statistiche disdette per i pazienti con slot fisso attivo (sola lettura).
// Legge gli eventi REALI dal calendario a partire dal giorno della prima
// disdetta registrata (la cache della Dashboard copre solo l'intervallo scelto
// per la sincronizzazione, non è affidabile come denominatore) e delega il
// calcolo a computeStatisticheDisdette. Non scrive nulla.

import { createClient } from "@/lib/supabase/server";
import { fetchGoogleCalendarEvents } from "@/lib/googleCalendar";
import { computeStatisticheDisdette, todayISO } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const soglia = typeof body.soglia === "number" && body.soglia > 0 && body.soglia < 1 ? body.soglia : undefined;

  const [
    { data: patients, error: patientsError },
    { data: slots, error: slotsError },
    { data: cancellazioni, error: cancError },
    { data: tokenRow, error: tokenError },
  ] = await Promise.all([
    supabase.from("patients").select("*"),
    supabase.from("patient_slots").select("patient_id, active"),
    supabase.from("cancellations").select("patient_id, original_date, billing_status"),
    supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
  ]);
  // Errori riportati per quello che sono: una query fallita letta come
  // "lista vuota" darebbe statistiche false (bug già preso su renumber-preview).
  const dbError = patientsError || slotsError || cancError;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }

  const oggi = todayISO();
  const inizio = (cancellazioni || []).map((c) => c.original_date).sort()[0];
  // Nessuna disdetta registrata: niente da calcolare, evita la chiamata Google.
  let events = [];
  if (inizio) {
    try {
      events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, inizio, oggi);
    } catch (e) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  const risultato = computeStatisticheDisdette(patients || [], slots || [], events, cancellazioni || [], { oggi, soglia });
  return NextResponse.json({ ok: true, ...risultato });
}
