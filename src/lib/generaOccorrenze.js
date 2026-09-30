// "Genera occorrenze future": le due operazioni (calcolo di cosa manca, creazione
// degli eventi) in un solo posto, usate sia dalle rotte manuali (anteprima e
// conferma in Pazienti) sia dal giro automatico settimanale
// (/api/cron/genera-occorrenze). `supabase` può essere il client dell'utente
// (con RLS) o quello service-role (senza RLS, nel cron): per questo ogni query
// filtra comunque per `userId`.

import { fetchGoogleCalendarEvents, createGoogleCalendarEvent } from "@/lib/googleCalendar";
import { computeOccorrenzeDaGenerare, ALTRO_TIPOLOGIA_COLOR_ID, todayISO, addDays } from "@/lib/logic";

// Cosa manca sul calendario entro `giorniAvanti` giorni, per tutti i pazienti
// con slot fisso attivo. `mancanti` = mai generate, sicure da creare;
// `anomale` = generate in passato e ora assenti senza passare da un flusso
// dell'app (quasi sempre una disdetta vera): mai ricreate in automatico.
export async function leggiPianoOccorrenze(supabase, userId, refreshToken, giorniAvanti) {
  const [slots, patients, closures, skipped, generated] = await Promise.all([
    supabase.from("patient_slots").select("*").eq("user_id", userId).eq("active", true),
    supabase.from("patients").select("*").eq("user_id", userId),
    supabase.from("slot_closures").select("*").eq("user_id", userId),
    supabase.from("skipped_occurrences").select("patient_id, data").eq("user_id", userId),
    supabase.from("generated_occurrences").select("patient_id, data").eq("user_id", userId),
  ]);
  // Una lista letta come vuota per un errore farebbe proporre (o creare)
  // occorrenze sbagliate: meglio fermarsi.
  const errore = [slots, patients, closures, skipped, generated].find((r) => r.error)?.error;
  if (errore) throw new Error("Lettura dati fallita: " + errore.message);

  const skippedSet = new Set((skipped.data || []).map((s) => `${s.patient_id}|${s.data}`));
  const generatedSet = new Set((generated.data || []).map((g) => `${g.patient_id}|${g.data}`));

  const oggi = todayISO();
  const dataMassima = addDays(oggi, giorniAvanti);
  // Orizzonte di lettura leggermente più ampio all'indietro, per intercettare
  // eventi già generati anche con qualche giorno di scarto (chiusure ecc.).
  const events = await fetchGoogleCalendarEvents(refreshToken, addDays(oggi, -14), dataMassima);

  const { mancanti, anomale } = computeOccorrenzeDaGenerare(
    slots.data || [],
    patients.data || [],
    events,
    closures.data || [],
    skippedSet,
    generatedSet,
    giorniAvanti,
    oggi
  );
  return { mancanti, anomale, dataMassima };
}

// Crea davvero gli eventi. Ogni nuovo evento nasce come singolo evento
// app-owned (mai una serie ricorrente nativa), colorId "6" (mandarino, "da
// confermare") — tranne i pazienti tipologia "altro", che usano sempre
// ALTRO_TIPOLOGIA_COLOR_ID. Descrizione iniziale = patients.note.
// `eventi`: [{patientId, data, ora, durataMinuti}]. Ogni data creata viene
// ricordata per sempre in generated_occurrences (se poi sparisce senza passare
// da un flusso dell'app sarà un'anomalia, non verrà ricreata).
export async function creaOccorrenze(supabase, userId, refreshToken, eventi) {
  const { data: patients, error } = await supabase.from("patients").select("id, nome_calendario, note, tipologia").eq("user_id", userId);
  if (error) throw new Error("Lettura pazienti fallita: " + error.message);
  const patientsById = Object.fromEntries((patients || []).map((p) => [p.id, p]));

  const risultati = [];
  for (const ev of eventi || []) {
    const patient = patientsById[ev.patientId];
    try {
      if (!patient) throw new Error("Paziente non trovato");
      await createGoogleCalendarEvent(refreshToken, {
        data: ev.data,
        ora: ev.ora,
        durataMinuti: ev.durataMinuti || 60,
        titolo: patient.nome_calendario,
        descrizione: patient.note || "",
        colorId: patient.tipologia === "altro" ? ALTRO_TIPOLOGIA_COLOR_ID : "6",
      });
      await supabase.from("generated_occurrences").upsert(
        { user_id: userId, patient_id: ev.patientId, data: ev.data },
        { onConflict: "patient_id,data", ignoreDuplicates: true }
      );
      risultati.push({ patientId: ev.patientId, data: ev.data, ok: true });
    } catch (e) {
      risultati.push({ patientId: ev.patientId, data: ev.data, ok: false, error: e.message });
    }
    // pausa tra una creazione e l'altra, per non sforare i limiti di Google
    await new Promise((r) => setTimeout(r, 150));
  }
  return risultati;
}
