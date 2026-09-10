// Applica davvero una chiusura confermata in anteprima: inserisce le righe
// slot_closures (una per fascia weekday+ora coinvolta), crea l'evento
// "occupato" corrispondente sul calendario reale (indispensabile perché la
// pagina di prenotazione online smetta di proporre quegli slot — vedi
// createChiusuraBlockEvent) e cancella SOLO gli eventi "da confermare"
// scelti dall'utente — mai un evento già confermato col paziente o
// prenotato online, quelli restano sempre a carico di Maurizio. Le
// occorrenze corrette (sulle nuove date slittate) NON vengono create qui:
// basta rilanciare "Genera occorrenze future" come al solito dopo aver
// ripulito quelle obsolete.

import { createClient } from "@/lib/supabase/server";
import { deleteGoogleCalendarEvent, createChiusuraBlockEvent } from "@/lib/googleCalendar";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { nuoveChiusure, cancellazioni, dataInizio, oraInizio, dataFine, oraFine, note } = await request.json().catch(() => ({}));
  if (!Array.isArray(nuoveChiusure) || !nuoveChiusure.length) {
    return NextResponse.json({ error: "Nessuna chiusura da registrare." }, { status: 400 });
  }
  if (!dataInizio || !dataFine) {
    return NextResponse.json({ error: "Intervallo di date mancante." }, { status: 400 });
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

  const { error: insertError } = await supabase.from("slot_closures").insert(
    nuoveChiusure.map((c) => ({
      user_id: user.id,
      weekday: c.weekday,
      time_of_day: c.time_of_day,
      closure_date: c.closure_date,
      note: c.note || null,
    }))
  );
  if (insertError) {
    return NextResponse.json({ error: "Errore nel salvare la chiusura: " + insertError.message }, { status: 500 });
  }

  let bloccoCreato = true;
  let bloccoErrore = null;
  try {
    await createChiusuraBlockEvent(tokenRow.refresh_token, {
      dataInizio,
      oraInizio: oraInizio || null,
      dataFine,
      oraFine: oraFine || null,
      titolo: note ? `Indisponibile — ${note}` : "Indisponibile",
    });
  } catch (e) {
    bloccoCreato = false;
    bloccoErrore = e.message;
  }

  const risultati = [];
  for (const c of cancellazioni || []) {
    try {
      await deleteGoogleCalendarEvent(tokenRow.refresh_token, c.eventId);
      risultati.push({ eventId: c.eventId, ok: true });
    } catch (e) {
      risultati.push({ eventId: c.eventId, ok: false, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const falliti = risultati.filter((r) => !r.ok);
  return NextResponse.json({
    ok: falliti.length === 0 && bloccoCreato,
    chiuse: nuoveChiusure.length,
    cancellati: risultati.length - falliti.length,
    falliti: falliti.length,
    bloccoCreato,
    bloccoErrore,
    dettagli: risultati,
  });
}
