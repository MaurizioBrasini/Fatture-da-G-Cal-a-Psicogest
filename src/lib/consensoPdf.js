// Genera i PDF dei moduli di consenso compilati e firmati — solo server
// (pdf-lib), mai lato client. Testo semplice, wrap manuale, niente
// impaginazione elaborata: quello che conta è che ci sia tutto (testo
// informativo, dati, consensi sì/no, firma) non che assomigli pixel per
// pixel al .docx originale.
//
// Due funzioni distinte, fedeli ai due moduli originali:
// - generaPdfIndividuale: SEMPRE uno a persona (anche per una coppia — sono
//   due consensi individuali separati, uno a testa).
// - generaPdfVideoregistrazione: SOLO coppie, UN documento condiviso con le
//   firme di entrambi i partner (il modulo originale ha due righe firma
//   cliente sulla stessa pagina).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { testoInformativaIndividuale, DICHIARAZIONI_INDIVIDUALE, TESTO_VIDEOREGISTRAZIONE } from "./core/consensi.js";
import { formatDataItaliana } from "./core/util.js";

const PAGE_WIDTH = 595.28; // A4, punti
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const MAX_WIDTH = PAGE_WIDTH - MARGIN * 2;
const SIZE_TESTO = 10;
const SIZE_TITOLO = 14;
const LINE_HEIGHT = 13;

function wrapText(text, font, size, maxWidth) {
  const parole = String(text).split(/\s+/);
  const righe = [];
  let riga = "";
  for (const parola of parole) {
    const prova = riga ? `${riga} ${parola}` : parola;
    if (font.widthOfTextAtSize(prova, size) > maxWidth && riga) {
      righe.push(riga);
      riga = parola;
    } else {
      riga = prova;
    }
  }
  if (riga) righe.push(riga);
  return righe;
}

