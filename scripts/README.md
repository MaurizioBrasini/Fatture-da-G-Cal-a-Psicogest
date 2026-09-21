# Script di servizio

Non fanno parte dell'app: si lanciano a mano da terminale (`node scripts/nome.mjs`)
e leggono le chiavi da `.env.local`. Quelli che scrivono sul database o sul
calendario hanno una prova a vuoto (dry-run) o chiedono `--apply`: leggere
l'intestazione di ciascun file prima di lanciarlo.

## Riutilizzabili (in questa cartella)

| Script | A cosa serve |
| --- | --- |
| `test-logic.mjs` | Test automatici della logica (`npm test`). Da lanciare dopo ogni modifica a `src/lib/`. |
| `audit-generale.mjs` | Controllo di coerenza, in sola lettura, tra ancora del paziente, conteggio mostrato in app e ultimo codice scritto sul calendario. |
| `rinumera-calendario.mjs` | Rinumerazione delle note del calendario da riga di comando (stesso calcolo del pulsante "Rinumera"). |
| `normalizza-telefoni.mjs` | Toglie prefisso e spazi dai numeri di telefono. Da rilanciare dopo ogni import da Psicogest (lo re-inserisce). |
| `popola-contatti-da-psicogest.mjs` | Riempie codice fiscale, telefono ed email vuoti a partire da un export Psicogest. |
| `popola-indirizzo-da-psicogest.mjs` | Riempie indirizzo, località, provincia e CAP vuoti dallo stesso export. |

## `archivio/`

Interventi già eseguiti una volta sola (migrazione del calendario, correzioni
su singoli pazienti, audit, riconciliazioni, backfill) e strumenti superati
(l'analisi degli slot è ora la pagina «Disponibilità» dell'app; lo script
Google Apps Script per le prenotazioni doppie non va installato perché il
controllo è fatto dall'app). Si conservano come documentazione di cosa è stato
fatto e come; non vanno rilanciati senza rileggerli, perché i dati sono cambiati.
