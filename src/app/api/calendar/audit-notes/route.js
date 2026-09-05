// Prova a vuoto (SOLA LETTURA): scorre le note del calendario in un
// intervallo di date e segnala quelle che sembrano contenere un vecchio
// codice manuale non riconosciuto da stripCodiceEsistente. Non scrive mai
// nulla su Google — serve solo a controllare, prima di usare "Rinumera
// tutti" su larga scala, che non esistano formati di nota mai incontrati.

import { createClient } from "@/lib/supabase/server";
import { fetchGoogleCalendarEvents } from "@/lib/googleCalendar";
import { analizzaNotaPerAudit } from "@/lib/logic";
import { NextResponse } from "next/server";

const MAX_FLAGGED = 500;

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const from = body.from || "2015-01-01";
  const to = body.to || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

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
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, from, to);
    const conNota = events.filter((e) => (e.descrizione || "").trim());

    // Data del primo e dell'ultimo evento EFFETTIVAMENTE restituiti da
    // Google in questa chiamata — prova concreta di quanto lontano è
    // arrivata davvero la lettura, utile per scoprire se la paginazione si
    // fosse fermata prima della fine dell'intervallo richiesto.
    const dateEventi = events.map((e) => e.data).sort();
    const primoEvento = dateEventi[0] || null;
    const ultimoEvento = dateEventi[dateEventi.length - 1] || null;

    // Riepilogo per anno: fa emergere subito eventuali "buchi" (anni con
    // eventi ma zero note, o assenti del tutto) invece di un unico totale
    // aggregato che nasconde la distribuzione nel tempo.
    const perAnno = {};
    for (const e of events) {
      const anno = e.data.slice(0, 4);
      if (!perAnno[anno]) perAnno[anno] = { eventi: 0, conNota: 0, sospette: 0 };
      perAnno[anno].eventi++;
    }

    const flagged = [];
    let sospette = 0;
    for (const ev of conNota) {
      const anno = ev.data.slice(0, 4);
      perAnno[anno].conNota++;
      const analisi = analizzaNotaPerAudit(ev.descrizione);
      if (analisi.sospetta) {
        sospette++;
        perAnno[anno].sospette++;
        if (flagged.length < MAX_FLAGGED) {
          flagged.push({
            data: ev.data,
            ora: ev.ora,
            titolo: ev.titolo,
            descrizione: ev.descrizione.slice(0, 200),
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      from,
      to,
      totaleEventi: events.length,
      eventiConNota: conNota.length,
      sospette,
      flagged,
      troncato: sospette > flagged.length,
      primoEvento,
      ultimoEvento,
      perAnno,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
