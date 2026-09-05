// Calcola l'anteprima della rinumerazione sedute su Google Calendar, per un
// singolo paziente (passando patientId) o per tutti i pazienti con un nome
// calendario impostato (patientId assente/null). Non scrive nulla su
// Google: restituisce solo il piano da mostrare per la conferma.

import { createClient } from "@/lib/supabase/server";
import { fetchGoogleCalendarEvents } from "@/lib/googleCalendar";
import { computeRinumerazione, DEFAULT_SETTINGS, todayISO, addDays } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const patientId = body.patientId || null; // assente/null = tutti i pazienti
  const giorniAvanti = Number(body.giorniAvanti) || 90; // orizzonte regolabile per gli eventi futuri

  const [{ data: patients }, { data: settingsRow }, { data: tokenRow, error: tokenError }] = await Promise.all([
    supabase.from("patients").select("*").order("id"),
    supabase.from("settings").select("*").maybeSingle(),
    supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
  ]);

  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }

  const settings = { ...DEFAULT_SETTINGS, ...(settingsRow || {}) };
  const target = patientId
    ? (patients || []).filter((p) => p.id === patientId)
    : (patients || []).filter((p) => p.nome_calendario);

  if (!target.length) {
    return NextResponse.json({ error: "Nessun paziente trovato per questa richiesta." }, { status: 404 });
  }

  const oggi = todayISO();
  // Guarda indietro fino all'ancora_data più vecchia tra i pazienti coinvolti
  // (le sedute già svolte ma non ancora fatturate), in avanti fino
  // all'orizzonte scelto.
  const dataMinima =
    target.reduce((min, p) => (p.ancora_data && (!min || p.ancora_data < min) ? p.ancora_data : min), null) || oggi;
  const dataMassima = addDays(todayISO(), giorniAvanti);

  try {
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, dataMinima, dataMassima);

    const risultato = target
      .map((p) => ({
        pazienteId: p.id,
        nome: p.fatturare_a || p.nome_calendario,
        piano: computeRinumerazione(p, events, settings).filter((r) => r.cambia),
      }))
      .filter((r) => r.piano.length > 0);

    return NextResponse.json({ ok: true, pazienti: risultato, dataMinima, dataMassima });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
