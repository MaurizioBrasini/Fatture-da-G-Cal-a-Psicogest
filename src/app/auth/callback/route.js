import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data?.session) {
      const refreshToken = data.session.provider_refresh_token;
      const userId = data.session.user.id;

      // Google restituisce il refresh token solo la prima volta (con prompt=consent).
      // Lo salviamo così l'app potrà leggere il calendario senza richiedere un nuovo login.
      if (refreshToken) {
        await supabase.from("google_tokens").upsert({
          user_id: userId,
          refresh_token: refreshToken,
          updated_at: new Date().toISOString(),
        });
      }
      return NextResponse.redirect(`${origin}/`);
    }
  }

  return NextResponse.redirect(`${origin}/login?errore=1`);
}
