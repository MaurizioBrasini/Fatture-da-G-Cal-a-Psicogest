// Rilancia in automatico anteprima+conferma della rinumerazione per UN
// paziente, senza mostrare nulla a schermo — usata dopo aver confermato una
// fattura o un incasso in contanti, per tenere sempre aggiornata la nota sul
// calendario (es. il tag "(deve X€)") senza che l'utente debba premere
// "Rinumera" a mano ogni volta. Eventuali errori non bloccano l'operazione
// principale (fattura/incasso già confermati restano validi): chi chiama
// decide se segnalarli.
export async function rinumeraPazienteSilenzioso(patientId, giorniAvanti = 90) {
  const previewRes = await fetch("/api/calendar/renumber-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientId, giorniAvanti }),
  });
  const previewData = await previewRes.json();
  if (!previewRes.ok) throw new Error(previewData.error || "Errore nel calcolo dell'anteprima rinumerazione.");

  const aggiornamenti = (previewData.pazienti || []).flatMap((p) =>
    p.piano.map((r) => ({ id: r.id, descrizioneNuova: r.descrizioneNuova }))
  );
  if (!aggiornamenti.length) return { scritti: 0, falliti: 0 };

  const confirmRes = await fetch("/api/calendar/renumber-confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aggiornamenti }),
  });
  const confirmData = await confirmRes.json();
  if (!confirmRes.ok) throw new Error(confirmData.error || "Errore nella scrittura della rinumerazione.");
  return confirmData;
}
