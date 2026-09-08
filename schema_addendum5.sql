-- Da eseguire IN AGGIUNTA a schema.sql, schema_addendum.sql, schema_addendum2.sql,
-- schema_addendum3.sql e schema_addendum4.sql già eseguiti.
--
-- Aggiunge nome/cognome come campi separati in patients (finora esisteva solo
-- "fatturare_a" con nome e cognome uniti in un'unica stringa "COGNOME Nome").
-- Servono per le nuove colonne Nome/Cognome nella schermata Pazienti
-- dell'app. Non toccano fatturare_a, che resta la stringa usata per le
-- fatture Psicogest.

alter table patients add column if not exists nome text;
alter table patients add column if not exists cognome text;
