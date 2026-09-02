"use client";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createClient();

  async function signIn() {
    const redirectTo = `${window.location.origin}/auth/callback`;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        scopes: "https://www.googleapis.com/auth/calendar.readonly",
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "ui-sans-serif, system-ui" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 500 }}>Fatturazione studio</h1>
        <p style={{ color: "#55645D", marginBottom: 20 }}>Accedi con l&apos;account Google collegato al calendario dello studio.</p>
        <button
          onClick={signIn}
          style={{
            background: "#3F6659",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Accedi con Google
        </button>
      </div>
    </div>
  );
}
