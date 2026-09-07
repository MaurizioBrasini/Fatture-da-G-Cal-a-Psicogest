// Calcola l'anteprima delle disdette da registrare: scandisce gli eventi
// alla ricerca della nota "disdetto", esclude quelle già registrate in
// `cancellations` (patient_id+data), e calcola per ciascuna il billing_status
// (charged/not_charged) dalla soglia di preavviso di 48h. Non scrive nulla:
// solo il piano da mostrare per la conferma.

import { createClient } from "@/lib/supabase/server";
import { fetchGoogleCalendarEvents } from "@/lib/googleCalendar";
import { computeAggiornamentoPreview, todayISO, addDays } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  // Indietro: eventuali disdette non ancora registrate su giorni passati.
  // Avanti: disdette scritte oggi su appuntamenti futuri (chi disdice con
  // anticipo va rimosso subito, non aspetta che la data arrivi).
  const giorniIndietro = Number(body.giorniIndietro) || 30;
  const giorniAvanti = Number(body.giorniAvanti) || 60;

  const [{ data: patients }, { data: tokenRow, error: tokenError }, { data: cancellazioni }] = await Promise.all([
    supabase.from("patients").select("*").order("id"),
    supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
    supabase.from("cancellations").select("patient_id, original_date").eq("user_id", user.id),
  ]);

  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }

  const dataMinima = addDays(todayISO(), -giorniIndietro);
  const dataMassima = addDays(todayISO(), giorniAvanti);

  try {
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, dataMinima, dataMassima);
    const candidati = computeAggiornamentoPreview(events, patients || [], cancellazioni || []);
    return NextResponse.json({ ok: true, candidati, dataMinima, dataMassima });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
