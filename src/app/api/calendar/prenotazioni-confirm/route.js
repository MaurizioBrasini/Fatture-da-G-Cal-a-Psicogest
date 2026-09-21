// Applica le riconnessioni di prenotazioni online confermate in anteprima.
// Riceve [{eventId, patientId, bookerEmail}]. Per ciascuna:
// 1) rinomina SOLO il titolo dell'evento al nome_calendario del paziente
//    scelto — nessun'altra modifica (colore, descrizione, altri eventi
//    restano invariati, nessun evento nuovo viene generato);
// 2) se il paziente non ha ancora un'email salvata e la prenotazione ne
//    porta una, la salva (rinforza il matching automatico dei prossimi giri);
// poi rilancia subito la rinumerazione (stessa logica di renumber-confirm)
// per ogni paziente toccato con successo, così la numerazione resta coerente
// senza un passaggio manuale separato.
//
// Riceve anche `rifiuti` [{eventId}]: prenotazioni che violano la regola "un
// solo appuntamento ogni due settimane" (vedi computeConflittiPrenotazioni)
// e che Maurizio ha lasciato spuntate in anteprima. Per sicurezza il
// conflitto viene RICALCOLATO qui sul calendario di adesso (l'anteprima può
// essere vecchia) e si cancella solo ciò che è ancora una prenotazione online
// in conflitto — mai un evento indicato dal client e basta. Poi email al
// paziente e riga in email_log (tipo 'prenotazione_annullata', vedi
// schema_addendum15.sql; se la tabella non lo ammette ancora, il log fallisce
// senza bloccare nulla e viene segnalato). Un rifiuto NON è una disdetta del
// paziente: nessuna riga in `cancellations`, per non falsare le statistiche.

