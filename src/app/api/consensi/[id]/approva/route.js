// Approva un consenso compilato: genera il/i PDF (con la firma di Maurizio),
// crea il paziente in Pazienti con i dati raccolti, e chiude il giro. Per una
// coppia servono ENTRAMBI i consensi del coppia_gruppo già compilati — crea
// UN SOLO paziente (fatturare_a preso da chi indicato), più il PDF condiviso
// di videoregistrazione oltre ai due PDF individuali.
import { utenteAutenticato } from "@/lib/apiAuth";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { generaPdfIndividuale, generaPdfVideoregistrazione } from "@/lib/consensoPdf";
import { tariffaStandard, quotaContanteStandard, DEFAULT_SETTINGS } from "@/lib/logic";
import { NextResponse } from "next/server";

// Storage via service role in tutta questa rotta: il bucket "consensi" è
// privato e senza policy RLS dedicate — il client normale (anon key +
// sessione) verrebbe bloccato. L'autenticazione vera è già stata controllata
// da utenteAutenticato() sopra, prima di arrivare qui.
async function scaricaFirma(storage, settings) {
  if (!settings.firma_professionista_url) return { firmaBytes: null, firmaTipo: null };
  const { data, error } = await storage.storage.from("consensi").download(settings.firma_professionista_url);
  if (error || !data) return { firmaBytes: null, firmaTipo: null };
  const bytes = new Uint8Array(await data.arrayBuffer());
  const firmaTipo = settings.firma_professionista_url.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return { firmaBytes: bytes, firmaTipo };
}

