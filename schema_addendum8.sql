-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- Aggiunge "telefono" a patients (email esiste già da schema_addendum3.sql).
-- Servono per contattare il paziente ed evitare di doverli reinserire a mano
-- in Psicogest: vedi il nuovo export "Esporta per Psicogest" in Pazienti,
-- che li scrive nel file .xls di import anagrafica di Psicogest insieme a
-- nome/cognome/codice fiscale.

alter table patients add column if not exists telefono text;
