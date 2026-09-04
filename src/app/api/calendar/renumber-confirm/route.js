// Scrive davvero le nuove note sugli eventi del calendario. Riceve esattamente
// la lista già calcolata e mostrata in anteprima (non ricalcola nulla), per
// essere sicuri che quello che viene scritto sia proprio quello che l'utente
// ha visto e confermato.

import { createClient } from "@/lib/supabase/server";
import { updateGoogleCalendarEventDescription } from "@/lib/googleCalendar";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { aggiornamenti } = await request.json().catch(() => ({}));
  if (!Array.isArray(aggiornamenti) || !aggiornamenti.length) {
    return NextResponse.json({ error: "Nessun aggiornamento da scrivere." }, { status: 400 });
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
  for (const upd of aggiornamenti) {
    try {
      await updateGoogleCalendarEventDescription(tokenRow.refresh_token, upd.id, upd.descrizioneNuova);
      risultati.push({ id: upd.id, ok: true });
    } catch (e) {
      risultati.push({ id: upd.id, ok: false, error: e.message });
    }
    // piccola pausa tra una scrittura e l'altra, per non sforare i limiti
    // di frequenza imposti da Google sulle chiamate API
    await new Promise((r) => setTimeout(r, 150));
  }

  const falliti = risultati.filter((r) => !r.ok);
  return NextResponse.json({
    ok: falliti.length === 0,
    scritti: risultati.length - falliti.length,
    falliti: falliti.length,
    dettagli: risultati,
  });
}
