import { createClient } from "@/lib/supabase/server";
import { fetchAllGoogleContacts } from "@/lib/googlePeople";
import { normalizeName } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { q } = await request.json();
  if (!q || !q.trim()) return NextResponse.json({ risultati: [] });

  const { data: tokenRow, error: tokenError } = await supabase
    .from("google_tokens")
    .select("refresh_token")
    .eq("user_id", user.id)
    .single();

  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }

  try {
    const contatti = await fetchAllGoogleContacts(tokenRow.refresh_token);
    const qNorm = normalizeName(q);
    const risultati = contatti.filter((c) => normalizeName(c.nome).includes(qNorm)).slice(0, 15);
    return NextResponse.json({ risultati });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
