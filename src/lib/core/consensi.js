// Testo dei moduli di consenso informato e tariffa da mostrarvi. Testo
// riprodotto fedelmente da Appunti/00. PRIVACY.BRASINI.INDIVIDUALE.docx e
// Appunti/01. REGISTRAZIONI.BRASINI.COPPIA.docx — le uniche parti dinamiche
// sono la tipologia della prestazione e la tariffa reale del paziente (mai
// un prezzo fisso/generico, richiesta di Maurizio 2026-09-22).
import { tariffaStandard } from "./fatture.js";

export const TIPOLOGIA_PRESTAZIONE_LABEL = {
  individuale: "PSICOTERAPIA INDIVIDUALE",
  coppia: "PSICOTERAPIA DI COPPIA",
  consulenza: "CONSULENZA PSICOLOGICA",
  supervisione: "SUPERVISIONE",
};

function formatEuro(n) {
  const v = Math.round((n || 0) * 100) / 100;
  return Number.isInteger(v) ? `${v}/00` : String(v).replace(".", ",");
}

// Stessa tariffaStandard già usata per compilare in automatico costo_unitario
// in Pazienti: il prezzo nel modulo di consenso combacia sempre con quanto
// pagherà davvero quel paziente (agevolato/regolare, individuale/coppia/...).
export function tariffaPerConsenso(tipologia, regime, settings) {
  return tariffaStandard(tipologia, regime, settings);
}

// Le tre dichiarazioni del modulo individuale — ciascuna è un consenso SÌ/NO
// indipendente (mai un unico "accetto tutto"), esattamente come nel .docx
// originale (tre righe "FORNISCE / NON FORNISCE IL CONSENSO").
export const DICHIARAZIONI_INDIVIDUALE = [
  {
    chiave: "consenso_prestazione",
    testo:
      "Visto e compreso tutto quanto sopra indicato, avendo ricevuto apposita informativa professionale e " +
      "informazioni adeguate in relazione a costi, fini e modalità della stessa, esprime il proprio libero " +
      "consenso alla prestazione e al preventivo suindicati.",
  },
  {
    chiave: "consenso_dati_personali",
    testo:
      "Avendo ricevuto apposita informativa sul trattamento dei dati personali e in relazione a quanto indicato " +
      "in relazione al trattamento dei dati relativi al proprio stato di salute, esprime il proprio libero " +
      "consenso al trattamento e alla comunicazione dei propri dati personali per tutte le finalità indicate " +
      "nella presente informativa.",
  },
  {
    chiave: "consenso_sistema_ts",
    testo:
      "In caso di prestazione sanitaria, per l'invio all'Agenzia delle Entrate dei dati anagrafici, di contatto " +
      "e di pagamento tramite flusso telematico su Sistema Tessera Sanitaria, ai fini della dichiarazione dei " +
      "redditi precompilata.",
  },
];

