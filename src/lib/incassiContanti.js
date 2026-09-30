// Registra un incasso contanti: UNA sola procedura per tutti i punti da cui
// nasce (pulsante "€X" in Pazienti, nota "saldato" letta da Rinumera). Scrive
// la riga in `contante_pagamenti` (storico, annullabile da Pazienti) e, per i
// pazienti con una quota contanti a parte dalla fattura, scala il saldo
// `contante_dovuto` con incassaContante. I non fatturati (`nonFatturato`)
// non hanno un saldo da scalare — il loro ciclo si chiude dalla nota
// "saldato" — quindi resta solo la riga di storico.
// `supabase` è il client (browser o server): stessa API.

import { incassaContante } from "@/lib/logic";

export async function registraIncassoContanti(supabase, { userId, patientId, importo, data, nonFatturato = false }) {
  const { error: insertError } = await supabase.from("contante_pagamenti").insert({
    user_id: userId,
    patient_id: patientId,
    importo,
    data,
  });
  if (insertError) throw new Error(insertError.message);
  if (nonFatturato) return null;

  // Il saldo si rilegge dal database, non ci si fida di quello che ha la pagina.
  const { data: paz, error: readError } = await supabase.from("patients").select("contante_dovuto").eq("id", patientId).single();
  if (readError) throw new Error(readError.message);
  const nuovoSaldo = incassaContante(paz?.contante_dovuto, importo);
  const { error: updateError } = await supabase.from("patients").update({ contante_dovuto: nuovoSaldo }).eq("id", patientId);
  if (updateError) throw new Error(updateError.message);
  return nuovoSaldo;
}
