// "Uscita" dalla programmazione fissa (Maurizio, 2026-09-08 notte): un
// paziente che cambia ritmo terapeutico non si conclude, resta attivo ma
// torna temporaneamente "su richiesta" — stesso stato di un fuori-schema
// qualunque, finché non si decide la nuova cadenza (allora si riusa il
// meccanismo di creazione slot già esistente, "Nuovo slot fisso").
//
// Qui: disattiva il patient_slot corrente, poi rimuove dal calendario i
// SOLI appuntamenti futuri NON ANCORA CONFERMATI (colorId "6") che cadono
// sulla STESSA fascia weekday+orario dello slot appena disattivato — sono
// i segnaposto del vecchio ritmo, generati da "Genera occorrenze future" su
// quello slot. Gli appuntamenti futuri già confermati (colorId di default)
// restano sempre intatti, e così pure qualunque evento mandarino che non
// appartiene a quella fascia (es. un nuovo appuntamento singolo preso su un
// altro giorno/orario in vista del nuovo assetto, ancora da confermare) —
// non è un residuo della vecchia cadenza, non va toccato.
//
// Bug reale 2026-09-17: il filtro originale cancellava QUALUNQUE evento
// futuro mandarino del paziente, senza guardare la fascia — un appuntamento
// appena creato per il nuovo assetto (weekday/orario diverso), lasciato per
// errore ancora mandarino, veniva spazzato via insieme ai veri residui della
// vecchia cadenza. Corretto restringendo il confronto a weekday+time_of_day
// dello/degli slot appena disattivati.

import { createClient } from "@/lib/supabase/server";
import { deleteGoogleCalendarEvent, fetchGoogleCalendarEvents } from "@/lib/googleCalendar";
import { matchPatientForEvent, calcolaBillingStatus, todayISO, addDays } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const patientId = body.patientId;
  if (!patientId) return NextResponse.json({ error: "patientId mancante" }, { status: 400 });

  const [{ data: patients }, { data: tokenRow, error: tokenError }] = await Promise.all([
    supabase.from("patients").select("*"),
    supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
  ]);
  const patient = (patients || []).find((p) => p.id === patientId);
  if (!patient) return NextResponse.json({ error: "Paziente non trovato." }, { status: 404 });
  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }

  try {
    // Disattiva lo slot fisso — non lo cancella, resta come storico e
    // riattivabile impostandone uno nuovo al rientro.
    const { data: slotsDisattivati, error: slotError } = await supabase
      .from("patient_slots")
      .update({ active: false })
      .eq("patient_id", patientId)
      .eq("active", true)
      .select("id, weekday, time_of_day");
    if (slotError) throw new Error(slotError.message);

    await supabase.from("patients").update({ fuori_schema: true }).eq("id", patientId);

    const oggi = todayISO();
    const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, oggi, addDays(oggi, 365));
    // Fasce weekday+orario appena disattivate — solo i mandarino che cadono
    // qui sono residui certi della vecchia cadenza (vedi commento in testa).
    const weekdayOf = (dataISO) => new Date(`${dataISO}T00:00:00Z`).getUTCDay();
    const fasceDisattivate = new Set(
      (slotsDisattivati || []).map((s) => `${s.weekday}|${(s.time_of_day || "").slice(0, 5)}`)
    );

    // Mai la data di oggi: una seduta di oggi non decade per un cambio di
    // programmazione decisa stasera (stessa regola già usata altrove).
    const futuriPaziente = events.filter(
      (e) => e.data > oggi && matchPatientForEvent(e.titolo, patients)?.patient.id === patientId
    );
    // eliminaTutti (paziente "concluso"): il percorso è chiuso, quindi anche
    // gli appuntamenti già confermati vanno tolti — non hanno più senso e
    // altrimenti resterebbero a calendario come buche.
    const daRimuovere = body.eliminaTutti
      ? futuriPaziente
      : futuriPaziente.filter(
          (e) => e.colorId === "6" && fasceDisattivate.has(`${weekdayOf(e.data)}|${e.ora}`)
        );
    let cancellati = 0;
    let disdetteRegistrate = 0;
    const cancellazioniFallite = [];
    const trattenutiEntro48h = [];
    const adesso = new Date().toISOString();
    for (const e of daRimuovere) {
      try {
        if (body.eliminaTutti) {
          // Chiusura del percorso = disdetta del paziente: stessa regola delle
          // 48h di "Registra disdette". Entro le 48h sarebbe una buca da
          // addebitare — l'evento resta a calendario (come fa il flusso
          // normale) e sarà contato come seduta una volta passato.
          const billingStatus = calcolaBillingStatus(e.data, e.ora, adesso);
          if (billingStatus === "charged") {
            trattenutiEntro48h.push({ data: e.data, ora: e.ora });
            continue;
          }
          const { error: insertError } = await supabase.from("cancellations").insert({
            user_id: user.id,
            patient_id: patientId,
            event_id: e.id,
            original_date: e.data,
            cancelled_at: adesso,
            billing_status: billingStatus,
          });
          // 23505 = già registrata (unique patient_id+data): non è un errore.
          if (insertError && insertError.code !== "23505") throw new Error(insertError.message);
          disdetteRegistrate++;
        }
        await deleteGoogleCalendarEvent(tokenRow.refresh_token, e.id);
        cancellati++;
      } catch (err) {
        cancellazioniFallite.push({ eventId: e.id, data: e.data, error: err.message });
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    const mantenuti = futuriPaziente.length - cancellati;

    return NextResponse.json({
      ok: cancellazioniFallite.length === 0,
      slotDisattivato: (slotsDisattivati || []).length > 0,
      cancellati,
      mantenuti,
      disdetteRegistrate,
      trattenutiEntro48h,
      cancellazioniFallite,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
