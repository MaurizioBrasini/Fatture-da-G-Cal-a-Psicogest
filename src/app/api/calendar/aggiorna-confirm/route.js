// Registra davvero le disdette confermate. Riceve esattamente la lista già
// calcolata e mostrata in anteprima (billing_status incluso l'eventuale
// override manuale fatto dall'utente in anteprima, che sovrascrive il
// calcolo automatico delle 48h), come per la rinumerazione. Per ciascuna,
// nell'ordine che conta per non perdere dati:
// 1) scrive la riga in `cancellations` (se già presente per patient_id+data,
//    la salta senza errore: idempotenza lato database);
// 2) SOLO se billing_status = not_charged E la riga non è "manuale", rimuove
//    l'evento dal calendario per liberare lo slot. Le righe manuali (`c.manual`)
//    sono disdette il cui evento è già stato eliminato a mano dall'utente
//    direttamente su Google Calendar — non hanno un evento reale da cancellare
//    (e non passano dalla scansione delle note "disdetto"). Le buche (charged,
//    non manuali) restano a calendario per pulizia storica — il conteggio non
//    dipende più dalla loro presenza.
// 3) SOLO se billing_status = not_charged (evento assente dal calendario, sia
//    perché appena cancellato qui sia perché già rimosso a mano), registra
//    anche la data in `skipped_occurrences` — altrimenti resta l'unica fonte
//    che "Genera occorrenze future" consulta per sapere quali date NON
//    rigenerare, e occorrenzeFuture (logic.js) non ha alcuna idea di questa
//    disdetta: la ricalcola sempre dalla pura matematica anchor_date+interval,
//    quindi vede la data come "mancante" e la ricrea da zero al giro
//    successivo. Bug reale 2026-09-10: chiusura del 24/9 + rigenerazione
//    hanno resuscitato Simone Z. e Isabella e Simone su una data che loro
//    stessi avevano già disdetto per conto proprio, senza nessuna chiusura
//    di mezzo — la disdetta paziente non lascia traccia da nessuna parte che
//    il generatore di occorrenze legga.

import { rispostaSenzaGoogle, utenteAutenticato } from "@/lib/apiAuth";
import { deleteGoogleCalendarEvent, updateGoogleCalendarEventDescription } from "@/lib/googleCalendar";
import { sendEmail, buildEmailRiprenotazioneHtml } from "@/lib/email";
import { incassaContante, rimuoviMarcatoreSaldato, annotaSaldatoInNota, annotaSaldatoNFInNota, ancoraValoreDopoIncassoNF, importoSedutaNonFatturato, addDays } from "@/lib/logic";
import { NextResponse } from "next/server";