// Crea un "writer" con paginazione automatica, condiviso dalle due funzioni
// di generazione sotto.
async function creaWriter() {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function nuovaPaginaSeServe(altezza = LINE_HEIGHT) {
    if (y - altezza < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }
  function scrivi(testo, { bold = false, size = SIZE_TESTO, gapDopo = 8 } = {}) {
    const f = bold ? fontBold : font;
    for (const riga of wrapText(testo, f, size, MAX_WIDTH)) {
      nuovaPaginaSeServe();
      page.drawText(riga, { x: MARGIN, y, size, font: f, color: rgb(0, 0, 0) });
      y -= LINE_HEIGHT;
    }
    y -= gapDopo;
  }
  async function disegnaFirmaImmagine(bytes, tipo) {
    if (!bytes) return;
    try {
      const isPng = tipo === "image/png";
      const immagine = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      const altezzaImg = 50;
      const larghezzaImg = (immagine.width / immagine.height) * altezzaImg;
      nuovaPaginaSeServe(altezzaImg + 10);
      page.drawImage(immagine, { x: MARGIN, y: y - altezzaImg, width: larghezzaImg, height: altezzaImg });
      y -= altezzaImg + 6;
    } catch {
      scrivi("(firma non disponibile)");
    }
  }
  return { pdfDoc, scrivi, disegnaFirmaImmagine, get y() { return y; } };
}

function scriviAnagrafica(scrivi, c) {
  scrivi(`Nome e cognome: ${c.nome || ""} ${c.cognome || ""}`);
  scrivi(`Nato/a a ${c.luogo_nascita || "—"} il ${c.data_nascita ? formatDataItaliana(c.data_nascita) : "—"}`);
  scrivi(`Residente in ${c.indirizzo || "—"}, ${c.cap || ""} ${c.localita || ""} (${c.provincia || ""})`);
  scrivi(`Codice fiscale: ${c.codice_fiscale || "—"}`);
  scrivi(`Telefono: ${c.telefono || "—"} — Email: ${c.email || "—"}`, { gapDopo: 16 });
}

function scriviFirmaCliente(scrivi, c, etichetta = "Firma del paziente (firma elettronica semplice)") {
  scrivi(etichetta, { bold: true, gapDopo: 4 });
  scrivi(`Firmato digitalmente da: ${c.nome || ""} ${c.cognome || ""}`);
  scrivi(`Data e ora: ${c.compilato_at ? new Date(c.compilato_at).toLocaleString("it-IT") : "—"}`);
  scrivi(`Indirizzo IP di compilazione: ${c.ip_compilazione || "—"}`, { gapDopo: 16 });
}

async function scriviFirmaProfessionista(w, firmaBytes, firmaTipo, approvatoAt) {
  w.scrivi("Firma del Professionista", { bold: true, gapDopo: 4 });
  await w.disegnaFirmaImmagine(firmaBytes, firmaTipo);
  w.scrivi("Dott. Maurizio Brasini");
  w.scrivi(`Approvato il: ${approvatoAt ? new Date(approvatoAt).toLocaleString("it-IT") : "—"}`);
}

// Un consenso individuale (sempre uno a persona, anche per una coppia).
export async function generaPdfIndividuale(consenso, { firmaBytes, firmaTipo } = {}) {
  const w = await creaWriter();
  w.scrivi("Modulo di consenso informato", { bold: true, size: SIZE_TITOLO, gapDopo: 14 });
  w.scrivi("Dati anagrafici", { bold: true, gapDopo: 4 });
  scriviAnagrafica(w.scrivi, consenso);

  for (const paragrafo of testoInformativaIndividuale({
    tipologia: consenso.tipologia,
    regime: consenso.regime_tariffario,
    tariffa: consenso.tariffa,
  })) {
    w.scrivi(paragrafo);
  }

  w.scrivi("Consensi", { bold: true, gapDopo: 4 });
  for (const d of DICHIARAZIONI_INDIVIDUALE) {
    w.scrivi(d.testo, { gapDopo: 2 });
    const dato = consenso[d.chiave];
    w.scrivi(`→ ${dato === true ? "SÌ, fornisce il consenso" : dato === false ? "NO, non fornisce il consenso" : "(non specificato)"}`, {
      bold: true,
      gapDopo: 12,
    });
  }

  scriviFirmaCliente(w.scrivi, consenso);
  await scriviFirmaProfessionista(w, firmaBytes, firmaTipo, consenso.approvato_at);
  return w.pdfDoc.save();
}

// Modulo condiviso di videoregistrazione (solo coppie) — un unico documento
// con le firme di ENTRAMBI i partner, fedele all'originale.
export async function generaPdfVideoregistrazione(consensoA, consensoB, { firmaBytes, firmaTipo, approvatoAt } = {}) {
  const w = await creaWriter();
  w.scrivi("Permesso per videoregistrare e registrare digitalmente le sedute terapeutiche", { bold: true, size: SIZE_TITOLO, gapDopo: 14 });
  w.scrivi(`Coppia: ${consensoA.nome} ${consensoA.cognome} e ${consensoB.nome} ${consensoB.cognome}`, { bold: true, gapDopo: 10 });

  for (const paragrafo of TESTO_VIDEOREGISTRAZIONE) {
    w.scrivi(paragrafo);
  }

  w.scrivi("Consenso di entrambi i partner", { bold: true, gapDopo: 4 });
  for (const c of [consensoA, consensoB]) {
    scriviAnagrafica(w.scrivi, c);
    w.scrivi(`→ ${c.consenso_videoregistrazione ? "SÌ, acconsente alla videoregistrazione" : "NO, non acconsente alla videoregistrazione"}`, {
      bold: true,
      gapDopo: 4,
    });
    scriviFirmaCliente(w.scrivi, c, "Firma");
  }

  await scriviFirmaProfessionista(w, firmaBytes, firmaTipo, approvatoAt);
  return w.pdfDoc.save();
}
