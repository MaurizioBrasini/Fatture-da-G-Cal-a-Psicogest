// Pezzi comuni alle rotte API: controllo dell'utente collegato e risposta
// standard quando manca l'autorizzazione Google. Prima erano copiati in ognuna
// delle ~24 rotte.

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Uso: const { supabase, user, errore } = await utenteAutenticato();
//      if (errore) return errore;
export async function utenteAutenticato() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { errore: NextResponse.json({ error: "Non autenticato" }, { status: 401 }) };
  return { supabase, user };
}

export function rispostaSenzaGoogle() {
  return NextResponse.json(
    { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
    { status: 400 }
  );
}
