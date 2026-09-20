-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- Regola "un solo appuntamento ogni due settimane" sulle prenotazioni online:
-- quando una prenotazione in conflitto viene annullata in automatico si
-- manda un'email al paziente e la si registra in email_log con un tipo
-- dedicato (non 'riprenotazione': quel tipo alimenta l'elenco "da
-- riprenotare" e la sua presenza farebbe sparire un candidato reale).
--
-- Senza questa modifica tutto funziona comunque (annullamento ed email);
-- l'unica cosa che manca è la riga nel registro, e l'app lo segnala.

alter table email_log drop constraint if exists email_log_tipo_check;
alter table email_log add constraint email_log_tipo_check
  check (tipo in ('broadcast', 'riprenotazione', 'prenotazione_annullata'));
