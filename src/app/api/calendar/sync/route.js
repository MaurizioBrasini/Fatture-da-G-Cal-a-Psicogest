import { createClient } from "@/lib/supabase/server";
import { fetchGoogleCalendarEvents } from "@/lib/googleCalendar";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { from, to } = await request.json();
  if (!from || !to) return NextResponse.json({ error: "Intervallo di date mancante" }, { status: 400 });

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
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, from, to);
    return NextResponse.json({ events });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
