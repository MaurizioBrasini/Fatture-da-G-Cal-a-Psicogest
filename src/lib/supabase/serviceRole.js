// Client Supabase con la service role key — bypassa la Row Level Security,
// quindi va usato SOLO lato server (mai esposto al browser) e SOLO dove
// serve davvero: le rotte pubbliche dei moduli di consenso informato
// (/consenso/<token>), che un futuro paziente apre senza essere loggato
// come Maurizio, quindi non hanno alcuna sessione/auth.uid() con cui
// passare le policy RLS normali. Ogni rotta che lo usa deve fare da sola i
// controlli di sicurezza (qui: solo lettura/scrittura per token esatto, mai
// elenchi/ricerche libere sulla tabella consensi).
//
// SUPABASE_SERVICE_ROLE_KEY deve essere impostata anche nelle variabili
// d'ambiente di Vercel (non solo in .env.local), altrimenti queste rotte
// falliscono in produzione.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createServiceRoleClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
