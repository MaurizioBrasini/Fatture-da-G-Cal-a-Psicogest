// Scandisce il calendario alla ricerca delle prenotazioni online ("Prenotazioni
// online dr. Brasini...", vedi computePrenotazioniPreview), le abbina alla
// anagrafica pazienti dove possibile e corregge subito il colore a vinaccia
// se un evento non lo avesse già — scrittura cosmetica, reversibile, voluta
// esplicitamente da Maurizio come comportamento automatico (Google non lo fa
// da sola sulla sua pagina di prenotazione). Non tocca titolo, descrizione o
// abbinamento paziente: quello resta alla conferma esplicita in
// prenotazioni-confirm.

import { createClient } from "@/lib/supabase/server";
import { fetchGoogleCalendarEvents, updateGoogleCalendarEventColor } from "@/lib/googleCalendar";
import {
  computePrenotazioniPreview,
  computeConflittiPrenotazioni,
  BOOKING_COLOR_ID,
  GIORNI_LOOKBACK_PRENOTAZIONI,
  todayISO,
  addDays,
} from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const giorniAvanti = Number(body.giorniAvanti) || 180; // le prenotazioni sono sempre su slot futuri

  const [
    { data: patients, error: patientsError },
    { data: slots, error: slotsError },
    { data: tokenRow, error: tokenError },
    { data: closures, error: closuresError },
  ] = await Promise.all([
    supabase.from("patients").select("*").order("id"),
    supabase.from("patient_slots").select("*"),
    supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
    supabase.from("slot_closures").select("*"),
  ]);
  // Una lista slot letta come vuota per un errore farebbe trattare tutti come
  // "senza slot" e proporre di cancellare prenotazioni di pazienti fissi.
  if (patientsError || slotsError || closuresError) {
    return NextResponse.json({ error: (patientsError || slotsError || closuresError).message }, { status: 500 });
  }

  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }

  const dataMinima = todayISO();
  const dataMassima = addDays(dataMinima, giorniAvanti);

  try {
    // Si legge anche a ritroso: un appuntamento appena passato conta per la
    // regola della cadenza. Le prenotazioni da riconciliare restano solo
    // quelle da oggi in avanti.
    const eventiLarghi = await fetchGoogleCalendarEvents(
      tokenRow.refresh_token,
      addDays(dataMinima, -GIORNI_LOOKBACK_PRENOTAZIONI),
      dataMassima
    );
    const events = eventiLarghi.filter((e) => e.data >= dataMinima);
    const { pronte, inAttesa, ambigue, nuove } = computePrenotazioniPreview(events, patients || []);
    const tutte = [...pronte, ...inAttesa, ...ambigue, ...nuove];

    const conflitti = computeConflittiPrenotazioni([...pronte, ...inAttesa], eventiLarghi, patients || [], slots || [], { closures: closures || [] });
    for (const r of [...pronte, ...inAttesa]) {
      if (conflitti[r.eventId]) r.conflitto = conflitti[r.eventId];
    }

    for (const r of tutte) {
      if (r.colorId !== BOOKING_COLOR_ID) {
        try {
          await updateGoogleCalendarEventColor(tokenRow.refresh_token, r.eventId, BOOKING_COLOR_ID);
          r.colorId = BOOKING_COLOR_ID;
          r.coloreCorretto = true;
        } catch (e) {
          r.coloreErrore = e.message;
        }
        await new Promise((res) => setTimeout(res, 150));
      }
    }

    return NextResponse.json({ ok: true, pronte, inAttesa, ambigue, nuove, dataMinima, dataMassima });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