export async function POST(request) {
  const { supabase, user, errore } = await utenteAutenticato();
  if (errore) return errore;

  const { candidati, incassi, scartati } = await request.json().catch(() => ({}));
  const haScartati = Array.isArray(scartati) && scartati.length > 0;

  // Spunte tolte da Maurizio: si ricordano, così non vengono riproposte.
  // Prima di tutto il resto, così vale anche se non c'è nulla da registrare.
  let scartatiSalvati = 0;
  if (haScartati) {
    const righe = scartati.map((s) => ({
      user_id: user.id,
      event_id: s.eventId,
      tipo: s.tipo === "duplicato" ? "duplicato" : "disdetta",
      patient_id: s.patientId ?? null,
      data: s.data ?? null,
      ora: s.ora ?? null,
      nome: s.nome ?? null,
    }));
    const { error: scartiError } = await supabase.from("disdette_scartate").upsert(righe, { onConflict: "user_id,event_id,tipo", ignoreDuplicates: true });
    if (scartiError) return NextResponse.json({ error: `Scarti non salvati (hai eseguito schema_addendum20.sql?): ${scartiError.message}` }, { status: 500 });
    scartatiSalvati = righe.length;
  }

  if ((!Array.isArray(candidati) || !candidati.length) && (!Array.isArray(incassi) || !incassi.length)) {
    if (haScartati) return NextResponse.json({ ok: true, registrati: 0, falliti: 0, dettagli: [], scartatiSalvati });
    return NextResponse.json({ error: "Nessuna disdetta o incasso da registrare." }, { status: 400 });
  }

  const { data: tokenRow, error: tokenError } = await supabase
    .from("google_tokens")
    .select("refresh_token")
    .eq("user_id", user.id)
    .single();
  if (tokenError || !tokenRow) {
    return rispostaSenzaGoogle();
  }

  const vogliomoEmail = (candidati || []).some((c) => c.inviaEmail);
  let settings = null;
  let emailByPatientId = {};
  if (vogliomoEmail) {
    const [{ data: s }, { data: pazienti }] = await Promise.all([
      supabase.from("settings").select("*").maybeSingle(),
      supabase.from("patients").select("id,email").in("id", [...new Set(candidati.filter((c) => c.inviaEmail).map((c) => c.patientId))]),
    ]);
    settings = s;
    emailByPatientId = Object.fromEntries((pazienti || []).map((p) => [p.id, p.email]));
  }

  const risultati = [];
  for (const c of candidati || []) {
    let emailInviata = null; // null = non richiesta, altrimenti "ok" | "errore"
    try {
      const { error: insertError } = await supabase.from("cancellations").insert({
        user_id: user.id,
        patient_id: c.patientId,
        event_id: c.eventId,
        original_date: c.data,
        cancelled_at: c.cancelledAt,
        billing_status: c.billingStatus,
      });
      // 23505 = violazione unique(patient_id, original_date): già registrata
      // in un giro precedente — non è un errore, si salta la scrittura ma si
      // procede comunque all'eventuale rimozione dell'evento.
      if (insertError && insertError.code !== "23505") throw new Error(insertError.message);

      if (c.billingStatus === "not_charged") {
        if (!c.manual) {
          await deleteGoogleCalendarEvent(tokenRow.refresh_token, c.eventId);
        }
        // Idempotente (onConflict ignora se già presente da un giro
        // precedente o da "Genera occorrenze future"): impedisce che questa
        // data ricompaia come "occorrenza mancante" la prossima volta che si
        // rilancia quel bottone.
        await supabase.from("skipped_occurrences").upsert(
          { user_id: user.id, patient_id: c.patientId, data: c.data },
          { onConflict: "patient_id,data", ignoreDuplicates: true }
        );
      }
      if (c.inviaEmail) {
        const email = emailByPatientId[c.patientId];
        const oggettoEmail = "Prenota il tuo prossimo appuntamento";
        let erroreEmail = null;
        if (email && settings?.link_prenotazioni_online) {
          try {
            await sendEmail({
              settings,
              to: email,
              subject: oggettoEmail,
              html: buildEmailRiprenotazioneHtml({ nomePaziente: c.nome, linkPrenotazioni: settings.link_prenotazioni_online }),
            });
          } catch (e) {
            erroreEmail = e.message;
          }
        } else {
          erroreEmail = !email ? "Paziente senza email registrata." : "Link prenotazioni non impostato in Impostazioni.";
        }
        emailInviata = erroreEmail ? "errore" : "ok";
        if (email) {
          await supabase.from("email_log").insert({
            user_id: user.id,
            patient_id: c.patientId,
            email,
            oggetto: oggettoEmail,
            tipo: "riprenotazione",
            stato: emailInviata,
            errore: erroreEmail,
          });
        }
      }
      risultati.push({ eventId: c.eventId, ok: true, emailInviata });
    } catch (e) {
      risultati.push({ eventId: c.eventId, ok: false, error: e.message, emailInviata });
    }
    // piccola pausa tra un'operazione e l'altra, per non sforare i limiti di
    // frequenza imposti da Google sulle chiamate API
    await new Promise((r) => setTimeout(r, 150));
  }

  // Incassi contanti rilevati dalla nota "saldato"/"saldato N" (stesse
  // strutture del bottone manuale "€X" in Pazienti: patients.contante_dovuto
  // + contante_pagamenti). Dopo la scrittura, il marcatore va tolto dalla
  // nota dell'evento — è l'unico modo per non riproporre lo stesso incasso
  // alla prossima scansione (idempotenza), lo stesso principio di
  // skipped_occurrences sopra ma per il testo della nota.
  const risultatiIncassi = [];
  for (const inc of incassi || []) {
    try {
      const importo = Number(inc.importo);
      if (Number.isNaN(importo) || importo < 0) throw new Error("Importo non valido.");
      // 0 = "solo pulisci la nota", nessun incasso da registrare (es. saldo
      // già a posto ma un marcatore "saldato" rimasto orfano perché
      // l'incasso vero è stato registrato altrove, come il bottone manuale
      // in Pazienti — caso reale Francesco Mer. 2026-09-22): senza questo,
      // la nota sarebbe rimasta bloccata per sempre, riproposta a ogni
      // scansione senza un modo per toglierla dall'app.
      let notaSaldato = null;
      if (importo > 0) {
        // Non fatturato che paga in contanti: il saldo non passa da
        // contante_dovuto (il dovuto è prezzo unitario × sedute, vedi
        // computeRinumerazione); "saldato" chiude il ciclo: il conteggio
        // riparte dal giorno dopo, dal debito residuo in sedute se il
        // pagamento è parziale. Lo stato si rilegge dal database, non ci si
        // fida del client.
        const { data: paz } = await supabase.from("patients").select("stato, tipologia, costo_unitario, quota_contante_seduta").eq("id", inc.patientId).single();
        const chiudiCiclo = paz?.stato === "non_fatturato" && paz?.tipologia !== "altro";
        const dovuto = Number(inc.deveAlGiorno) || 0;
        notaSaldato = chiudiCiclo
          ? annotaSaldatoNFInNota(inc.descrizioneOriginale, dovuto, importo)
          : annotaSaldatoInNota(inc.descrizioneOriginale, dovuto, importo);
        const nuovoSaldo = chiudiCiclo ? inc.saldoAttuale : incassaContante(inc.saldoAttuale, importo);
        const { error: insertError } = await supabase.from("contante_pagamenti").insert({
          user_id: user.id,
          patient_id: inc.patientId,
          importo,
          data: inc.data,
        });
        if (insertError) throw new Error(insertError.message);
        const { error: updateError } = await supabase
          .from("patients")
          .update(chiudiCiclo ? { ancora_data: addDays(inc.data, 1), ancora_valore: ancoraValoreDopoIncassoNF(dovuto, importo, importoSedutaNonFatturato(paz)) } : { contante_dovuto: nuovoSaldo })
          .eq("id", inc.patientId);
        if (updateError) throw new Error(updateError.message);
      }
      // Con un incasso vero la nota conserva la dicitura "(deve X€ saldato)"
      // / "(deve X€ saldato Y€)" (l'idempotenza ora la garantisce la riga in
      // contante_pagamenti, vedi computeIncassiContantiDaRegistrare); con 0
      // il marcatore orfano viene solo tolto.
      await updateGoogleCalendarEventDescription(
        tokenRow.refresh_token,
        inc.eventId,
        notaSaldato ?? rimuoviMarcatoreSaldato(inc.descrizioneOriginale)
      );
      risultatiIncassi.push({ eventId: inc.eventId, patientId: inc.patientId, ok: true });
    } catch (e) {
      risultatiIncassi.push({ eventId: inc.eventId, patientId: inc.patientId, ok: false, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const falliti = risultati.filter((r) => !r.ok);
  const incassiFalliti = risultatiIncassi.filter((r) => !r.ok);
  return NextResponse.json({
    ok: falliti.length === 0 && incassiFalliti.length === 0,
    scartatiSalvati,
    registrati: risultati.length - falliti.length,
    falliti: falliti.length,
    dettagli: risultati,
    incassiRegistrati: risultatiIncassi.length - incassiFalliti.length,
    incassiFalliti: incassiFalliti.length,
    incassiDettagli: risultatiIncassi,
  });
}
