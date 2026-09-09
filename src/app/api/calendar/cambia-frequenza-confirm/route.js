// Applica un cambio programmazione (Maurizio, 2026-09-09 — versione
// semplificata): esattamente un'Uscita dalla programmazione (disattiva lo
// slot corrente, cancella gli appuntamenti futuri non confermati confermati
// in anteprima — il paziente resta attivo ma senza prenotazioni, "a schema
// libero" nel frattempo) seguita SUBITO da un Rientro alla data scelta
// (nuovo patient_slot, stesso meccanismo di "Nuovo slot fisso" per un
// paziente che riparte). Nessuna logica "furba" di conservazione parziale:
// tutto il non confermato si libera, punto.

import { createClient } from "@/lib/supabase/server";
import { deleteGoogleCalendarEvent, fetchGoogleCalendarEvents, updateGoogleCalendarEventDescription } from "@/lib/googleCalendar";
import { computeRinumerazione, DEFAULT_SETTINGS, todayISO, addDays, prossimoWeekday } from "@/lib/logic";
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
  const nuovoIntervalDays = body.intervalDays != null ? Number(body.intervalDays) : undefined;
  const nuovoWeekday = body.weekday != null ? Number(body.weekday) : undefined;
  const nuovoTimeOfDay = body.timeOfDay || undefined;
  const eventIdsDaRimuovere = Array.isArray(body.eventIdsDaRimuovere) ? body.eventIdsDaRimuovere : [];
  if (!patientId || !daData) {
    return NextResponse.json({ error: "Parametri mancanti (serve sempre la data \"a partire da\")." }, { status: 400 });
  }
  if (nuovoIntervalDays !== undefined && ![7, 14, 28].includes(nuovoIntervalDays)) {
    return NextResponse.json({ error: "Cadenza non valida." }, { status: 400 });
  }

  const { data: tokenRow, error: tokenError } = await supabase
    .from("google_tokens")
    .select("refresh_token")
    .eq("user_id", user.id)
    .single();
  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }

  try {
    // Legge lo slot attuale per sapere cosa NON sta cambiando (es. se cambi
    // solo l'ora, cadenza e giorno del nuovo slot restano quelli di prima).
    const { data: slotAttuale, error: slotLetturaError } = await supabase
      .from("patient_slots")
      .select("weekday, time_of_day, interval_days")
      .eq("patient_id", patientId)
      .eq("active", true)
      .maybeSingle();
    if (slotLetturaError) throw new Error(slotLetturaError.message);
    if (!slotAttuale) {
      throw new Error("Nessuno slot fisso attivo trovato per questo paziente: nessuna modifica scritta.");
    }

    // --- Uscita: disattiva lo slot corrente, libera tutte le settimane
    // future non confermate (esattamente come esci-da-programmazione).
    const { error: disattivaError } = await supabase
      .from("patient_slots")
      .update({ active: false })
      .eq("patient_id", patientId)
      .eq("active", true);
    if (disattivaError) throw new Error(disattivaError.message);

    let cancellati = 0;
    const cancellazioniFallite = [];
    for (const eventId of eventIdsDaRimuovere) {
      try {
        await deleteGoogleCalendarEvent(tokenRow.refresh_token, eventId);
        cancellati++;
      } catch (e) {
        cancellazioniFallite.push({ eventId, error: e.message });
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    // --- Rientro: nuovo slot fisso alla data scelta, con i campi cambiati
    // (o quelli di prima per chi non cambia). Il giorno della settimana e
    // la data devono essere coerenti: prossimoWeekday sposta la data in
    // avanti (mai indietro) fino al giorno giusto se non coincidono già.
    const weekdayFinale = nuovoWeekday ?? slotAttuale.weekday;
    const nuovoAnchor = prossimoWeekday(daData, weekdayFinale);
    const { data: userData } = await supabase.auth.getUser();
    const { error: nuovoSlotError } = await supabase.from("patient_slots").insert({
      user_id: userData.user.id,
      patient_id: patientId,
      weekday: weekdayFinale,
      time_of_day: nuovoTimeOfDay ?? slotAttuale.time_of_day,
      interval_days: nuovoIntervalDays ?? slotAttuale.interval_days,
      anchor_date: nuovoAnchor,
      active: true,
    });
    if (nuovoSlotError) throw new Error(nuovoSlotError.message);
    await supabase.from("patients").update({ fuori_schema: false }).eq("id", patientId);

    // Rilancia Rinumera sul paziente (isolata nel proprio try: le operazioni
    // sopra sono già definitive, un suo errore non deve far perdere i
    // conteggi già ottenuti) — utile soprattutto per gli eventuali
    // appuntamenti già confermati rimasti, la cui numerazione potrebbe
    // essere cambiata.
    let noteAggiornate = 0;
    let noteFallite = [];
    let rinumeraError = null;
    try {
      const [{ data: patients }, { data: settingsRow }] = await Promise.all([
        supabase.from("patients").select("*"),
        supabase.from("settings").select("*").maybeSingle(),
      ]);
      const patient = (patients || []).find((p) => p.id === patientId);
      const settings = { ...DEFAULT_SETTINGS, ...(settingsRow || {}) };
      const oggi = todayISO();
      const dataMinima = patient?.ancora_data && patient.ancora_data < oggi ? patient.ancora_data : oggi;
      const events = patient ? await fetchGoogleCalendarEvents(tokenRow.refresh_token, dataMinima, addDays(oggi, 180)) : [];
      const piano = patient ? computeRinumerazione(patient, events, settings, patients).filter((r) => r.cambia) : [];
      for (const r of piano) {
        try {
          await updateGoogleCalendarEventDescription(tokenRow.refresh_token, r.id, r.descrizioneNuova);
          noteAggiornate++;
        } catch (e) {
          noteFallite.push({ eventId: r.id, error: e.message });
        }
        await new Promise((res) => setTimeout(res, 150));
      }
    } catch (e) {
      rinumeraError = e.message;
    }

    return NextResponse.json({
      ok: cancellazioniFallite.length === 0 && noteFallite.length === 0 && !rinumeraError,
      cancellati,
      noteAggiornate,
      cancellazioniFallite,
      noteFallite,
      rinumeraError,
      nuovoAnchor,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