import { createClient } from "@/lib/supabase/server";
import {
  fetchGoogleCalendarEvents,
  deleteGoogleCalendarEvent,
  updateGoogleCalendarEventTitle,
  updateGoogleCalendarEventDescription,
} from "@/lib/googleCalendar";
import { sendEmail, buildEmailPrenotazioneAnnullataHtml } from "@/lib/email";
import {
  computeRinumerazione,
  computePrenotazioniPreview,
  computeConflittiPrenotazioni,
  formatDataItaliana,
  GIORNI_LOOKBACK_PRENOTAZIONI,
  DEFAULT_SETTINGS,
  todayISO,
  addDays,
} from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const abbinamenti = body.abbinamenti ?? [];
  const rifiuti = body.rifiuti ?? [];
  if (!Array.isArray(abbinamenti) || !Array.isArray(rifiuti) || (!abbinamenti.length && !rifiuti.length)) {
    return NextResponse.json({ error: "Nessuna riconnessione da confermare." }, { status: 400 });
  }

  const [
    { data: patients, error: patientsError },
    { data: settingsRow },
    { data: slots, error: slotsError },
    { data: tokenRow, error: tokenError },
    { data: closures, error: closuresError },
  ] = await Promise.all([
    supabase.from("patients").select("*").order("id"),
    supabase.from("settings").select("*").maybeSingle(),
    supabase.from("patient_slots").select("*"),
    supabase.from("google_tokens").select("refresh_token").eq("user_id", user.id).single(),
    supabase.from("slot_closures").select("*"),
  ]);
  if (patientsError || slotsError || closuresError) {
    return NextResponse.json({ error: (patientsError || slotsError || closuresError).message }, { status: 500 });
  }

  if (tokenError || !tokenRow) {
    return NextResponse.json(
      { error: "Nessuna autorizzazione Google salvata. Rifai il login da /login." },
      { status: 400 }
    );
  }
  const settings = { ...DEFAULT_SETTINGS, ...(settingsRow || {}) };

  // --- Rifiuti: prenotazioni in conflitto con la regola delle due settimane ---
  const rifiutate = [];
  if (rifiuti.length) {
    const oggi = todayISO();
    let eventiLarghi;
    try {
      // Se la rilettura fallisce non si cancella nulla: si esce prima di
      // toccare qualunque evento.
      eventiLarghi = await fetchGoogleCalendarEvents(
        tokenRow.refresh_token,
        addDays(oggi, -GIORNI_LOOKBACK_PRENOTAZIONI),
        addDays(oggi, 180)
      );
    } catch (e) {
      return NextResponse.json({ error: "Rilettura del calendario fallita, nessuna prenotazione annullata: " + e.message }, { status: 500 });
    }
    const { pronte, inAttesa, ambigue, nuove } = computePrenotazioniPreview(eventiLarghi.filter((e) => e.data >= oggi), patients || []);
    // anche ambigue/nuove: la regola delle fasce riservate vale per chiunque prenoti
    const righe = [...pronte, ...inAttesa, ...ambigue, ...nuove];
    const conflitti = computeConflittiPrenotazioni(righe, eventiLarghi, patients || [], slots || [], { closures: closures || [] });

    for (const rf of rifiuti) {
      const riga = righe.find((r) => r.eventId === rf.eventId);
      const conflitto = conflitti[rf.eventId];
      if (!riga || !conflitto) {
        rifiutate.push({ eventId: rf.eventId, ok: false, saltata: true, error: "non risulta più una prenotazione in conflitto: lasciata com'è" });
        continue;
      }
      const patient = (patients || []).find((p) => p.id === riga.patientId);
      const esito = { eventId: rf.eventId, patientId: riga.patientId, data: riga.data, ok: false, emailInviata: null };
      try {
        await deleteGoogleCalendarEvent(tokenRow.refresh_token, rf.eventId);
        esito.ok = true;
      } catch (e) {
        esito.error = e.message;
        rifiutate.push(esito);
        continue; // evento non cancellato: nessuna email, niente da spiegare al paziente
      }

      const destinatario = riga.bookerEmail || patient?.email;
      if (!destinatario) {
        esito.emailInviata = "senza_email";
      } else {
        const oggettoEmail = "Prenotazione annullata";
        let erroreEmail = null;
        try {
          await sendEmail({
            settings: settingsRow,
            to: destinatario,
            subject: oggettoEmail,
            html: buildEmailPrenotazioneAnnullataHtml({
              nomePaziente: patient?.nome || (patient?.nome_calendario || "").split(" ")[0] || riga.bookerNome || "",
              dataPrenotazione: formatDataItaliana(riga.data),
              oraPrenotazione: riga.ora,
              conflittiTesto: conflitto.map((c) => `${formatDataItaliana(c.data)}${c.ora ? ` alle ${c.ora}` : ""}`).join(", "),
              linkPrenotazioni: settingsRow?.link_prenotazioni_online,
              frequenzaFissa: !!conflitto[0]?.cadenza,
              oltreOrizzonte: !!conflitto[0]?.oltreOrizzonte,
              riservato: !!conflitto[0]?.riservato,
              unaSola: !!conflitto[0]?.unaSola,
            }),
          });
        } catch (e) {
          erroreEmail = e.message;
        }
        esito.emailInviata = erroreEmail ? "errore" : "ok";
        if (erroreEmail) esito.erroreEmail = erroreEmail;
        const { error: logError } = await supabase.from("email_log").insert({
          user_id: user.id,
          patient_id: riga.patientId,
          email: destinatario,
          oggetto: oggettoEmail,
          tipo: "prenotazione_annullata",
          stato: erroreEmail ? "errore" : "ok",
          errore: erroreEmail,
        });
        if (logError) esito.logNonSalvato = logError.message;
      }
      rifiutate.push(esito);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  const risultati = [];
  for (const a of abbinamenti) {
    try {
      const patient = (patients || []).find((p) => p.id === a.patientId);
      if (!patient) throw new Error("Paziente non trovato.");
      if (!patient.nome_calendario) throw new Error("Il paziente non ha ancora un nome calendario impostato.");

      await updateGoogleCalendarEventTitle(tokenRow.refresh_token, a.eventId, patient.nome_calendario);

      if (a.bookerEmail && !patient.email) {
        await supabase.from("patients").update({ email: a.bookerEmail }).eq("id", patient.id);
        patient.email = a.bookerEmail;
      }

      risultati.push({ eventId: a.eventId, patientId: patient.id, ok: true });
    } catch (e) {
      risultati.push({ eventId: a.eventId, patientId: a.patientId, ok: false, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const pazientiToccati = [...new Set(risultati.filter((r) => r.ok).map((r) => r.patientId))];
  let rinumerati = 0;
  if (pazientiToccati.length) {
    const oggi = todayISO();
    const dataMinima =
      pazientiToccati.reduce((min, id) => {
        const p = patients.find((pp) => pp.id === id);
        return p?.ancora_data && (!min || p.ancora_data < min) ? p.ancora_data : min;
      }, null) || oggi;
    const dataMassima = addDays(oggi, 180);
    try {
      // Rilettura live DOPO tutti i rinomina: i titoli appena scritti devono
      // già essere visibili per entrare nel conteggio.
      const events = await fetchGoogleCalendarEvents(tokenRow.refresh_token, dataMinima, dataMassima);
      const { data: incassi } = await supabase.from("contante_pagamenti").select("patient_id,importo,data");
      for (const id of pazientiToccati) {
        const patient = patients.find((p) => p.id === id);
        const piano = computeRinumerazione(patient, events, settings, patients, {
          pagamentiContante: (incassi || []).filter((x) => x.patient_id === id),
        }).filter((r) => r.cambia);
        for (const riga of piano) {
          await updateGoogleCalendarEventDescription(tokenRow.refresh_token, riga.id, riga.descrizioneNuova);
          await new Promise((r) => setTimeout(r, 150));
        }
        rinumerati++;
      }
    } catch (e) {
      return NextResponse.json({ ok: false, risultati, dettagliRifiuti: rifiutate, rinumerati, erroreRinumerazione: e.message }, { status: 500 });
    }
  }

  const falliti = risultati.filter((r) => !r.ok);
  const rifiutiFalliti = rifiutate.filter((r) => !r.ok && !r.saltata);
  return NextResponse.json({
    ok: falliti.length === 0 && rifiutiFalliti.length === 0,
    riconnessi: risultati.length - falliti.length,
    falliti: falliti.length,
    rinumerati,
    annullate: rifiutate.filter((r) => r.ok).length,
    emailInviate: rifiutate.filter((r) => r.emailInviata === "ok").length,
    emailProblemi: rifiutate.filter((r) => r.ok && r.emailInviata !== "ok").length,
    logNonSalvato: rifiutate.some((r) => r.logNonSalvato),
    rifiutiSaltati: rifiutate.filter((r) => r.saltata).length,
    rifiutiFalliti: rifiutiFalliti.length,
    dettagli: risultati,
    dettagliRifiuti: rifiutate,
  });
}
