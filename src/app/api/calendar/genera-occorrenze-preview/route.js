// Calcola l'anteprima delle occorrenze future MANCANTI sul calendario, per
// tutti i pazienti con patient_slot attivo: usa occorrenzeFuture (stessa
// logica del motore appuntamenti) per sapere quali date dovrebbero esistere
// entro l'orizzonte scelto, poi scarta quelle che hanno gia' un evento reale
// abbinato (matchPatientForEvent) — cosi' rilanciarlo ogni settimana genera
// solo la fascia nuova, mai duplicati. Non scrive nulla: solo l'anteprima.

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
  const giorniAvanti = Number(body.giorniAvanti) || 45;

  const [{ data: slots }, { data: patients }, { data: closures }, { data: skipped }, { data: tokenRow, error: tokenError }] = await Promise.all([
    supabase.from("patient_slots").select("*").eq("active", true),
    supabase.from("patients").select("*"),
    supabase.from("slot_closures").select("*"),
    supabase.from("skipped_occurrences").select("patient_id, data"),
    supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
  ]);
  const skippedSet = new Set((skipped || []).map((s) => `${s.patient_id}|${s.data}`));

  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }

  const patientsById = Object.fromEntries((patients || []).map((p) => [p.id, p]));
  const oggi = todayISO();
  const dataMassima = addDays(oggi, giorniAvanti);

  try {
    // Orizzonte di lettura leggermente piu' ampio all'indietro, per essere
    // sicuri di intercettare eventi gia' generati anche se con qualche
    // giorno di scarto rispetto alla data "grezza" attesa (chiusure ecc.).
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, addDays(oggi, -14), dataMassima);

    const risultato = [];
    for (const slot of slots || []) {
      const patient = patientsById[slot.patient_id];
      if (!patient || !patient.nome_calendario) continue;

      const date = occorrenzeFuture(slot, closures || [], giorniAvanti, oggi);
      // Mai rigenerare la data di oggi: se manca, è perché la seduta di oggi
      // è già stata gestita (svolta o disdetta), non un buco da riempire.
      const mancanti = date
        .filter((d) => d > oggi)
        .filter((d) => !events.some((e) => e.data === d && matchPatientForEvent(e.titolo, [patient])))
        .filter((d) => !skippedSet.has(`${patient.id}|${d}`));
      if (!mancanti.length) continue;

      // Durata: prende quella dell'evento reale piu' recente di questo
      // paziente, se lo trova (per non alterare sedute piu' lunghe del
      // solito, es. coppie/consulenze), altrimenti 60 minuti di default.
      const eventoRecente = events
        .filter((e) => matchPatientForEvent(e.titolo, [patient]) && e.ora)
        .sort((a, b) => (a.data < b.data ? 1 : -1))[0];
      const durataMinuti = eventoRecente?.durataMinuti || 60;

      risultato.push({
        patientId: patient.id,
        nome: patient.nome_calendario || patient.fatturare_a,
        ora: slot.time_of_day.slice(0, 5),
        durataMinuti,
        date: mancanti,
      });
    }

    return NextResponse.json({ ok: true, pazienti: risultato, dataMassima });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