// Testo informativo del modulo individuale (consenso informato + privacy),
// da mostrare per intero PRIMA dei campi anagrafici e delle tre
// dichiarazioni. tariffa/tipologia sono già decise da Maurizio quando ha
// generato l'invito (non modificabili dal paziente).
export function testoInformativaIndividuale({ tipologia, regime, tariffa }) {
  const prestazione = TIPOLOGIA_PRESTAZIONE_LABEL[tipologia] || String(tipologia || "").toUpperCase();
  const regimeTesto = regime === "agevolata" ? " (tariffa agevolata)" : "";
  return [
    "Modulistica unica per la prestazione professionale psicologica",
    "Affidandosi al dott. Maurizio Brasini, il/la sottoscritto/a è informato/a sui seguenti punti in relazione al consenso informato:",
    "lo psicologo è strettamente tenuto ad attenersi al Codice Deontologico degli Psicologi Italiani;",
    `la prestazione offerta riguarda ${prestazione};`,
    "la prestazione è finalizzata ad attività di prevenzione, diagnosi, abilitazione-riabilitazione e/o sostegno in ambito psicologico – (art.1 della legge n.56/1989);",
    "per il conseguimento dell'obiettivo saranno utilizzati prevalentemente i seguenti strumenti: colloquio psicologico, test psicodiagnostici, scale di valutazione;",
    "non è possibile definire a priori il numero di sedute, si concorderanno di volta in volta obiettivi e tempi;",
    "in qualsiasi momento è possibile interrompere il rapporto comunicando al dott. Maurizio Brasini la volontà di interruzione;",
    "il dott. Brasini può valutare ed eventualmente proporre l'interruzione del rapporto quando constata che non vi sia alcun beneficio dall'intervento e non è ragionevolmente prevedibile che ve ne saranno dal proseguimento dello stesso. Se richiesto può fornire le informazioni necessarie a ricercare altri e più adatti interventi (art.27 del Codice Deontologico degli Psicologi Italiani);",
    "le Parti sono tenute alla scrupolosa osservanza delle date e degli orari degli appuntamenti che vengono concordati. In caso di sopravvenuta impossibilità di rispettare l'appuntamento fissato, la Parte impossibilitata è tenuta a darne notizia all'altra entro le 48h che precedono l'incontro. In caso di assenza, il compenso dovuto sarà pari al 100% dell'importo pattuito. Entrambe le Parti si impegnano a rendere attivi e raggiungibili i propri recapiti rispettivamente forniti.",
    `Preventivo di massima (ai sensi dell'art.9 comma 4 del D.L. n.1/2012, convertito con modificazioni dalla Legge n.27/2012, e modificato dal comma 150 della Legge n.124/2017): Prestazione ${prestazione}${regimeTesto} - €. ${formatEuro(tariffa)} per seduta inclusa Cassa Nazionale di Previdenza (ENPAP) 2% (IVA esente). Termini di pagamento: al ricevimento della fattura. Si precisa che il compenso non può essere condizionato all'esito o ai risultati dell'intervento professionale. Il preventivo economico deve comunque intendersi suscettibile di modifiche, da comunicare per iscritto, qualora le prestazioni da svolgere cambino o si integrino radicalmente rispetto a quanto prospettato.`,
    "il dott. Brasini è assicurato con Polizza RC professionale sottoscritta con Allianz Spa n. 503302.",
    "È informato/a sui seguenti punti in relazione al trattamento dei dati personali ai sensi del Regolamento UE 2016/679:",
    "il Regolamento UE 2016/679 (di seguito GDPR) prevede e rafforza la protezione e il trattamento dei dati personali alla luce dei principi di correttezza, liceità, trasparenza, tutela della riservatezza e dei diritti dell'interessato in merito ai propri dati.",
    "il dott. Brasini è titolare del trattamento dei seguenti dati raccolti per lo svolgimento dell'incarico oggetto di questo contratto:",
    "dati anagrafici, di contatto e di pagamento – informazioni relative al nome, numero di telefono, indirizzo PEO e PEC, nonché informazioni relative al pagamento dell'onorario per l'incarico. Presupposto per il trattamento: esecuzione di obblighi contrattuali/precontrattuali. Il conferimento è obbligatorio.",
    "dati relativi allo stato di salute: i dati personali attinenti alla salute fisica o mentale sono raccolti direttamente, in relazione alla richiesta di esecuzione di valutazioni, esami, accertamenti diagnostici, interventi riabilitativi e ogni altra tipologia di servizio di natura professionale connesso con l'esecuzione dell'incarico. Presupposto per il trattamento: esecuzione di obblighi contrattuali/precontrattuali. Il consenso è obbligatorio.",
    "i dati personali saranno sottoposti a modalità di trattamento sia cartaceo sia elettronico e/o automatizzato. In ogni caso saranno adottate tutte le procedure idonee a proteggerne la riservatezza, nel rispetto delle norme vigenti e del segreto professionale.",
    "i dati personali verranno conservati solo per il tempo necessario al conseguimento delle finalità per le quali sono stati raccolti: dati anagrafici, di contatto e di pagamento per 10 anni; dati relativi allo stato di salute per un periodo minimo di 5 anni (art.17 del Codice Deontologico degli Psicologi Italiani).",
    "i dati personali potrebbero dover essere resi accessibili alle Autorità Sanitarie e/o Giudiziarie sulla base di precisi doveri di legge. In tutti gli altri casi, ogni comunicazione potrà avvenire solo previo esplicito consenso.",
    "salvo parere contrario, le informazioni contabili relative alle spese sanitarie verranno trasmesse all'Agenzia delle Entrate, tramite flusso telematico del Sistema Tessera Sanitaria, ai fini dell'elaborazione del mod.730/UNICO precompilato.",
    "sarà possibile all'interessato esercitare i diritti di cui agli articoli da 15 a 22 del GDPR (accesso, rettifica, cancellazione, limitazione del trattamento, portabilità). Per eventuali reclami: Garante per la protezione dei dati personali - piazza di Montecitorio n.121 - 00186 ROMA - PEC: protocollo@pec.gpdp.it.",
  ];
}

// Testo del modulo di registrazione sedute (solo coppie) — vedi
// Appunti/01. REGISTRAZIONI.BRASINI.COPPIA.docx.
export const TESTO_VIDEOREGISTRAZIONE = [
  "PERMESSO PER VIDEOREGISTRARE E REGISTRARE DIGITALMENTE LE SEDUTE TERAPEUTICHE",
  "La videoregistrazione è uno strumento essenziale nell'ambito del Metodo Gottman per la Terapia di Coppia: è parte integrante delle sedute e viene utilizzata per potenziare il lavoro terapeutico e ottenere dei feedback. Ciò implica che il dott. Brasini potrebbe chiedere di videoregistrare alcuni dialoghi o esercizi, oppure un'intera seduta.",
  "Le videoregistrazioni verranno riguardate durante le sedute per riconoscere i pattern comportamentali presenti tra i partner e lavorare sui conflitti, e permetteranno di assistere ai progressi fatti nel corso della terapia.",
  "Oltre a utilizzarle in seduta, il dott. Brasini potrebbe voler utilizzare questi filmati durante le supervisioni con il Dott. John e la Dott.ssa Julie Gottman, oppure con un Supervisore indipendente formato dal Gottman Institute, o ancora per formare altri terapeuti in questo approccio — durante o dopo il trattamento, con obiettivo di revisione tra pari, finalità educative o di garanzia di qualità. Il nome dei partecipanti resterà riservato in questo processo.",
  "Le videoregistrazioni non fanno parte della cartella clinica, non saranno utilizzate per altri fini senza consenso scritto e saranno eliminate non appena non più utili agli scopi sopra indicati. Sono di proprietà del dott. Brasini e rimarranno unicamente in suo possesso durante il corso della terapia. Alcune copie potrebbero essere inviate al Gottman Institute per le finalità sopra indicate. I materiali rimarranno sempre all'interno di ambienti protetti.",
  "Consenso del cliente: comprendo e accetto le condizioni riportate in questa dichiarazione e acconsento alla videoregistrazione o alla registrazione digitale delle mie sedute terapeutiche. Comprendo di poter revocare tale permesso per iscritto in qualsiasi momento — fino a quel momento il permesso rimarrà pienamente in vigore.",
];
