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

// Converte il testo di un messaggio "Comunicazioni" in HTML, sostituendo il
// segnaposto [link] (se presente) con un bottone "Prenota appuntamento" che
// punta a settings.link_comunicazioni — impossibile da rendere in puro
// testo semplice, per questo è un passaggio separato da testoInHtml/
// personalizzaTesto (quello gestisce solo [nome]/[data], sempre testo).
export function buildBroadcastHtml(corpoTesto, settings) {
  let html = testoInHtml(corpoTesto);
  const url = settings?.link_comunicazioni;
  if (url) {
    const bottone = `<a href="${url}" style="display:inline-block;padding:10px 18px;background:#3E6B4F;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Prenota appuntamento</a>`;
    html = html.replaceAll("[link]", bottone);
  }
  return html;
}

export function buildEmailRiprenotazioneHtml({ nomePaziente, linkPrenotazioni }) {
  return testoInHtml(
    `Gentile ${nomePaziente},\n\n` +
      `a seguito della disdetta del suo appuntamento, può scegliere autonomamente la data e l'ora del prossimo incontro da questo link:\n\n` +
      `${linkPrenotazioni}\n\n` +
      `Cordiali saluti,\nDr. Maurizio Brasini`
  );
}

// Prenotazione online annullata perché il paziente ha già un altro
// appuntamento a meno di due settimane (regola "un solo appuntamento ogni due
// settimane"). `conflitti` = [{data "YYYY-MM-DD", ora}] già formattati come
// testo dal chiamante; `dataPrenotazione`/`oraPrenotazione` idem.
export function buildEmailPrenotazioneAnnullataHtml({ nomePaziente, dataPrenotazione, oraPrenotazione, conflittiTesto, linkPrenotazioni, frequenzaFissa, oltreOrizzonte, riservato, unaSola }) {
  // Giorno/orario non ancora aperto: il calendario è popolato solo fino a una certa data.
  if (riservato) {
    return testoInHtml(
      `Gentile ${nomePaziente},\n\n` +
        `la prenotazione che ha effettuato per il ${dataPrenotazione}${oraPrenotazione ? ` alle ${oraPrenotazione}` : ""} è stata annullata, ` +
        `perché quel giorno e orario non sono ancora disponibili per le prenotazioni.\n\n` +
        (linkPrenotazioni ? `Potrà scegliere un altro incontro, in una data più vicina, da questo link:\n\n${linkPrenotazioni}\n\n` : "\n") +
        `Cordiali saluti,\nDr. Maurizio Brasini`
    );
  }
  // Un solo appuntamento futuro alla volta.
  if (unaSola) {
    return testoInHtml(
      `Gentile ${nomePaziente},\n\n` +
        `la prenotazione che ha effettuato per il ${dataPrenotazione}${oraPrenotazione ? ` alle ${oraPrenotazione}` : ""} è stata annullata, ` +
        `perché risulta già un altro appuntamento fissato (${conflittiTesto}).\n\n` +
        `È possibile avere un solo appuntamento alla volta. ` +
        (linkPrenotazioni ? `Dopo quell'incontro potrà prenotare il successivo da questo link:\n\n${linkPrenotazioni}\n\n` : "\n") +
        `Cordiali saluti,\nDr. Maurizio Brasini`
    );
  }
  // Paziente a schema fisso che prenota oltre l'ultimo appuntamento già in
  // calendario: sarà lui/lei a fissare più avanti, quando il calendario si estende.
  if (oltreOrizzonte) {
    return testoInHtml(
      `Gentile ${nomePaziente},\n\n` +
        `la prenotazione che ha effettuato per il ${dataPrenotazione}${oraPrenotazione ? ` alle ${oraPrenotazione}` : ""} è stata annullata, ` +
        `perché è oltre il periodo per cui il calendario degli incontri è già stato programmato (ultimo incontro fissato: ${conflittiTesto}).\n\n` +
        `Gli incontri successivi verranno fissati più avanti; per esigenze particolari la prego di contattarmi direttamente.\n\n` +
        `Cordiali saluti,\nDr. Maurizio Brasini`
    );
  }
  // Paziente con frequenza concordata: nessun rimando al link, per aumentare
  // le sedute deve parlarne con il dottore.
  if (frequenzaFissa) {
    return testoInHtml(
      `Gentile ${nomePaziente},\n\n` +
        `la prenotazione che ha effettuato per il ${dataPrenotazione}${oraPrenotazione ? ` alle ${oraPrenotazione}` : ""} è stata annullata, ` +
        `perché la frequenza degli incontri concordata è già coperta dagli appuntamenti già fissati (${conflittiTesto}).\n\n` +
        `Se desidera aggiungere o anticipare un incontro, la prego di contattarmi direttamente.\n\n` +
        `Cordiali saluti,\nDr. Maurizio Brasini`
    );
  }
  return testoInHtml(
    `Gentile ${nomePaziente},\n\n` +
      `la prenotazione che ha effettuato per il ${dataPrenotazione}${oraPrenotazione ? ` alle ${oraPrenotazione}` : ""} è stata annullata, ` +
      `perché risulta già un altro appuntamento a meno di due settimane di distanza (${conflittiTesto}).\n\n` +
      `È possibile fissare un solo appuntamento ogni due settimane. ` +
      (linkPrenotazioni ? `Potrà scegliere un nuovo incontro, a distanza di almeno due settimane dall'altro, da questo link:\n\n${linkPrenotazioni}\n\n` : "\n") +
      `Cordiali saluti,\nDr. Maurizio Brasini`
  );
}

export { testoInHtml };
