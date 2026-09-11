// Anteprima "riprenotazioni da confermare": pazienti con una disdetta
// registrata (in `cancellations`, qualunque billing_status) per cui non è
// ancora stata mandata un'email di riprenotazione — vedi
// computeRiprenotazioniPendenti in logic.js per i dettagli del confronto sui
// timestamp. Non scrive nulla.

import { createClient } from "@/lib/supabase/server";
import { computeRiprenotazioniPendenti, addDays, todayISO } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const giorniIndietro = Number(body.giorniIndietro) || 30;
  const dataMinima = addDays(todayISO(), -giorniIndietro);

  const [{ data: cancellazioni, error: cancError }, { data: patients, error: patientsError }, { data: emailLog, error: logError }] =
    await Promise.all([
      supabase.from("cancellations").select("patient_id, original_date, billing_status, created_at").gte("original_date", dataMinima),
      supabase.from("patients").select("id, nome_calendario, fatturare_a, email"),
      supabase.from("email_log").select("patient_id, created_at").eq("tipo", "riprenotazione").eq("stato", "ok"),
    ]);
  if (cancError) return NextResponse.json({ error: cancError.message }, { status: 500 });
  if (patientsError) return NextResponse.json({ error: patientsError.message }, { status: 500 });
  if (logError) return NextResponse.json({ error: logError.message }, { status: 500 });

  const candidati = computeRiprenotazioniPendenti(cancellazioni || [], patients || [], emailLog || []);
  return NextResponse.json({ ok: true, candidati });
}
