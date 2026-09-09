// Anteprima di un cambio programmazione (Maurizio, 2026-09-09 — versione
// semplificata, corregge il primo tentativo troppo "furbo" della sera
// prima): cambiare frequenza/giorno/ora di un paziente con slot fisso NON
// prova a capire quali appuntamenti già generati "si adattano ancora" al
// nuovo ritmo — è esattamente la stessa cosa di un'Uscita dalla
// programmazione (stesso meccanismo di esci-da-programmazione: libera
// SUBITO tutte le settimane future non ancora confermate) seguita da un
// Rientro alla data scelta (stesso meccanismo di "Nuovo slot fisso"). Qui
// si mostra solo l'anteprima di cosa la parte "Uscita" toglierebbe.

import { createClient } from "@/lib/supabase/server";
import { fetchGoogleCalendarEvents } from "@/lib/googleCalendar";
import { matchPatientForEvent, todayISO, addDays } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const patientId = body.patientId;
  const daData = body.daData;
  if (!patientId || !daData) {
    return NextResponse.json({ error: "Parametri mancanti (serve sempre la data \"a partire da\")." }, { status: 400 });
  }

  const [{ data: patients }, { data: slot }, { data: tokenRow, error: tokenError }] = await Promise.all([
    supabase.from("patients").select("*"),
    supabase.from("patient_slots").select("*").eq("patient_id", patientId).eq("active", true).maybeSingle(),
    supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
  ]);
  const patient = (patients || []).find((p) => p.id === patientId);
  if (!patient) return NextResponse.json({ error: "Paziente non trovato." }, { status: 404 });
  if (!slot) return NextResponse.json({ error: "Questo paziente non ha uno slot fisso attivo." }, { status: 400 });
  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }

  try {
    const oggi = todayISO();
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, oggi, addDays(oggi, 365));
    // Stessa regola di esci-da-programmazione: mai la data di oggi, e via
    // TUTTI i futuri non confermati (non solo quelli "fuori ritmo") —
    // il paziente non ha più prenotazioni finché non rientra.
    const daRimuovere = events
      .filter((e) => e.data > oggi && e.colorId === "6" && matchPatientForEvent(e.titolo, patients)?.patient.id === patientId)
      .map((e) => ({ eventId: e.id, data: e.data, ora: e.ora, descrizione: e.descrizione }));
    const mantenuti = events
      .filter((e) => e.data > oggi && e.colorId !== "6" && matchPatientForEvent(e.titolo, patients)?.patient.id === patientId)
      .map((e) => e.data);

    return NextResponse.json({
      ok: true,
      intervalDaysAttuale: slot.interval_days,
      weekdayAttuale: slot.weekday,
      timeOfDayAttuale: slot.time_of_day,
      daRimuovere,
      invariati: mantenuti, // eventi già confermati, mai toccati
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
