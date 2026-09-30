// Giro automatico settimanale di "Genera occorrenze future" (Vercel Cron, vedi
// vercel.json). Stessa logica dell'anteprima+conferma manuale in Pazienti
// (leggiPianoOccorrenze / creaOccorrenze), senza anteprima: crea solo le
// occorrenze MAI generate prima ("mancanti", colore "da confermare"). Le
// "anomale" (generate in passato e sparite senza passare da un flusso dell'app,
// quasi sempre disdette vere) non si ricreano mai da soli: si contano e si
// segnalano in Dashboard, poi le decide Maurizio dal generatore manuale.
//
// Sicurezze, perché gira senza nessuno che guardi:
// - solo con `Authorization: Bearer <CRON_SECRET>` (Vercel lo manda da solo se
//   la variabile CRON_SECRET è impostata); senza segreto la rotta si rifiuta;
// - se la lettura di dati o calendario fallisce non scrive nulla;
// - se le occorrenze da creare sono troppe (MAX_EVENTI_PER_GIRO) non ne crea
//   nessuna e lo segnala: un numero enorme significa che qualcosa non va
//   (es. dati letti male), non un normale giro settimanale;
// - è idempotente: ogni data creata viene ricordata (generated_occurrences),
//   quindi un giro interrotto a metà riprende senza duplicati.
// L'esito dell'ultimo giro resta in settings.ultima_generazione_auto e la
// Dashboard lo mostra.

import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { leggiPianoOccorrenze, creaOccorrenze } from "@/lib/generaOccorrenze";
import { NextResponse } from "next/server";

export const maxDuration = 60;

const GIORNI_AVANTI = 45;
const MAX_EVENTI_PER_GIRO = 150;

export async function GET(request) {
  const segreto = process.env.CRON_SECRET;
  if (!segreto || request.headers.get("authorization") !== `Bearer ${segreto}`) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const { data: tokens, error: tokensError } = await supabase.from("google_tokens").select("user_id, refresh_token");
  if (tokensError) return NextResponse.json({ error: tokensError.message }, { status: 500 });

  const esiti = [];
  for (const t of tokens || []) {
    const esito = { eseguito_il: new Date().toISOString(), creati: 0, falliti: 0, anomalie: 0, errore: null };
    try {
      const { mancanti, anomale } = await leggiPianoOccorrenze(supabase, t.user_id, t.refresh_token, GIORNI_AVANTI);
      esito.anomalie = anomale.length;
      const eventi = mancanti.flatMap((p) => p.date.map((data) => ({ patientId: p.patientId, data, ora: p.ora, durataMinuti: p.durataMinuti })));
      if (eventi.length > MAX_EVENTI_PER_GIRO) {
        esito.errore = `Troppe occorrenze da creare (${eventi.length}): non ne ho creata nessuna. Generale a mano da Pazienti.`;
      } else if (eventi.length) {
        const risultati = await creaOccorrenze(supabase, t.user_id, t.refresh_token, eventi);
        esito.falliti = risultati.filter((r) => !r.ok).length;
        esito.creati = risultati.length - esito.falliti;
        if (esito.falliti) esito.errore = `${esito.falliti} eventi non creati (es. ${risultati.find((r) => !r.ok).error}).`;
      }
    } catch (e) {
      esito.errore = e.message;
    }
    // Se la colonna non esiste ancora (schema_addendum21 non eseguito) il giro
    // ha comunque lavorato: l'esito resta solo nei log.
    await supabase.from("settings").update({ ultima_generazione_auto: esito }).eq("user_id", t.user_id);
    esiti.push(esito);
  }
  return NextResponse.json({ ok: true, esiti });
}
