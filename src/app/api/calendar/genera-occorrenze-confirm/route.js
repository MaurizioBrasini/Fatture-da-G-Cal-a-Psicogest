// Crea davvero le occorrenze mancanti confermate in anteprima. Ogni nuovo
// evento nasce come singolo evento app-owned (mai una serie ricorrente
// nativa — vedi istruzioni-claude-code-appuntamenti.md), colorId "6"
// (Tangerine/mandarino, "da confermare": scelta di Maurizio 2026-09-08 per
// ogni nuova occorrenza generata da qui in avanti), descrizione iniziale =
// patients.note se presente (cosi' un promemoria/nota non si perde quando
// l'evento viene creato da zero — mai piu' descrizione vuota di default).

import { createClient } from "@/lib/supabase/server";
import { createGoogleCalendarEvent } from "@/lib/googleCalendar";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { eventi } = await request.json().catch(() => ({}));
  if (!Array.isArray(eventi) || !eventi.length) {
    return NextResponse.json({ error: "Nessun evento da creare." }, { status: 400 });
  }

  const [{ data: tokenRow, error: tokenError }, { data: patients }] = await Promise.all([
    supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
    supabase.from("patients").select("id, nome_calendario, note"),
  ]);
  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }
  const patientsById = Object.fromEntries((patients || []).map((p) => [p.id, p]));

  const risultati = [];
  for (const ev of eventi) {
    const patient = patientsById[ev.patientId];
    try {
      if (!patient) throw new Error("Paziente non trovato");
      await createGoogleCalendarEvent(tokenRow.refresh_token, {
        data: ev.data,
        ora: ev.ora,
        durataMinuti: ev.durataMinuti || 60,
        titolo: patient.nome_calendario,
        descrizione: patient.note || "",
        colorId: "6",
      });
      risultati.push({ patientId: ev.patientId, data: ev.data, ok: true });
    } catch (e) {
      risultati.push({ patientId: ev.patientId, data: ev.data, ok: false, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const falliti = risultati.filter((r) => !r.ok);
  return NextResponse.json({
    ok: falliti.length === 0,
    creati: risultati.length - falliti.length,
    falliti: falliti.length,
    dettagli: risultati,
  });
}
