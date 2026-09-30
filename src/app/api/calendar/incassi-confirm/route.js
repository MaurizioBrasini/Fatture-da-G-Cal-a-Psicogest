// Registra gli incassi "saldato"/"saldato N" letti dalle note e confermati
// nell'anteprima di Rinumera (importo eventualmente corretto a mano). Per
// ciascuno: registra l'incasso con la procedura unica (registraIncassoContanti,
// la stessa del pulsante "€X" in Pazienti) e riscrive la nota dell'evento.
// Con importo 0 non registra nulla e toglie solo il marcatore orfano (saldo già
// a posto, incasso registrato altrove). La rinumerazione delle note segue
// dall'anteprima ricalcolata dal client.

import { rispostaSenzaGoogle, utenteAutenticato } from "@/lib/apiAuth";
import { updateGoogleCalendarEventDescription } from "@/lib/googleCalendar";
import { registraIncassoContanti } from "@/lib/incassiContanti";
import { rimuoviMarcatoreSaldato, annotaSaldatoInNota } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const { supabase, user, errore } = await utenteAutenticato();
  if (errore) return errore;

  const { incassi } = await request.json().catch(() => ({}));
  if (!Array.isArray(incassi) || !incassi.length) {
    return NextResponse.json({ error: "Nessun incasso da registrare." }, { status: 400 });
  }

  const { data: tokenRow, error: tokenError } = await supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single();
  if (tokenError || !tokenRow) return rispostaSenzaGoogle();

  const risultati = [];
  for (const inc of incassi) {
    try {
      const importo = Number(inc.importo);
      if (Number.isNaN(importo) || importo < 0) throw new Error("Importo non valido.");
      let nuovaNota = rimuoviMarcatoreSaldato(inc.descrizioneOriginale);
      if (importo > 0) {
        await registraIncassoContanti(supabase, { userId: user.id, patientId: inc.patientId, importo, data: inc.data });
        nuovaNota = annotaSaldatoInNota(inc.descrizioneOriginale, Number(inc.deveAlGiorno) || 0, importo);
      }
      await updateGoogleCalendarEventDescription(tokenRow.refresh_token, inc.eventId, nuovaNota);
      risultati.push({ eventId: inc.eventId, patientId: inc.patientId, ok: true });
    } catch (e) {
      risultati.push({ eventId: inc.eventId, patientId: inc.patientId, ok: false, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const falliti = risultati.filter((r) => !r.ok);
  return NextResponse.json({ ok: falliti.length === 0, registrati: risultati.length - falliti.length, falliti: falliti.length, dettagli: risultati });
}
