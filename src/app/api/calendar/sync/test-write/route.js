// Route di TEST — verifica che il permesso di scrittura su Google Calendar
// funzioni davvero, prima di costruire la funzione vera di rinumerazione.
//
// Trova il prossimo evento futuro (qualsiasi esso sia) e aggiunge in cima
// alla sua nota il testo "[TEST APP OK] " — senza cancellare nulla del
// resto della nota (link Meet/Zoom, promemoria, ecc.). Non tocca il titolo
// né l'orario dell'evento, solo la nota.
//
// Dopo aver chiamato questa route, controlla su Google Calendar (telefono o
// browser) che il prossimo appuntamento in agenda abbia davvero quel testo
// in cima alla nota. Se sì, il permesso di scrittura funziona correttamente
// e possiamo procedere con la funzione completa. Puoi poi rimuovere quel
// testo di prova a mano, modificando l'evento su Google Calendar.
//
// Da CANCELLARE (questo file) una volta terminato il test.

import { createClient } from "@/lib/supabase/server";
import { fetchGoogleCalendarEvents, updateGoogleCalendarEventDescription } from "@/lib/googleCalendar";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

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
    // Cerca nei prossimi 30 giorni, prende il primo evento con orario (data
    // e ora) che sia effettivamente nel futuro rispetto a adesso.
    const oggi = new Date().toISOString().slice(0, 10);
    const fra30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, oggi, fra30);

    const adesso = new Date();
    const prossimo = events
      .filter((e) => e.ora) // scarta eventi "tutto il giorno", vogliamo uno con orario preciso
      .map((e) => ({ ...e, quando: new Date(`${e.data}T${e.ora}:00`) }))
      .filter((e) => e.quando > adesso)
      .sort((a, b) => a.quando - b.quando)[0];

    if (!prossimo) {
      return NextResponse.json({ error: "Nessun evento futuro trovato nei prossimi 30 giorni." }, { status: 404 });
    }

    const nuovaDescrizione = `[TEST APP OK] ${prossimo.descrizione || ""}`;
    await updateGoogleCalendarEventDescription(tokenRow.refresh_token, prossimo.id, nuovaDescrizione);

    return NextResponse.json({
      ok: true,
      evento: prossimo.titolo,
      data: prossimo.data,
      ora: prossimo.ora,
      descrizioneOriginale: prossimo.descrizione,
      descrizioneNuova: nuovaDescrizione,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
