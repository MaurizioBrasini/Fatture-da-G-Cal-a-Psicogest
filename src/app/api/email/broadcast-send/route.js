// Invia un'email a più pazienti insieme (es. chiusura natalizia, o un
// messaggio personalizzato con [nome]/[data] già sostituiti dal client per
// ciascun destinatario — vedi personalizzaTesto in logic.js). Ogni invio è
// separato (mai CC/BCC che espone gli indirizzi altrui), con una piccola
// pausa tra uno e l'altro per non sforare i limiti di frequenza di Resend.
// Ogni riga finisce in `email_log` (stesso batch_id) sia in caso di
// successo che di errore, per lo storico mostrato in "Comunicazioni".

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, buildBroadcastHtml } from "@/lib/email";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  // Ogni destinatario porta il proprio oggetto/testo già personalizzato
  // (es. [nome]/[data] sostituiti lato client, dove si conosce la prossima
  // data di ciascuno) — il server si limita a inviare quello che riceve.
  const destinatari = (Array.isArray(body.destinatari) ? body.destinatari : []).filter(
    (d) => d && d.patientId && String(d.oggetto || "").trim() && String(d.corpoTesto || "").trim()
  );
  if (!destinatari.length) return NextResponse.json({ error: "Nessun destinatario con oggetto e testo validi." }, { status: 400 });

  const patientIds = destinatari.map((d) => d.patientId);
  const { data: pazienti, error: patientsError } = await supabase
    .from("patients")
    .select("id,nome_calendario,fatturare_a,email")
    .in("id", patientIds);
  if (patientsError) return NextResponse.json({ error: patientsError.message }, { status: 500 });
  const patientsById = Object.fromEntries((pazienti || []).map((p) => [p.id, p]));

  const { data: settings } = await supabase.from("settings").select("*").maybeSingle();

  const conEmail = destinatari.filter((d) => patientsById[d.patientId]?.email);
  if (!conEmail.length) return NextResponse.json({ error: "Nessuno dei destinatari selezionati ha un'email registrata." }, { status: 400 });

  const batchId = randomUUID();
  const risultati = [];

  for (const d of conEmail) {
    const p = patientsById[d.patientId];
    let stato = "ok";
    let errore = null;
    try {
      await sendEmail({ settings, to: p.email, subject: d.oggetto, html: buildBroadcastHtml(d.corpoTesto, settings) });
    } catch (e) {
      stato = "errore";
      errore = e.message;
    }
    await supabase.from("email_log").insert({
      user_id: user.id,
      batch_id: batchId,
      patient_id: p.id,
      email: p.email,
      oggetto: d.oggetto,
      tipo: "broadcast",
      stato,
      errore,
    });
    risultati.push({ patientId: p.id, nome: p.nome_calendario || p.fatturare_a, email: p.email, stato, errore });
    await new Promise((r) => setTimeout(r, 150));
  }

  const senzaEmail = destinatari.length - conEmail.length;
  const fallite = risultati.filter((r) => r.stato === "errore").length;
  return NextResponse.json({
    ok: fallite === 0,
    batchId,
    inviate: risultati.length - fallite,
    fallite,
    senzaEmail,
    dettagli: risultati,
  });
}
