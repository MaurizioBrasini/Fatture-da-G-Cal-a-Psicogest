// Applica le riconnessioni di prenotazioni online confermate in anteprima.
// Riceve [{eventId, patientId, bookerEmail}]. Per ciascuna:
// 1) rinomina SOLO il titolo dell'evento al nome_calendario del paziente
//    scelto — nessun'altra modifica (colore, descrizione, altri eventi
//    restano invariati, nessun evento nuovo viene generato);
// 2) se il paziente non ha ancora un'email salvata e la prenotazione ne
//    porta una, la salva (rinforza il matching automatico dei prossimi giri);
// poi rilancia subito la rinumerazione (stessa logica di renumber-confirm)
// per ogni paziente toccato con successo, così la numerazione resta coerente
// senza un passaggio manuale separato.

import { createClient } from "@/lib/supabase/server";
import {
  fetchGoogleCalendarEvents,
  updateGoogleCalendarEventTitle,
  updateGoogleCalendarEventDescription,
} from "@/lib/googleCalendar";
import { computeRinumerazione, DEFAULT_SETTINGS, todayISO, addDays } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { abbinamenti } = await request.json().catch(() => ({}));
  if (!Array.isArray(abbinamenti) || !abbinamenti.length) {
    return NextResponse.json({ error: "Nessuna riconnessione da confermare." }, { status: 400 });
  }

  const [{ data: patients }, { data: settingsRow }, { data: tokenRow, error: tokenError }] = await Promise.all([
    supabase.from("patients").select("*").order("id"),
    supabase.from("settings").select("*").maybeSingle(),
    supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
  ]);

  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }
  const settings = { ...DEFAULT_SETTINGS, ...(settingsRow || {}) };

  const risultati = [];
  for (const a of abbinamenti) {
    try {
      const patient = (patients || []).find((p) => p.id === a.patientId);
      if (!patient) throw new Error("Paziente non trovato.");
      if (!patient.nome_calendario) throw new Error("Il paziente non ha ancora un nome calendario impostato.");

      await updateGoogleCalendarEventTitle(tokenRow.refresh_token, a.eventId, patient.nome_calendario);

      if (a.bookerEmail && !patient.email) {
        await supabase.from("patients").update({ email: a.bookerEmail }).eq("id", patient.id);
        patient.email = a.bookerEmail;
      }

      risultati.push({ eventId: a.eventId, patientId: patient.id, ok: true });
    } catch (e) {
      risultati.push({ eventId: a.eventId, patientId: a.patientId, ok: false, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const pazientiToccati = [...new Set(risultati.filter((r) => r.ok).map((r) => r.patientId))];
  let rinumerati = 0;
  if (pazientiToccati.length) {
    const oggi = todayISO();
    const dataMinima =
      pazientiToccati.reduce((min, id) => {
        const p = patients.find((pp) => pp.id === id);
        return p?.ancora_data && (!min || p.ancora_data < min) ? p.ancora_data : min;
      }, null) || oggi;
    const dataMassima = addDays(oggi, 180);
    try {
      // Rilettura live DOPO tutti i rinomina: i titoli appena scritti devono
      // già essere visibili per entrare nel conteggio.
      const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, dataMinima, dataMassima);
      for (const id of pazientiToccati) {
        const patient = patients.find((p) => p.id === id);
        const piano = computeRinumerazione(patient, events, settings, patients).filter((r) => r.cambia);
        for (const riga of piano) {
          await updateGoogleCalendarEventDescription(tokenRow.refresh_token, riga.id, riga.descrizioneNuova);
          await new Promise((r) => setTimeout(r, 150));
        }
        rinumerati++;
      }
    } catch (e) {
      return NextResponse.json({ ok: false, risultati, rinumerati, erroreRinumerazione: e.message }, { status: 500 });
    }
  }

  const falliti = risultati.filter((r) => !r.ok);
  return NextResponse.json({
    ok: falliti.length === 0,
    riconnessi: risultati.length - falliti.length,
    falliti: falliti.length,
    rinumerati,
    dettagli: risultati,
  });
}
