// Calcola l'anteprima delle occorrenze future MANCANTI sul calendario, per
// tutti i pazienti con patient_slot attivo (vedi leggiPianoOccorrenze): scarta
// le date che hanno già un evento reale, quindi rilanciarlo non genera mai
// duplicati. Non scrive nulla: solo l'anteprima.

import { rispostaSenzaGoogle, utenteAutenticato } from "@/lib/apiAuth";
import { leggiPianoOccorrenze } from "@/lib/generaOccorrenze";
import { NextResponse } from "next/server";

export async function POST(request) {
  const { supabase, user, errore } = await utenteAutenticato();
  if (errore) return errore;

  const body = await request.json().catch(() => ({}));
  const giorniAvanti = Number(body.giorniAvanti) || 45;

  const { data: tokenRow, error: tokenError } = await supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single();
  if (tokenError || !tokenRow) {
    return rispostaSenzaGoogle();
  }

  try {
    const { mancanti, anomale, dataMassima } = await leggiPianoOccorrenze(supabase, user.id, tokenRow.refresh_token, giorniAvanti);
    return NextResponse.json({ ok: true, pazienti: mancanti, anomalie: anomale, dataMassima });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
