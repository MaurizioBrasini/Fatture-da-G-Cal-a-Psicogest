// Rimette in proposta una disdetta/duplicato scartato in "Registra disdette":
// cancella la riga da `disdette_scartate`, così la prossima scansione lo
// ripropone (la decisione finale resta sempre a Maurizio).

import { utenteAutenticato } from "@/lib/apiAuth";
import { NextResponse } from "next/server";

export async function POST(request) {
  const { supabase, user, errore } = await utenteAutenticato();
  if (errore) return errore;

  const { id } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "Id mancante." }, { status: 400 });

  const { error } = await supabase.from("disdette_scartate").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
