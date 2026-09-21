// Applica davvero la modifica o l'eliminazione di una chiusura confermata in
// anteprima (vedi chiusura-modifica-preview). Come per la registrazione, cancella
// SOLO gli eventi "da confermare" scelti dall'utente — mai un evento già
// confermato col paziente o prenotato online. Le occorrenze corrette non
// vengono create qui: si rilancia "Genera occorrenze future".
//
// Ordine delle scritture, pensato perché un errore a metà non lasci la
// chiusura in uno stato incoerente:
// - modifica: prima si crea il NUOVO evento "occupato" su Google (se fallisce
//   non è cambiato nulla), poi si aggiorna il record e si inseriscono le
//   righe nuove (con rollback se falliscono), e solo alla fine si tolgono le
//   righe vecchie e il vecchio evento — un evento vecchio rimasto per errore
//   viene segnalato, non è un errore bloccante.
// - elimina: prima si cancella l'evento su Google (se fallisce non è cambiato
//   nulla e si può riprovare), poi le righe e infine il record.

import { rispostaSenzaGoogle, utenteAutenticato } from "@/lib/apiAuth";
import { deleteGoogleCalendarEvent, createChiusuraBlockEvent } from "@/lib/googleCalendar";
import { titoloChiusura } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const { supabase, user, errore } = await utenteAutenticato();
  if (errore) return errore;

  const { id, azione, righeFinali, cancellazioni, dataInizio, oraInizio, dataFine, oraFine, note } = await request
    .json()
    .catch(() => ({}));
  if (!id || (azione !== "modifica" && azione !== "elimina")) {
    return NextResponse.json({ error: "Richiesta non valida." }, { status: 400 });
  }
  if (azione === "modifica" && (!dataInizio || !dataFine || dataFine < dataInizio)) {
    return NextResponse.json({ error: "Intervallo di date non valido." }, { status: 400 });
  }

  const [{ data: chiusura }, { data: righeVecchie }, { data: tokenRow, error: tokenError }] = await Promise.all([
    supabase.from("calendar_closures").select("*").eq("id", id).single(),
    supabase.from("slot_closures").select("id").eq("closure_id", id),
    supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
  ]);
  if (!chiusura) return NextResponse.json({ error: "Chiusura non trovata." }, { status: 404 });
  if (tokenError || !tokenRow) {
    return rispostaSenzaGoogle();
  }
  const token = tokenRow.refresh_token;
  const idRigheVecchie = (righeVecchie || []).map((r) => r.id);

  let vecchioEventoErrore = null;

  if (azione === "elimina") {
    if (chiusura.google_event_id) {
      try {
        await deleteGoogleCalendarEvent(token, chiusura.google_event_id);
      } catch (e) {
        return NextResponse.json(
          { error: "Non sono riuscito a cancellare l'evento \"occupato\" dal calendario, la chiusura è rimasta com'era: " + e.message },
          { status: 500 }
        );
      }
    }
    if (idRigheVecchie.length) {
      const { error } = await supabase.from("slot_closures").delete().in("id", idRigheVecchie);
      if (error) return NextResponse.json({ error: "Errore nel togliere le fasce chiuse: " + error.message }, { status: 500 });
    }
    const { error } = await supabase.from("calendar_closures").delete().eq("id", id);
    if (error) return NextResponse.json({ error: "Errore nell'eliminare la chiusura: " + error.message }, { status: 500 });
  } else {
    // 1. nuovo evento "occupato"
    let nuovoEventoId = null;
    let bloccoErrore = null;
    try {
      const evento = await createChiusuraBlockEvent(token, {
        dataInizio,
        oraInizio: oraInizio || null,
        dataFine,
        oraFine: oraFine || null,
        titolo: titoloChiusura(note),
      });
      nuovoEventoId = evento.id;
    } catch (e) {
      bloccoErrore = e.message;
    }
    if (!nuovoEventoId) {
      return NextResponse.json(
        { error: "Non sono riuscito a creare il nuovo evento \"occupato\" sul calendario, la chiusura è rimasta com'era: " + bloccoErrore },
        { status: 500 }
      );
    }

    const rollback = async () => {
      await supabase
        .from("calendar_closures")
        .update({
          data_inizio: chiusura.data_inizio,
          ora_inizio: chiusura.ora_inizio,
          data_fine: chiusura.data_fine,
          ora_fine: chiusura.ora_fine,
          note: chiusura.note,
          google_event_id: chiusura.google_event_id,
        })
        .eq("id", id);
      try {
        await deleteGoogleCalendarEvent(token, nuovoEventoId);
      } catch {}
    };

    // 2. record aggiornato
    const { error: updError } = await supabase
      .from("calendar_closures")
      .update({
        data_inizio: dataInizio,
        ora_inizio: oraInizio || null,
        data_fine: dataFine,
        ora_fine: oraFine || null,
        note: note || null,
        google_event_id: nuovoEventoId,
      })
      .eq("id", id);
    if (updError) {
      try {
        await deleteGoogleCalendarEvent(token, nuovoEventoId);
      } catch {}
      return NextResponse.json({ error: "Errore nell'aggiornare la chiusura: " + updError.message }, { status: 500 });
    }

    // 3. righe nuove (finali), poi tolte quelle vecchie
    if (Array.isArray(righeFinali) && righeFinali.length) {
      const { error: insError } = await supabase.from("slot_closures").insert(
        righeFinali.map((r) => ({
          user_id: user.id,
          weekday: r.weekday,
          time_of_day: r.time_of_day,
          closure_date: r.closure_date,
          note: note || null,
          closure_id: id,
        }))
      );
      if (insError) {
        await rollback();
        return NextResponse.json({ error: "Errore nel salvare le fasce chiuse, la chiusura è rimasta com'era: " + insError.message }, { status: 500 });
      }
    }
    if (idRigheVecchie.length) {
      const { error } = await supabase.from("slot_closures").delete().in("id", idRigheVecchie);
      if (error) return NextResponse.json({ error: "Errore nel togliere le vecchie fasce chiuse: " + error.message }, { status: 500 });
    }

    // 4. vecchio evento "occupato"
    if (chiusura.google_event_id) {
      try {
        await deleteGoogleCalendarEvent(token, chiusura.google_event_id);
      } catch (e) {
        vecchioEventoErrore = e.message;
      }
    }
  }

  const risultati = [];
  for (const c of cancellazioni || []) {
    try {
      await deleteGoogleCalendarEvent(token, c.eventId);
      risultati.push({ eventId: c.eventId, ok: true });
    } catch (e) {
      risultati.push({ eventId: c.eventId, ok: false, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const falliti = risultati.filter((r) => !r.ok);
  return NextResponse.json({
    ok: falliti.length === 0 && !vecchioEventoErrore,
    azione,
    fasceChiuse: azione === "elimina" ? 0 : (righeFinali || []).length,
    cancellati: risultati.length - falliti.length,
    falliti: falliti.length,
    vecchioEventoErrore,
    dettagli: risultati,
  });
}
