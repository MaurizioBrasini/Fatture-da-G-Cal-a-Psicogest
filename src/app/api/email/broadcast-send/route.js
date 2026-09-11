// Invia un'email a più pazienti insieme (es. chiusura natalizia). Ogni
// invio è separato (mai CC/BCC che espone gli indirizzi altrui), con una
// piccola pausa tra uno e l'altro per non sforare i limiti di frequenza di
// Resend. Ogni riga finisce in `email_log` (stesso batch_id) sia in caso di
// successo che di errore, per lo storico mostrato in "Comunicazioni".

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, testoInHtml } from "@/lib/email";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const oggetto = String(body.oggetto || "").trim();
  const corpoTesto = String(body.corpoTesto || "").trim();
  const patientIds = Array.isArray(body.patientIds) ? body.patientIds : [];
  if (!oggetto || !corpoTesto) return NextResponse.json({ error: "Oggetto e testo sono obbligatori." }, { status: 400 });
  if (!patientIds.length) return NextResponse.json({ error: "Nessun destinatario selezionato." }, { status: 400 });

  const [{ data: settings }, { data: pazienti, error: patientsError }] = await Promise.all([
    supabase.from("settings").select("*").maybeSingle(),
    supabase.from("patients").select("id,nome_calendario,fatturare_a,email").in("id", patientIds),
  ]);
  if (patientsError) return NextResponse.json({ error: patientsError.message }, { status: 500 });

  const conEmail = (pazienti || []).filter((p) => p.email);
  if (!conEmail.length) return NextResponse.json({ error: "Nessuno dei destinatari selezionati ha un'email registrata." }, { status: 400 });

  const html = testoInHtml(corpoTesto);
  const batchId = randomUUID();
  const risultati = [];

  for (const p of conEmail) {
    let stato = "ok";
    let errore = null;
    try {
      await sendEmail({ settings, to: p.email, subject: oggetto, html });
    } catch (e) {
      stato = "errore";
      errore = e.message;
    }
    await supabase.from("email_log").insert({
      user_id: user.id,
      batch_id: batchId,
      patient_id: p.id,
      email: p.email,
      oggetto,
      tipo: "broadcast",
      stato,
      errore,
    });
    risultati.push({ patientId: p.id, nome: p.nome_calendario || p.fatturare_a, email: p.email, stato, errore });
    await new Promise((r) => setTimeout(r, 150));
  }

  const senzaEmail = (pazienti || []).length - conEmail.length;
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
