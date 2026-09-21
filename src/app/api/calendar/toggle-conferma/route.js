// Cambia solo il colore (confermato/da confermare) di un singolo evento del
// calendario — non tocca titolo, descrizione o orario. confermato:true =
// colore di default (Maurizio ha il default già su blu), confermato:false =
// colorId "6" (Tangerine/mandarino), come deciso per il ripopolamento del
// 2026-09-07/08.

import { rispostaSenzaGoogle, utenteAutenticato } from "@/lib/apiAuth";
import { updateGoogleCalendarEventColor } from "@/lib/googleCalendar";
import { NextResponse } from "next/server";

export async function POST(request) {
  const { supabase, user, errore } = await utenteAutenticato();
  if (errore) return errore;

  const { eventId, confermato } = await request.json().catch(() => ({}));
  if (!eventId) return NextResponse.json({ error: "eventId mancante" }, { status: 400 });

  const { data: tokenRow, error: tokenError } = await supabase
    .from("google_tokens")
    .select("refresh_token")
    .eq("user_id", user.id)
    .single();
  if (tokenError || !tokenRow) {
    return rispostaSenzaGoogle();
  }

  try {
    await updateGoogleCalendarEventColor(tokenRow.refresh_token, eventId, confermato ? null : "6");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
