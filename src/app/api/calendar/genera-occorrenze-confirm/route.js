// Crea davvero le occorrenze mancanti confermate in anteprima (vedi
// creaOccorrenze per i dettagli degli eventi creati) e ricorda le date
// deselezionate, così non vengono riproposte ai giri successivi.

import { rispostaSenzaGoogle, utenteAutenticato } from "@/lib/apiAuth";
import { creaOccorrenze } from "@/lib/generaOccorrenze";
import { NextResponse } from "next/server";

export async function POST(request) {
  const { supabase, user, errore } = await utenteAutenticato();
  if (errore) return errore;

  const { eventi, esclusioni } = await request.json().catch(() => ({}));
  if ((!Array.isArray(eventi) || !eventi.length) && (!Array.isArray(esclusioni) || !esclusioni.length)) {
    return NextResponse.json({ error: "Nessun evento da creare o escludere." }, { status: 400 });
  }

  // Le date deselezionate in anteprima vengono ricordate (upsert, non fallisce
  // se già presenti da un giro precedente).
  if (Array.isArray(esclusioni) && esclusioni.length) {
    await supabase.from("skipped_occurrences").upsert(
      esclusioni.map((e) => ({ user_id: user.id, patient_id: e.patientId, data: e.data })),
      { onConflict: "patient_id,data", ignoreDuplicates: true }
    );
  }

  const { data: tokenRow, error: tokenError } = await supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single();
  if (tokenError || !tokenRow) {
    return rispostaSenzaGoogle();
  }

  try {
    const risultati = await creaOccorrenze(supabase, user.id, tokenRow.refresh_token, eventi);
    const falliti = risultati.filter((r) => !r.ok);
    return NextResponse.json({
      ok: falliti.length === 0,
      creati: risultati.length - falliti.length,
      falliti: falliti.length,
      dettagli: risultati,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
