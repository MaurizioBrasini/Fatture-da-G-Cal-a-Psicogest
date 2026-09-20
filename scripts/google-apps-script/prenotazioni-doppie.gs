// Prenotazioni doppie — regola "un solo appuntamento ogni 2 settimane".
// Da incollare su script.google.com (progetto collegato all'account che ha il
// calendario). NON è parte dell'app: gira da solo su Google, a intervalli.
//
// Cosa fa: cerca le prenotazioni arrivate dalla pagina di prenotazione
// ("Prenotazioni online dr. Brasini...") ancora non riconciliate dall'app e
// controlla se chi ha prenotato ha già un altro appuntamento a meno di 14
// giorni (passato o futuro). Se sì: cancella la prenotazione e scrive al
// paziente. Cancella SOLO eventi con quel titolo: mai altri eventi.
//
// PARTI SEMPRE CON DRY_RUN = true: non cancella e non scrive ai pazienti, ti
// manda solo un'email con ciò che farebbe. Controlla per qualche giorno, poi
// metti DRY_RUN = false.
//
// Limiti (l'app fa meglio su questi): riconosce la persona solo dall'email
// dell'invitato (gli appuntamenti creati da te senza invitato non contano), e
// non sa chi ha uno slot fisso — se un paziente fisso deve poter prenotare due
// sostituzioni ravvicinate, aggiungi la sua email a ESCLUSI.

var DRY_RUN = true;
var GIORNI_MIN = 14; // due appuntamenti devono distare almeno 14 giorni
var GIORNI_PASSATO = 13; // guarda indietro: una seduta di 5 giorni fa conta
var GIORNI_FUTURO = 120;
var FUSO = 'Europe/Rome';
var TITOLO_PRENOTAZIONE = /^Prenotazioni online dr\.\s*Brasini/i;
var LINK_PRENOTAZIONI = 'https://calendar.app.google/eWXK76xeVknxzeM86';
var ESCLUSI = []; // email in minuscolo di chi non va mai toccato, es. ['nome@esempio.it']

// Giorni di calendario (in fuso italiano) tra due istanti: evita i falsi
// conflitti dovuti al cambio ora legale/solare.
function giorniTra_(a, b) {
  var da = Utilities.formatDate(a, FUSO, 'yyyy-MM-dd').split('-');
  var db = Utilities.formatDate(b, FUSO, 'yyyy-MM-dd').split('-');
  var ta = Date.UTC(Number(da[0]), Number(da[1]) - 1, Number(da[2]));
  var tb = Date.UTC(Number(db[0]), Number(db[1]) - 1, Number(db[2]));
  return Math.abs(Math.round((ta - tb) / 86400000));
}

// Logica pura (nessuna chiamata a Google): riceve eventi semplici
// [{id, titolo, descrizione, inizio (Date), tuttoIlGiorno, email: [..]}] e
// restituisce [{evento, conflitti}] delle prenotazioni da cancellare.
// Prima si fissano gli appuntamenti già "veri" (non prenotazioni grezze, non
// quelli con nota "disdett*"), poi le prenotazioni grezze in ordine di data:
// la prima resta, le successive troppo vicine a qualcosa di tenuto no.
function trovaDaCancellare_(eventi, esclusi) {
  var perEmail = {};
  eventi.forEach(function (e) {
    if (e.tuttoIlGiorno) return;
    e.email.forEach(function (m) {
      (perEmail[m] = perEmail[m] || []).push(e);
    });
  });

  var risultato = [];
  var giaInclusi = {};
  Object.keys(perEmail).forEach(function (mail) {
    if (esclusi.indexOf(mail) >= 0) return;
    var lista = perEmail[mail].slice().sort(function (a, b) {
      return a.inizio - b.inizio;
    });
    var eGrezza = function (e) {
      return TITOLO_PRENOTAZIONE.test(e.titolo || '');
    };
    var tenuti = lista.filter(function (e) {
      return !eGrezza(e) && !/disdett/i.test(e.descrizione || '');
    });
    lista.filter(eGrezza).forEach(function (c) {
      var conflitti = tenuti.filter(function (t) {
        return giorniTra_(t.inizio, c.inizio) < GIORNI_MIN;
      });
      if (conflitti.length) {
        if (!giaInclusi[c.id]) {
          giaInclusi[c.id] = true;
          risultato.push({ evento: c, conflitti: conflitti, email: mail });
        }
      } else {
        tenuti.push(c);
      }
    });
  });
  return risultato;
}

