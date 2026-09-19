import { createClient } from "@/lib/supabase/server";
import { fetchAllGoogleContacts } from "@/lib/googlePeople";
import { matchPatientToGoogleContact } from "@/lib/logic";
import { NextResponse } from "next/server";

// Confronta ogni paziente con il Contatto Google abbinato e propone le
// differenze su telefono/email/indirizzo. Non scrive nulla: la scrittura
// dei campi accettati resta a carico del client (stesso principio delle
// altre preview di questo progetto — vedi genera-occorrenze-preview,
// chiusura-preview).
function campiDiversi(patient, contact) {
  const proposte = [];
  const telefonoProposto = contact.telefoni?.[0] || "";
  const emailProposta = contact.email?.[0] || "";
  const indirizzoProposto = contact.indirizzo || "";

  if (telefonoProposto && telefonoProposto !== (patient.telefono || "")) {
    proposte.push({
      campo: "telefono",
      valoreAttuale: patient.telefono || "",
      valoreProposto: telefonoProposto,
      tipo: patient.telefono ? "diverso" : "mancante",
    });
  }
  if (emailProposta && emailProposta.toLowerCase() !== (patient.email || "").toLowerCase()) {
    proposte.push({
      campo: "email",
      valoreAttuale: patient.email || "",
      valoreProposto: emailProposta,
      tipo: patient.email ? "diverso" : "mancante",
    });
  }
  if (indirizzoProposto && indirizzoProposto !== (patient.indirizzo || "")) {
    proposte.push({
      campo: "indirizzo",
      valoreAttuale: patient.indirizzo || "",
      valoreProposto: indirizzoProposto,
      tipo: patient.indirizzo ? "diverso" : "mancante",
    });
  }
  return proposte;
}

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

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

  const { data: patients, error: patientsError } = await supabase
    .from("patients")
    .select("id,nome,cognome,nome_calendario,telefono,email,indirizzo")
    .order("id");
  if (patientsError) return NextResponse.json({ error: patientsError.message }, { status: 500 });

  try {
    const contatti = await fetchAllGoogleContacts(tokenRow.refresh_token);

    const righe = [];
    const ambigui = [];
    for (const patient of patients) {
      const { contact, confidence } = matchPatientToGoogleContact(patient, contatti);
      if (confidence === "ambiguo") {
        ambigui.push({ patientId: patient.id, nome: patient.nome_calendario || `${patient.nome || ""} ${patient.cognome || ""}`.trim() });
        continue;
      }
      if (!contact) continue;
      const proposte = campiDiversi(patient, contact);
      if (!proposte.length) continue;
      righe.push({
        patientId: patient.id,
        nome: patient.nome_calendario || `${patient.nome || ""} ${patient.cognome || ""}`.trim(),
        confidence,
        daPosta: !!contact.daPosta,
        proposte,
      });
    }

    return NextResponse.json({ righe, ambigui, avviso: contatti.avviso || null });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
