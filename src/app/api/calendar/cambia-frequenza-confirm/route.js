// Applica davvero un cambio di cadenza: aggiorna patient_slots.interval_days,
// cancella gli appuntamenti futuri confermati come "fuori dal nuovo ritmo"
// in anteprima, poi rilancia Rinumera sul paziente per aggiornare la
// numerazione dei restanti (stesso ordine di operazioni usato a mano per
// Susanna e Simone l'8/9/2026).

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
  if (!patientId || !daData || (nuovoIntervalDays === undefined && nuovoWeekday === undefined && nuovoTimeOfDay === undefined)) {
    return NextResponse.json({ error: "Parametri mancanti o non validi (serve sempre la data \"a partire da\")." }, { status: 400 });
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
    // Serve leggere lo slot attuale PRIMA di scrivere: l'anchor_date nuovo
    // si ricalcola sempre da daData sul giorno della settimana finale
    // (nuovo se sta cambiando, altrimenti quello attuale) — stessa logica
    // già usata in anteprima, per restare coerenti.
    const { data: slotAttuale, error: slotLetturaError } = await supabase
      .from("patient_slots")
      .select("weekday")
      .eq("patient_id", patientId)
      .eq("active", true)
      .maybeSingle();
    if (slotLetturaError) throw new Error(slotLetturaError.message);
    if (!slotAttuale) {
      throw new Error("Nessuno slot fisso attivo trovato per questo paziente: nessuna modifica scritta.");
    }

    const weekdayFinale = nuovoWeekday ?? slotAttuale.weekday;
    const aggiornamentoSlot = { anchor_date: prossimoWeekday(daData, weekdayFinale) };
    if (nuovoIntervalDays !== undefined) aggiornamentoSlot.interval_days = nuovoIntervalDays;
    if (nuovoWeekday !== undefined) aggiornamentoSlot.weekday = nuovoWeekday;
    if (nuovoTimeOfDay !== undefined) aggiornamentoSlot.time_of_day = nuovoTimeOfDay;

    const { data: slotAggiornato, error: slotError } = await supabase
      .from("patient_slots")
      .update(aggiornamentoSlot)
      .eq("patient_id", patientId)
      .eq("active", true)
      .select("id");
    if (slotError) throw new Error(slotError.message);
    // .update().eq() non dà errore se nessuna riga corrisponde (es. lo slot
    // è stato disattivato tra l'anteprima e la conferma) — senza questo
    // controllo proseguiremmo a cancellare appuntamenti come se lo slot
    // fosse davvero cambiato, quando in realtà non è stato scritto nulla.
    if (!slotAggiornato || slotAggiornato.length === 0) {
      throw new Error("Nessuno slot fisso attivo trovato per questo paziente: nessuna modifica scritta.");
    }

    // Cancellazioni e aggiornamenti nota proseguono elemento per elemento
    // (stesso pattern resiliente di renumber-confirm/genera-occorrenze-confirm):
    // un errore di rete o un rate-limit di Google su UN evento non deve
    // bloccare gli altri né lasciare l'utente senza sapere cosa è stato
    // applicato davvero.
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

    // Rilancia Rinumera sul paziente per aggiornare la numerazione dei
    // restanti (stessa logica di renumber-preview/confirm, qui in un solo
    // giro dato che il paziente è uno solo). Isolata nel proprio try: la
    // cadenza è già stata cambiata e le cancellazioni sopra sono già
    // definitive, quindi un errore qui (rete, fetch pazienti/eventi) deve
    // comunque restituire cancellati/cancellazioniFallite invece di andare
    // perso nel catch esterno, che altrimenti risponderebbe solo con un
    // errore generico senza dire che le cancellazioni sono già avvenute.
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
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
