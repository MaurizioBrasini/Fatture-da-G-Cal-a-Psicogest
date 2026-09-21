import { rispostaSenzaGoogle, utenteAutenticato } from "@/lib/apiAuth";
import { fetchAllGoogleContacts } from "@/lib/googlePeople";
import { normalizeName } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const { supabase, user, errore } = await utenteAutenticato();
  if (errore) return errore;

  const { q } = await request.json();
  if (!q || !q.trim()) return NextResponse.json({ risultati: [] });

  const { data: tokenRow, error: tokenError } = await supabase
    .from("google_tokens")
    .select("refresh_token")
    .eq("user_id", user.id)
    .single();

  if (tokenError || !tokenRow) {
    return rispostaSenzaGoogle();
  }

  try {
    const contatti = await fetchAllGoogleContacts(tokenRow.refresh_token);
    const qNorm = normalizeName(q);
    const risultati = contatti.filter((c) => normalizeName(c.nome).includes(qNorm)).slice(0, 15);
    return NextResponse.json({ risultati, avviso: contatti.avviso || null });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
