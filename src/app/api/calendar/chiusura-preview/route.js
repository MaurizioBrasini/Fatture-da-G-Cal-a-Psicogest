// Calcola l'anteprima di una chiusura/indisponibilità (una finestra
// continua da dataInizio+oraInizio a dataFine+oraFine): trova i conflitti
// REALI sul calendario (rilevaConflittiChiusura — solo pazienti che hanno
// davvero un appuntamento dentro la finestra, mai in base al solo orario
// nominale della fascia, per non coinvolgere chi ha già disdetto per conto
// suo), poi ricalcola le occorrenze corrette per gli slot coinvolti e trova
// gli eventi già creati che non corrisponderebbero più — da proporre in
// cancellazione (solo se ancora "da confermare") o solo da segnalare (se già
// confermati o prenotati online: mai toccati in automatico). Non scrive
// nulla su calendario o database.

import { createClient } from "@/lib/supabase/server";
import { fetchGoogleCalendarEvents } from "@/lib/googleCalendar";
import { rilevaConflittiChiusura, computeImpattoChiusura, todayISO, addDays } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { dataInizio, oraInizio, dataFine, oraFine, note } = body;
  const giorniAvanti = Number(body.giorniAvanti) || 120;
  if (!dataInizio || !dataFine || dataFine < dataInizio) {
    return NextResponse.json({ error: "Intervallo di date non valido." }, { status: 400 });
  }

  const [{ data: patientSlots }, { data: patients }, { data: closureEsistenti }, { data: tokenRow, error: tokenError }] =
    await Promise.all([
      supabase.from("patient_slots").select("*").eq("active", true),
      supabase.from("patients").select("*"),
      supabase.from("slot_closures").select("*"),
      supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
    ]);

  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }

  const oggi = todayISO();
  const dataMassima = addDays(oggi, giorniAvanti);

  try {
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, oggi, dataMassima);

    const conflitti = rilevaConflittiChiusura(patientSlots || [], patients || [], events, {
      dataInizio,
      oraInizio,
      dataFine,
      oraFine,
      note,
    });
    const giaEsistenti = new Set(
      (closureEsistenti || []).map((c) => `${c.weekday}|${c.time_of_day}|${c.closure_date}`)
    );
    const nuoveChiusure = conflitti.filter((c) => !giaEsistenti.has(`${c.weekday}|${c.time_of_day}|${c.closure_date}`));

    if (!nuoveChiusure.length) {
      return NextResponse.json({ ok: true, nuoveChiusure: [], daCancellare: [], daVerificare: [], alternanzaCoinvolta: [] });
    }

    const closureComplete = [...(closureEsistenti || []), ...nuoveChiusure];
    const { daCancellare, daVerificare, alternanzaCoinvolta } = computeImpattoChiusura(
      patientSlots || [],
      patients || [],
      events,
      closureComplete,
      nuoveChiusure,
      giorniAvanti,
      oggi
    );
    return NextResponse.json({ ok: true, nuoveChiusure, daCancellare, daVerificare, alternanzaCoinvolta });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
