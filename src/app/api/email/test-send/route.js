// Invia una prova del messaggio in composizione all'indirizzo email
// dell'utente loggato (mai a un paziente vero) — per controllare l'aspetto
// prima di un invio reale. Non tocca patients/email_log: è un invio
// isolato, non fa parte dello storico "Comunicazioni".

import { createClient } from "@/lib/supabase/server";
import { sendEmail, buildBroadcastHtml } from "@/lib/email";
import { personalizzaTesto, formatDataItaliana, todayISO } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  if (!user.email) return NextResponse.json({ error: "Il tuo account non ha un'email associata." }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const oggetto = String(body.oggetto || "").trim();
  const corpoTesto = String(body.corpoTesto || "").trim();
  if (!oggetto || !corpoTesto) return NextResponse.json({ error: "Oggetto e testo sono obbligatori." }, { status: 400 });

  const { data: settings } = await supabase.from("settings").select("*").maybeSingle();
  const valori = { nome: "Prova", data: formatDataItaliana(todayISO()) };

  try {
    await sendEmail({
      settings,
      to: user.email,
      subject: `[PROVA] ${personalizzaTesto(oggetto, valori)}`,
      html: buildBroadcastHtml(personalizzaTesto(corpoTesto, valori), settings),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, email: user.email });
}