function formatta_(d) {
  return Utilities.formatDate(d, FUSO, "dd/MM/yyyy 'alle' HH:mm");
}

function gestisciPrenotazioniDoppie() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return; // un'altra esecuzione è già in corso
  try {
    var cal = CalendarApp.getDefaultCalendar();
    var proprietario = Session.getEffectiveUser().getEmail().toLowerCase();
    var adesso = new Date();
    var da = new Date(adesso.getTime() - GIORNI_PASSATO * 86400000);
    var a = new Date(adesso.getTime() + GIORNI_FUTURO * 86400000);

    var oggettiPerId = {};
    var eventi = cal.getEvents(da, a).map(function (ev) {
      oggettiPerId[ev.getId()] = ev;
      return {
        id: ev.getId(),
        titolo: ev.getTitle(),
        descrizione: ev.getDescription(),
        inizio: ev.getStartTime(),
        tuttoIlGiorno: ev.isAllDayEvent(),
        email: ev.getGuestList().map(function (g) {
          return (g.getEmail() || '').toLowerCase();
        }).filter(function (m) {
          return m && m !== proprietario;
        }),
      };
    });

    var daCancellare = trovaDaCancellare_(eventi, ESCLUSI);
    if (!daCancellare.length) return;

    var props = PropertiesService.getScriptProperties();
    var giaSegnalati = JSON.parse(props.getProperty('segnalati') || '[]');
    var righeAvviso = [];

    daCancellare.forEach(function (x) {
      var c = x.evento;
      var conflittiTesto = x.conflitti.map(function (t) {
        return formatta_(t.inizio);
      }).join(', ');
      var riga = x.email + ': prenotazione del ' + formatta_(c.inizio) + ' troppo vicina a ' + conflittiTesto;

      if (DRY_RUN) {
        // In prova avvisa una sola volta per prenotazione, non a ogni giro.
        if (giaSegnalati.indexOf(c.id) < 0) {
          righeAvviso.push('[PROVA] ' + riga);
          giaSegnalati.push(c.id);
        }
        return;
      }

      try {
        oggettiPerId[c.id].deleteEvent();
        MailApp.sendEmail({
          to: x.email,
          name: 'Dr. Maurizio Brasini',
          subject: 'Prenotazione annullata',
          body:
            'Gentile utente,\n\n' +
            'la prenotazione che ha effettuato per il ' + formatta_(c.inizio) + ' è stata annullata, ' +
            'perché risulta già un altro appuntamento a meno di due settimane di distanza (' + conflittiTesto + ').\n\n' +
            'È possibile fissare un solo appuntamento ogni due settimane. Potrà scegliere un nuovo incontro, ' +
            'a distanza di almeno due settimane dall\'altro, da questo link:\n\n' + LINK_PRENOTAZIONI + '\n\n' +
            'Cordiali saluti,\nDr. Maurizio Brasini',
        });
        righeAvviso.push('[CANCELLATA] ' + riga);
      } catch (err) {
        righeAvviso.push('[ERRORE] ' + riga + ' — ' + err.message);
      }
    });

    props.setProperty('segnalati', JSON.stringify(giaSegnalati.slice(-200)));
    if (righeAvviso.length) {
      MailApp.sendEmail(
        proprietario,
        (DRY_RUN ? 'PROVA — ' : '') + 'Prenotazioni doppie: ' + righeAvviso.length + ' da gestire',
        righeAvviso.join('\n')
      );
    }
  } finally {
    lock.releaseLock();
  }
}

// Da eseguire UNA VOLTA per far girare lo script da solo ogni 10 minuti.
function installaTimer() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'gestisciPrenotazioniDoppie') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('gestisciPrenotazioniDoppie').timeBased().everyMinutes(10).create();
}
