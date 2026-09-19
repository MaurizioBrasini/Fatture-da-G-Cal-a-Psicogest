// Anteprima della modifica o dell'eliminazione di una chiusura già registrata
// (calendar_closures). Non scrive nulla su calendario o database.
//
// azione "modifica": nuova finestra (dataInizio/oraInizio/dataFine/oraFine) e
// nuova nota. Le righe di slot_closures della chiusura ancora dentro la nuova
// finestra restano (anche se l'appuntamento reale che le aveva generate è
// stato cancellato proprio da questa chiusura), quelle fuori vengono tolte, e
// i nuovi appuntamenti reali che cadono nella parte aggiunta della finestra
// generano righe nuove — vedi calcolaRigheChiusuraModificata.
// azione "elimina": tutte le righe della chiusura vengono tolte.
//
// In entrambi i casi le date "liberate" o "spostate" cambiano il ricalcolo
// delle occorrenze: computeImpattoChiusura propone di cancellare gli eventi
// "da confermare" rimasti sulle date che non sono più corrette (es. quelli
// slittati dalla chiusura originale) e segnala quelli già confermati.

import { createClient } from "@/lib/supabase/server";
import { fetchGoogleCalendarEvents } from "@/lib/googleCalendar";
import {
  rilevaConflittiChiusura,
  computeImpattoChiusura,
  calcolaRigheChiusuraModificata,
  todayISO,
  addDays,
} from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { id, azione, dataInizio, oraInizio, dataFine, oraFine, note } = body;
  const giorniAvanti = Number(body.giorniAvanti) || 120;
  if (!id || (azione !== "modifica" && azione !== "elimina")) {
    return NextResponse.json({ error: "Richiesta non valida." }, { status: 400 });
  }
  if (azione === "modifica" && (!dataInizio || !dataFine || dataFine < dataInizio)) {
    return NextResponse.json({ error: "Intervallo di date non valido." }, { status: 400 });
  }

  const [
    { data: chiusura },
    { data: righeVecchie },
    { data: altreRighe },
    { data: patientSlots },
    { data: patients },
    { data: tokenRow, error: tokenError },
  ] = await Promise.all([
    supabase.from("calendar_closures").select("id").eq("id", id).single(),
    supabase.from("slot_closures").select("*").eq("closure_id", id),
    supabase.from("slot_closures").select("*").or(`closure_id.is.null,closure_id.neq.${id}`),
    supabase.from("patient_slots").select("*").eq("active", true),
    supabase.from("patients").select("*"),
    supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
  ]);

  if (!chiusura) return NextResponse.json({ error: "Chiusura non trovata." }, { status: 404 });
  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }

  const oggi = todayISO();
  const dataMassima = addDays(oggi, giorniAvanti);

  try {
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, oggi, dataMassima);

    let conflittiNuovi = [];
    let finestra = null;
    if (azione === "modifica") {
      finestra = { dataInizio, oraInizio: oraInizio || null, dataFine, oraFine: oraFine || null };
      const chiaveRiga = (r) => `${r.weekday}|${r.time_of_day}|${r.closure_date}`;
      const dellAltre = new Set((altreRighe || []).map(chiaveRiga));
      conflittiNuovi = rilevaConflittiChiusura(patientSlots || [], patients || [], events, { ...finestra, note }).filter(
        (c) => !dellAltre.has(chiaveRiga(c))
      );
    }

    const { tenute, rimosse, aggiunte } = calcolaRigheChiusuraModificata(righeVecchie || [], conflittiNuovi, finestra);
    const righeFinali = [...tenute, ...aggiunte].map((r) => ({
      weekday: r.weekday,
      time_of_day: r.time_of_day,
      closure_date: r.closure_date,
      note: note || null,
    }));

    let impatto = { daCancellare: [], daVerificare: [], alternanzaCoinvolta: [] };
    if (rimosse.length || aggiunte.length) {
      const closureComplete = [...(altreRighe || []), ...righeFinali];
      impatto = computeImpattoChiusura(
        patientSlots || [],
        patients || [],
        events,
        closureComplete,
        [...rimosse, ...aggiunte],
        giorniAvanti,
        oggi
      );
    }

    return NextResponse.json({
      ok: true,
      righeFinali,
      tenute: tenute.length,
      rimosse: rimosse.map((r) => ({ closure_date: r.closure_date, time_of_day: r.time_of_day })),
      aggiunte: aggiunte.map((r) => ({
        closure_date: r.closure_date,
        time_of_day: r.time_of_day,
        nome: r.nome || null,
      })),
      ...impatto,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
