import { rispostaSenzaGoogle, utenteAutenticato } from "@/lib/apiAuth";
import { fetchGoogleCalendarEvents } from "@/lib/googleCalendar";
import { NextResponse } from "next/server";

export async function POST(request) {
  const { supabase, user, errore } = await utenteAutenticato();
  if (errore) return errore;

  const { from, to } = await request.json();
  if (!from || !to) return NextResponse.json({ error: "Intervallo di date mancante" }, { status: 400 });

  const { data: tokenRow, error: tokenError } = await supabase
    .from("google_tokens")
    .select("refresh_token")
    .eq("user_id", user.id)
    .single();

  if (tokenError || !tokenRow) {
    return rispostaSenzaGoogle();
  }

  try {
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, from, to);
    return NextResponse.json({ events });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
