// Calcola l'anteprima di un cambio di cadenza (patient_slots.interval_days)
// per un paziente: ricalcola le occorrenze attese con il NUOVO intervallo a
// partire dallo stesso anchor_date, poi confronta con gli appuntamenti
// futuri già presenti sul calendario per trovare quelli che non rientrano
// più nel nuovo ritmo — quelli vanno tolti, altrimenti restano "fantasma"
// fuori ciclo (visto dal vivo l'8/9 con Susanna e Simone). Non scrive nulla.

import { createClient } from "@/lib/supabase/server";
import { fetchGoogleCalendarEvents } from "@/lib/googleCalendar";
import { occorrenzeFuture, matchPatientForEvent, todayISO, addDays } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const patientId = body.patientId;
  const nuovoIntervalDays = Number(body.intervalDays);
  if (!patientId || ![7, 14, 28].includes(nuovoIntervalDays)) {
    return NextResponse.json({ error: "Parametri mancanti o non validi." }, { status: 400 });
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

    const nuoveDate = new Set(occorrenzeFuture({ ...slot, interval_days: nuovoIntervalDays }, closures || [], orizzonte, oggi));

    const daRimuovere = eventiPaziente
      .filter((e) => !nuoveDate.has(e.data))
      .map((e) => ({ eventId: e.id, data: e.data, ora: e.ora, descrizione: e.descrizione }));
    const invariati = eventiPaziente.filter((e) => nuoveDate.has(e.data)).map((e) => e.data);

    return NextResponse.json({
      ok: true,
      intervalDaysAttuale: slot.interval_days,
      daRimuovere,
      invariati,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
