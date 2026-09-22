// Genera 1 (individuale) o 2 (coppia, stesso coppia_gruppo) inviti al
// modulo di consenso informato. Restituisce SEMPRE il link generato (da
// copiare e mandare a mano, es. via WhatsApp — spesso il primo contatto è
// solo un numero di telefono, non un'email, richiesta di Maurizio
// 2026-09-22); se per una persona è stata data un'email, manda ANCHE
// un'email automatica con lo stesso link. Autenticato: solo Maurizio può
// generare inviti.
import { utenteAutenticato } from "@/lib/apiAuth";
import { sendEmail, buildEmailConsensoHtml } from "@/lib/email";
import { tariffaPerConsenso, DEFAULT_SETTINGS } from "@/lib/logic";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

export async function POST(request) {
  const { supabase, user, errore } = await utenteAutenticato();
  if (errore) return errore;

  const body = await request.json().catch(() => ({}));
  const { tipo, tipologia, regime_tariffario, persone } = body;
  if (!["individuale", "coppia"].includes(tipo)) {
    return NextResponse.json({ error: "Tipo non valido." }, { status: 400 });
  }
  const attese = tipo === "coppia" ? 2 : 1;
  if (!Array.isArray(persone) || persone.length !== attese) {
    return NextResponse.json({ error: `Servono ${attese} persona/e (basta un nome/etichetta, anche provvisorio).` }, { status: 400 });
  }

  const { data: settingsRow } = await supabase.from("settings").select("*").maybeSingle();
  const settings = { ...DEFAULT_SETTINGS, ...(settingsRow || {}) };
  if (!settings.app_base_url) {
    return NextResponse.json(
      { error: "Imposta prima l'indirizzo dell'app (URL Vercel) in Impostazioni." },
      { status: 400 }
    );
  }

  const tariffa = tariffaPerConsenso(tipologia, regime_tariffario, settings);
  const coppiaGruppo = tipo === "coppia" ? randomUUID() : null;

  const risultati = [];
  for (const [i, persona] of persone.entries()) {
    const nomeEtichetta = (persona.nome || "").trim() || (tipo === "coppia" ? `Partner ${i + 1}` : "Paziente");
    try {
      const { data: riga, error: insertError } = await supabase
        .from("consensi")
        .insert({
          user_id: user.id,
          tipo,
          coppia_gruppo: coppiaGruppo,
          nome_invitato: nomeEtichetta,
          email_invitato: (persona.email || "").trim(),
          telefono_invitato: (persona.telefono || "").trim(),
          tipologia,
          regime_tariffario,
          tariffa,
          stato: "inviato",
        })
        .select("id, token")
        .single();
      if (insertError) throw new Error(insertError.message);

      const link = `${settings.app_base_url.replace(/\/$/, "")}/consenso/${riga.token}`;
      let emailInviata = false;
      if (persona.email) {
        const { id: resendId } = await sendEmail({
          settings,
          to: persona.email,
          subject: "Modulo di consenso informato",
          html: buildEmailConsensoHtml({ nomeInvitato: nomeEtichetta, link }),
        });
        await supabase.from("consensi").update({ resend_message_id: resendId }).eq("id", riga.id);
        emailInviata = true;
      }

      risultati.push({ nome: nomeEtichetta, email: persona.email || null, link, emailInviata, ok: true });
    } catch (e) {
      risultati.push({ nome: nomeEtichetta, ok: false, error: e.message });
    }
  }

  const falliti = risultati.filter((r) => !r.ok);
  return NextResponse.json({ ok: falliti.length === 0, risultati });
}
