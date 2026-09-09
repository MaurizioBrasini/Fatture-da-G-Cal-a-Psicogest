// Calcola l'anteprima di un cambio allo slot fisso di un paziente —
// cadenza (interval_days), giorno della settimana (weekday) e/o ora
// (time_of_day), anche insieme — a partire da una data scelta da Maurizio
// (daData, obbligatoria): tutto quello che è PRIMA di quella data non viene
// nemmeno considerato, resta esattamente com'è (ancora sotto il vecchio
// ritmo); da quella data in poi vale il nuovo assetto. Confronta con gli
// appuntamenti futuri già presenti sul calendario da daData in poi per
// trovare quelli che non rientrano più nel nuovo assetto — quelli vanno
// tolti, altrimenti restano "fantasma" fuori ciclo (visto dal vivo l'8/9
// con Susanna e Simone). Non scrive nulla.

import { createClient } from "@/lib/supabase/server";
import { fetchGoogleCalendarEvents } from "@/lib/googleCalendar";
import { occorrenzeFuture, matchPatientForEvent, todayISO, addDays, prossimoWeekday } from "@/lib/logic";
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
  // Ciascuno facoltativo: si aggiorna solo quello che viene passato, il
  // resto resta quello attuale dello slot. daData invece è sempre
  // obbligatoria: senza una data esplicita non si applica nessun cambio.
  const nuovoIntervalDays = body.intervalDays != null ? Number(body.intervalDays) : undefined;
  const nuovoWeekday = body.weekday != null ? Number(body.weekday) : undefined;
  const nuovoTimeOfDay = body.timeOfDay || undefined;
  if (!patientId || !daData || (nuovoIntervalDays === undefined && nuovoWeekday === undefined && nuovoTimeOfDay === undefined)) {
    return NextResponse.json({ error: "Parametri mancanti o non validi (serve sempre la data \"a partire da\")." }, { status: 400 });
  }
  if (nuovoIntervalDays !== undefined && ![7, 14, 28].includes(nuovoIntervalDays)) {
    return NextResponse.json({ error: "Cadenza non valida." }, { status: 400 });
  }
  if (nuovoWeekday !== undefined && (nuovoWeekday < 0 || nuovoWeekday > 6)) {
    return NextResponse.json({ error: "Giorno della settimana non valido." }, { status: 400 });
  }

  const [{ data: patients }, { data: slot }, { data: closures }, { data: tokenRow, error: tokenError }] = await Promise.all([
    supabase.from("patients").select("*"),
    supabase.from("patient_slots").select("*").eq("patient_id", patientId).eq("active", true).maybeSingle(),
    supabase.from("slot_closures").select("*"),
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

  const oggi = todayISO();
  const orizzonte = 180; // guarda abbastanza avanti da intercettare tutte le occorrenze gia' generate
  const dataMassima = addDays(oggi, orizzonte);

  try {
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, oggi, dataMassima);
    // Confronto sull'intera lista pazienti (non un array col solo paziente):
    // matchPatientForEvent usa l'ambiguita' tra TUTTI i pazienti per scartare
    // i match "deboli" quando piu' di uno condivide la stessa base del nome
    // — vedi nota in feedback-calendar-migrations sulle collisioni reali
    // trovate (es. "Francesco All./Man./Mer.").
    const eventiPaziente = events
      .filter((e) => matchPatientForEvent(e.titolo, patients)?.patient.id === patientId)
      .sort((a, b) => (a.data < b.data ? -1 : 1));

    // occorrenzeFuture calcola le date reali solo da anchor_date +
    // interval_days: il campo weekday da solo non sposta nulla (serve solo
    // ad abbinare le chiusure straordinarie). Il nuovo anchor_date è sempre
    // ricalcolato da daData, sul giorno della settimana finale (nuovo se
    // sta cambiando, altrimenti quello attuale) — così anche cambiando solo
    // la cadenza o l'ora, il giorno della settimana resta quello giusto.
    const weekdayFinale = nuovoWeekday ?? slot.weekday;
    const nuovoAnchor = prossimoWeekday(daData, weekdayFinale);
    const slotProposto = {
      ...slot,
      interval_days: nuovoIntervalDays ?? slot.interval_days,
      weekday: weekdayFinale,
      time_of_day: nuovoTimeOfDay ?? slot.time_of_day,
      anchor_date: nuovoAnchor,
    };
    const nuoveDate = new Set(occorrenzeFuture(slotProposto, closures || [], orizzonte, oggi));

    // Solo gli appuntamenti da daData in poi entrano in gioco: tutto quello
    // che è prima resta con il vecchio ritmo, intoccato. L'appuntamento di
    // OGGI non si tocca comunque mai (stessa regola già applicata in
    // "Genera occorrenze future").
    const daRimuovere = eventiPaziente
      .filter((e) => e.data >= daData && e.data !== oggi && !nuoveDate.has(e.data))
      .map((e) => ({ eventId: e.id, data: e.data, ora: e.ora, descrizione: e.descrizione }));
    const invariati = eventiPaziente.filter((e) => e.data >= daData && nuoveDate.has(e.data)).map((e) => e.data);

    return NextResponse.json({
      ok: true,
      intervalDaysAttuale: slot.interval_days,
      weekdayAttuale: slot.weekday,
      timeOfDayAttuale: slot.time_of_day,
      nuovoAnchor,
      daRimuovere,
      invariati,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