export async function POST(request, { params }) {
  const { supabase, user, errore } = await utenteAutenticato();
  if (errore) return errore;
  const id = Number(params.id);

  const { data: consenso, error: findError } = await supabase.from("consensi").select("*").eq("id", id).maybeSingle();
  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!consenso) return NextResponse.json({ error: "Consenso non trovato." }, { status: 404 });
  if (consenso.stato !== "compilato") {
    return NextResponse.json({ error: "Questo consenso non è (ancora) compilato, o è già stato approvato." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const { nome_calendario, costo_unitario, quota_contante_seduta, soglia_fatturazione, modalita_pagamento, fatturareAConsensoId } = body;
  if (!nome_calendario) return NextResponse.json({ error: "Nome calendario mancante." }, { status: 400 });

  const { data: settingsRow } = await supabase.from("settings").select("*").maybeSingle();
  const settings = { ...DEFAULT_SETTINGS, ...(settingsRow || {}) };
  const storage = createServiceRoleClient();
  const { firmaBytes, firmaTipo } = await scaricaFirma(storage, settings);
  const approvatoAt = new Date().toISOString();
  const prossimoLunedi = (() => {
    const d = new Date();
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return d.toISOString().slice(0, 10);
  })();

  try {
    if (consenso.tipo === "individuale") {
      const pdfBytes = await generaPdfIndividuale({ ...consenso, approvato_at: approvatoAt }, { firmaBytes, firmaTipo });
      const pdfPath = `pdf/${consenso.id}.pdf`;
      const { error: uploadError } = await storage.storage.from("consensi").upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      const { data: patient, error: patientError } = await supabase
        .from("patients")
        .insert({
          user_id: user.id,
          nome: consenso.nome,
          cognome: consenso.cognome,
          nome_calendario,
          fatturare_a: `${consenso.nome} ${consenso.cognome}`,
          email: consenso.email,
          telefono: consenso.telefono,
          indirizzo: consenso.indirizzo,
          localita: consenso.localita,
          provincia: consenso.provincia,
          cap: consenso.cap,
          codice_fiscale: consenso.codice_fiscale,
          tipologia: consenso.tipologia,
          regime_tariffario: consenso.regime_tariffario,
          costo_unitario: costo_unitario ?? tariffaStandard(consenso.tipologia, consenso.regime_tariffario, settings),
          quota_contante_seduta: quota_contante_seduta ?? quotaContanteStandard(consenso.tipologia, consenso.regime_tariffario, settings),
          soglia_fatturazione: soglia_fatturazione || 5,
          modalita_pagamento: modalita_pagamento || "Bonifico",
          ancora_data: prossimoLunedi,
          ancora_valore: 0,
        })
        .select("id")
        .single();
      if (patientError) throw new Error(patientError.message);

      await supabase.from("consensi").update({ stato: "approvato", approvato_at: approvatoAt, pdf_path: pdfPath, patient_id: patient.id }).eq("id", consenso.id);
      return NextResponse.json({ ok: true, patientId: patient.id });
    }

    // --- Coppia: serve anche il partner, già compilato ---
    const { data: partner, error: partnerError } = await supabase
      .from("consensi")
      .select("*")
      .eq("coppia_gruppo", consenso.coppia_gruppo)
      .neq("id", consenso.id)
      .maybeSingle();
    if (partnerError) throw new Error(partnerError.message);
    if (!partner || partner.stato !== "compilato") {
      return NextResponse.json({ error: "Il/la partner non ha ancora compilato il proprio modulo." }, { status: 409 });
    }

    const fatturareA = fatturareAConsensoId === partner.id ? partner : consenso;

    const pdfA = await generaPdfIndividuale({ ...consenso, approvato_at: approvatoAt }, { firmaBytes, firmaTipo });
    const pdfB = await generaPdfIndividuale({ ...partner, approvato_at: approvatoAt }, { firmaBytes, firmaTipo });
    const pdfVideo = await generaPdfVideoregistrazione(consenso, partner, { firmaBytes, firmaTipo, approvatoAt });

    const pathA = `pdf/${consenso.id}.pdf`;
    const pathB = `pdf/${partner.id}.pdf`;
    const pathVideo = `pdf/video-${consenso.coppia_gruppo}.pdf`;
    for (const [path, bytes] of [[pathA, pdfA], [pathB, pdfB], [pathVideo, pdfVideo]]) {
      const { error: uploadError } = await storage.storage.from("consensi").upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (uploadError) throw new Error(uploadError.message);
    }

    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .insert({
        user_id: user.id,
        nome: fatturareA.nome,
        cognome: fatturareA.cognome,
        nome_calendario,
        fatturare_a: `${fatturareA.nome} ${fatturareA.cognome}`,
        email: fatturareA.email,
        telefono: fatturareA.telefono,
        indirizzo: fatturareA.indirizzo,
        localita: fatturareA.localita,
        provincia: fatturareA.provincia,
        cap: fatturareA.cap,
        codice_fiscale: fatturareA.codice_fiscale,
        tipologia: consenso.tipologia,
        regime_tariffario: consenso.regime_tariffario,
        costo_unitario: costo_unitario ?? tariffaStandard(consenso.tipologia, consenso.regime_tariffario, settings),
        quota_contante_seduta: quota_contante_seduta ?? quotaContanteStandard(consenso.tipologia, consenso.regime_tariffario, settings),
        soglia_fatturazione: soglia_fatturazione || 5,
        modalita_pagamento: modalita_pagamento || "Bonifico",
        ancora_data: prossimoLunedi,
        ancora_valore: 0,
      })
      .select("id")
      .single();
    if (patientError) throw new Error(patientError.message);

    await supabase
      .from("consensi")
      .update({ stato: "approvato", approvato_at: approvatoAt, patient_id: patient.id })
      .eq("coppia_gruppo", consenso.coppia_gruppo);
    await supabase.from("consensi").update({ pdf_path: pathA, pdf_path_video: pathVideo }).eq("id", consenso.id);
    await supabase.from("consensi").update({ pdf_path: pathB, pdf_path_video: pathVideo }).eq("id", partner.id);

    return NextResponse.json({ ok: true, patientId: patient.id });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
