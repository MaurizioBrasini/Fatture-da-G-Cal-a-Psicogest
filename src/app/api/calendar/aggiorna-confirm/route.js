// Registra davvero le disdette confermate. Riceve esattamente la lista già
// calcolata e mostrata in anteprima (billing_status incluso l'eventuale
// override manuale fatto dall'utente in anteprima, che sovrascrive il
// calcolo automatico delle 48h), come per la rinumerazione. Per ciascuna,
// nell'ordine che conta per non perdere dati:
// 1) scrive la riga in `cancellations` (se già presente per patient_id+data,
//    la salta senza errore: idempotenza lato database);
// 2) SOLO se billing_status = not_charged E la riga non è "manuale", rimuove
//    l'evento dal calendario per liberare lo slot. Le righe manuali (`c.manual`)
//    sono disdette il cui evento è già stato eliminato a mano dall'utente
//    direttamente su Google Calendar — non hanno un evento reale da cancellare
//    (e non passano dalla scansione delle note "disdetto"). Le buche (charged,
//    non manuali) restano a calendario per pulizia storica — il conteggio non
//    dipende più dalla loro presenza.

import { createClient } from "@/lib/supabase/server";
import { deleteGoogleCalendarEvent } from "@/lib/googleCalendar";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { candidati } = await request.json().catch(() => ({}));
  if (!Array.isArray(candidati) || !candidati.length) {
    return NextResponse.json({ error: "Nessuna disdetta da registrare." }, { status: 400 });
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

  const risultati = [];
  for (const c of candidati) {
    try {
      const { error: insertError } = await supabase.from("cancellations").insert({
        user_id: user.id,
        patient_id: c.patientId,
        event_id: c.eventId,
        original_date: c.data,
        cancelled_at: c.cancelledAt,
        billing_status: c.billingStatus,
      });
      // 23505 = violazione unique(patient_id, original_date): già registrata
      // in un giro precedente — non è un errore, si salta la scrittura ma si
      // procede comunque all'eventuale rimozione dell'evento.
      if (insertError && insertError.code !== "23505") throw new Error(insertError.message);

      if (c.billingStatus === "not_charged" && !c.manual) {
        await deleteGoogleCalendarEvent(tokenRow.refresh_token, c.eventId);
      }
      risultati.push({ eventId: c.eventId, ok: true });
    } catch (e) {
      risultati.push({ eventId: c.eventId, ok: false, error: e.message });
    }
    // piccola pausa tra un'operazione e l'altra, per non sforare i limiti di
    // frequenza imposti da Google sulle chiamate API
    await new Promise((r) => setTimeout(r, 150));
  }

  const falliti = risultati.filter((r) => !r.ok);
  return NextResponse.json({
    ok: falliti.length === 0,
    registrati: risultati.length - falliti.length,
    falliti: falliti.length,
    dettagli: risultati,
  });
}
