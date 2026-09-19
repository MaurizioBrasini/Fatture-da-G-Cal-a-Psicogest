// Elenco delle chiusure calendario registrate (correnti e future), per poterle
// modificare o eliminare dall'app.
//
// Recupero delle chiusure storiche: quelle registrate prima che esistesse la
// tabella calendar_closures hanno solo righe sparse in slot_closures (senza
// finestra né collegamento) e un evento "Indisponibile…" su Google Calendar.
// Ad ogni caricamento gli eventi di chiusura presenti sul calendario e non
// ancora tracciati vengono quindi registrati in calendar_closures (la finestra
// si legge dall'evento stesso) e le righe orfane di slot_closures che cadono
// nella loro finestra, con la stessa nota, vengono collegate. È idempotente:
// dopo il primo giro non c'è più nulla da recuperare. Se Google non risponde
// si mostra comunque l'elenco già in database, segnalando l'errore.

import { createClient } from "@/lib/supabase/server";
import { listChiusuraBlockEvents } from "@/lib/googleCalendar";
import { chiusuraDentroFinestra, todayISO, addDays } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const oggi = todayISO();
  let recuperoErrore = null;

  const { data: tokenRow } = await supabase
    .from("google_tokens")
    .select("refresh_token")
    .eq("user_id", user.id)
    .single();

  if (tokenRow) {
    try {
      const [{ data: tracciate, error: tracciateError }, { data: orfane, error: orfaneError }] = await Promise.all([
        supabase.from("calendar_closures").select("google_event_id"),
        supabase.from("slot_closures").select("*").is("closure_id", null),
      ]);
      if (tracciateError || orfaneError) {
        throw new Error((tracciateError || orfaneError).message + " (hai eseguito schema_addendum14.sql?)");
      }

      const eventiTracciati = new Set((tracciate || []).map((c) => c.google_event_id).filter(Boolean));
      const eventi = await listChiusuraBlockEvents(tokenRow.refresh_token, addDays(oggi, -1), addDays(oggi, 730));
      let righeLibere = orfane || [];

      for (const ev of eventi) {
        if (eventiTracciati.has(ev.id)) continue;
        const { data: nuova, error: insertError } = await supabase
          .from("calendar_closures")
          .insert({
            user_id: user.id,
            data_inizio: ev.dataInizio,
            ora_inizio: ev.oraInizio,
            data_fine: ev.dataFine,
            ora_fine: ev.oraFine,
            note: ev.note,
            google_event_id: ev.id,
          })
          .select("id")
          .single();
        if (insertError || !nuova) throw new Error(insertError?.message || "recupero chiusura fallito");

        const finestra = { dataInizio: ev.dataInizio, oraInizio: ev.oraInizio, dataFine: ev.dataFine, oraFine: ev.oraFine };
        const daCollegare = righeLibere.filter((r) => (r.note || null) === ev.note && chiusuraDentroFinestra(r, finestra));
        if (daCollegare.length) {
          const { error: linkError } = await supabase
            .from("slot_closures")
            .update({ closure_id: nuova.id })
            .in("id", daCollegare.map((r) => r.id));
          if (linkError) throw new Error(linkError.message);
          const collegate = new Set(daCollegare.map((r) => r.id));
          righeLibere = righeLibere.filter((r) => !collegate.has(r.id));
        }
      }
    } catch (e) {
      recuperoErrore = e.message;
    }
  }

  const { data: chiusure, error } = await supabase
    .from("calendar_closures")
    .select("*")
    .gte("data_fine", oggi)
    .order("data_inizio", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message + " (hai eseguito schema_addendum14.sql?)" }, { status: 500 });
  }

  const ids = (chiusure || []).map((c) => c.id);
  const fasce = {};
  if (ids.length) {
    const { data: righe } = await supabase.from("slot_closures").select("closure_id").in("closure_id", ids);
    for (const r of righe || []) fasce[r.closure_id] = (fasce[r.closure_id] || 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    chiusure: (chiusure || []).map((c) => ({
      id: c.id,
      dataInizio: c.data_inizio,
      oraInizio: c.ora_inizio ? c.ora_inizio.slice(0, 5) : null,
      dataFine: c.data_fine,
      oraFine: c.ora_fine ? c.ora_fine.slice(0, 5) : null,
      note: c.note,
      haEventoGoogle: Boolean(c.google_event_id),
      fasceChiuse: fasce[c.id] || 0,
    })),
    recuperoErrore,
  });
}
