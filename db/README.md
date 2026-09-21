# Database (Supabase)

Gli script si eseguono **a mano, una sola volta e nell'ordine indicato**, dal SQL
Editor di Supabase (New query → incolla → Run). Sono tutti già stati eseguiti
sul database di produzione: questo elenco serve per ricostruire il database da
zero o per capire da dove viene una colonna.

| # | File | Cosa aggiunge |
| - | --- | --- |
| 1 | `schema.sql` | Tabelle di base: pazienti, impostazioni, storico fatture, fatture in attesa. |
| 2 | `schema_addendum.sql` | Token Google salvato (l'app legge il calendario senza rifare il login). |
| 3 | `schema_addendum2.sql` | Disdette (`cancellations`) con stato di addebito e regola delle 48 ore. |
| 4 | `schema_addendum3.sql` | Slot fissi dei pazienti (`patient_slots`), modello degli slot (`slot_template`), chiusure (`slot_closures`), email del paziente e flag "fuori schema". |
| 5 | `schema_addendum4.sql` | Cadenza "ogni 4 settimane" ammessa negli slot. |
| 6 | `schema_addendum5.sql` | Nome e cognome come campi separati. |
| 7 | `schema_addendum6.sql` | Occorrenze deliberatamente saltate (`skipped_occurrences`). |
| 8 | `schema_addendum7.sql` | Flag "alternanza fissa" sugli slot. |
| 9 | `schema_addendum8.sql` | Telefono del paziente. |
| 10 | `schema_addendum9.sql` | Indirizzo, località, provincia, CAP. |
| 11 | `schema_addendum10.sql` | Email (Resend): registro degli invii (`email_log`), mittente e link di prenotazione nelle impostazioni. |
| 12 | `schema_addendum11.sql` | Occorrenze già generate (`generated_occurrences`), contro le "resuscitazioni". |
| 13 | `schema_addendum12.sql` | Link di prenotazione dedicato alle email di Comunicazioni. |
| 14 | `schema_addendum13.sql` | Modelli di messaggio riutilizzabili. |
| 15 | `schema_addendum14.sql` | Chiusure calendario raggruppate (`calendar_closures`), per modificarle / eliminarle dall'app. |
| 16 | `schema_addendum15.sql` | Tipo di email «prenotazione annullata» nel registro. |
| 17 | `schema_addendum16.sql` | Numero di fattura nello storico (per rigenerare l'Excel). |
| – | `schema_contante.sql` | Quota in contanti non fatturata: `quota_contante_seduta`, `contante_dovuto`, `contante_pagamenti`. Eseguito dopo `schema_addendum.sql`. |

Le intestazioni dei singoli file spiegano nel dettaglio il perché di ogni modifica.
