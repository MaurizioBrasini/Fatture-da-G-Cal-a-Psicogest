// Manda davvero le email di riprenotazione confermate dall'anteprima. Una
// per paziente (già deduplicate a monte da computeRiprenotazioniPendenti),
// ognuna loggata in email_log — stessa idempotenza "a tempo" usata in
// anteprima: una volta loggata con successo, non ricompare più finché non
// arriva una nuova disdetta per quel paziente.

import { createClient } from "@/lib/supabase/server";
import { sendEmail, buildEmailRiprenotazioneHtml } from "@/lib/email";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const candidati = Array.isArray(body.candidati) ? body.candidati : [];
  if (!candidati.length) return NextResponse.json({ error: "Nessun destinatario selezionato." }, { status: 400 });

  const { data: settings } = await supabase.from("settings").select("*").maybeSingle();
  if (!settings?.link_prenotazioni_online) {
    return NextResponse.json({ error: "Link prenotazioni non impostato in Impostazioni." }, { status: 400 });
  }

  const oggetto = "Prenota il tuo prossimo appuntamento";
  const risultati = [];
  for (const c of candidati) {
    let stato = "ok";
    let errore = null;
    try {
      await sendEmail({
        settings,
        to: c.email,
        subject: oggetto,
        html: buildEmailRiprenotazioneHtml({ nomePaziente: c.nome, linkPrenotazioni: settings.link_prenotazioni_online }),
      });
    } catch (e) {
      stato = "errore";
      errore = e.message;
    }
    await supabase.from("email_log").insert({
      user_id: user.id,
      patient_id: c.patientId,
      email: c.email,
      oggetto,
      tipo: "riprenotazione",
      stato,
      errore,
    });
    risultati.push({ patientId: c.patientId, nome: c.nome, stato, errore });
    await new Promise((r) => setTimeout(r, 150));
  }

  const fallite = risultati.filter((r) => r.stato === "errore").length;
  return NextResponse.json({ ok: fallite === 0, inviate: risultati.length - fallite, fallite, dettagli: risultati });
}
