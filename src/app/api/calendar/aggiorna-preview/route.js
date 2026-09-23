// Calcola l'anteprima delle disdette da registrare: scandisce gli eventi
// alla ricerca della nota "disdetto", esclude quelle già registrate in
// `cancellations` (patient_id+data), e calcola per ciascuna il billing_status
// (charged/not_charged) dalla soglia di preavviso di 48h. Non scrive nulla:
// solo il piano da mostrare per la conferma.

import { rispostaSenzaGoogle, utenteAutenticato } from "@/lib/apiAuth";
import { fetchGoogleCalendarEvents } from "@/lib/googleCalendar";
import { computeAggiornamentoPreview, computeDuplicatiDaRipulire, computeIncassiContantiDaRegistrare, todayISO, addDays } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const { supabase, user, errore } = await utenteAutenticato();
  if (errore) return errore;

  const body = await request.json().catch(() => ({}));
  // Indietro: eventuali disdette non ancora registrate su giorni passati.
  // Avanti: disdette scritte oggi su appuntamenti futuri (chi disdice con
  // anticipo va rimosso subito, non aspetta che la data arrivi).
  const giorniIndietro = Number(body.giorniIndietro) || 30;
  const giorniAvanti = Number(body.giorniAvanti) || 60;

  const [{ data: patients }, { data: tokenRow, error: tokenError }, { data: cancellazioni }, { data: cancellazioniNotCharged }, { data: pagamentiContante }] = await Promise.all([
    supabase.from("patients").select("*").order("id"),
    supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
    supabase.from("cancellations").select("patient_id, original_date").eq("user_id", user.id),
    supabase.from("cancellations").select("patient_id, original_date, billing_status").eq("user_id", user.id).eq("billing_status", "not_charged"),
    supabase.from("contante_pagamenti").select("patient_id, data"),
  ]);

  if (tokenError || !tokenRow) {
    return rispostaSenzaGoogle();
  }

  const dataMinima = addDays(todayISO(), -giorniIndietro);
  const dataMassima = addDays(todayISO(), giorniAvanti);

  try {
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, dataMinima, dataMassima);
    const candidati = computeAggiornamentoPreview(events, patients || [], cancellazioni || []);
    const duplicati = computeDuplicatiDaRipulire(events, patients || [], cancellazioniNotCharged || []);
    const incassi = computeIncassiContantiDaRegistrare(events, patients || [], pagamentiContante || []);
    return NextResponse.json({ ok: true, candidati, duplicati, incassi, dataMinima, dataMassima });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
