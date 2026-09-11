// Invio email via Resend. Mittente e link di prenotazione vengono da
// `settings` (modificabili in Impostazioni), non hardcoded, così Maurizio
// può cambiarli senza toccare codice. RESEND_API_KEY va in .env.local (e
// nelle env var di Vercel per la produzione) — mai committato.

import { Resend } from "resend";

function testoInHtml(testo) {
  // Composizione semplice: converte il testo semplice scritto nel modulo
  // (a capo singolo = <br>, riga vuota = nuovo paragrafo) in HTML minimo,
  // senza dipendere da un editor rich-text lato client.
  return testo
    .split(/\n{2,}/)
    .map((par) => `<p>${par.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export async function sendEmail({ settings, to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY non configurata.");
  const resend = new Resend(apiKey);
  const fromNome = settings?.email_mittente_nome || "Dr. Maurizio Brasini";
  const fromIndirizzo = settings?.email_mittente_indirizzo || "maurizio.brasini@psiconet.it";
  const { error } = await resend.emails.send({
    from: `${fromNome} <${fromIndirizzo}>`,
    to,
    replyTo: fromIndirizzo,
    subject,
    html,
  });
  if (error) throw new Error(error.message || "Errore Resend non specificato.");
}

export function buildEmailRiprenotazioneHtml({ nomePaziente, linkPrenotazioni }) {
  return testoInHtml(
    `Gentile ${nomePaziente},\n\n` +
      `a seguito della disdetta del suo appuntamento, può scegliere autonomamente la data e l'ora del prossimo incontro da questo link:\n\n` +
      `${linkPrenotazioni}\n\n` +
      `Cordiali saluti,\nDr. Maurizio Brasini`
  );
}

export { testoInHtml };
