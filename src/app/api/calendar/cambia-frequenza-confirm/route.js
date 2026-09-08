// Applica davvero un cambio di cadenza: aggiorna patient_slots.interval_days,
// cancella gli appuntamenti futuri confermati come "fuori dal nuovo ritmo"
// in anteprima, poi rilancia Rinumera sul paziente per aggiornare la
// numerazione dei restanti (stesso ordine di operazioni usato a mano per
// Susanna e Simone l'8/9/2026).

import { createClient } from "@/lib/supabase/server";
import { deleteGoogleCalendarEvent, fetchGoogleCalendarEvents, updateGoogleCalendarEventDescription } from "@/lib/googleCalendar";
import { computeRinumerazione, DEFAULT_SETTINGS, todayISO, addDays } from "@/lib/logic";
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
  const eventIdsDaRimuovere = Array.isArray(body.eventIdsDaRimuovere) ? body.eventIdsDaRimuovere : [];
  if (!patientId || ![7, 14, 28].includes(nuovoIntervalDays)) {
    return NextResponse.json({ error: "Parametri mancanti o non validi." }, { status: 400 });
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
    const { error: slotError } = await supabase
      .from("patient_slots")
      .update({ interval_days: nuovoIntervalDays })
      .eq("patient_id", patientId)
      .eq("active", true);
    if (slotError) throw new Error(slotError.message);

    let cancellati = 0;
    for (const eventId of eventIdsDaRimuovere) {
      await deleteGoogleCalendarEvent(tokenRow.refresh_token, eventId);
      cancellati++;
      await new Promise((r) => setTimeout(r, 150));
    }

    // Rilancia Rinumera sul paziente per aggiornare la numerazione dei
    // restanti (stessa logica di renumber-preview/confirm, qui in un solo
    // giro dato che il paziente è uno solo).
    const [{ data: patients }, { data: settingsRow }] = await Promise.all([
      supabase.from("patients").select("*"),
      supabase.from("settings").select("*").maybeSingle(),
    ]);
    const patient = (patients || []).find((p) => p.id === patientId);
    const settings = { ...DEFAULT_SETTINGS, ...(settingsRow || {}) };
    const oggi = todayISO();
    const dataMinima = patient?.ancora_data && patient.ancora_data < oggi ? patient.ancora_data : oggi;
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, dataMinima, addDays(oggi, 180));
    const piano = patient ? computeRinumerazione(patient, events, settings).filter((r) => r.cambia) : [];
    let noteAggiornate = 0;
    for (const r of piano) {
      await updateGoogleCalendarEventDescription(tokenRow.refresh_token, r.id, r.descrizioneNuova);
      noteAggiornate++;
      await new Promise((res) => setTimeout(res, 150));
    }

    return NextResponse.json({ ok: true, cancellati, noteAggiornate });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
