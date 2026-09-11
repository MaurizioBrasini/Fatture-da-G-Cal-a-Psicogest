-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- Aggiunge indirizzo/localita/provincia/cap a patients: servono per
-- l'export "Esporta per Psicogest" (Psicogest richiede l'indirizzo di
-- residenza per emettere fattura) e vengono popolati la prima volta
-- importandoli dall'export reale Psicogest già in possesso di Maurizio
-- (scripts/popola-indirizzo-da-psicogest.mjs).

alter table patients add column if not exists indirizzo text;
alter table patients add column if not exists localita text;
alter table patients add column if not exists provincia text;
alter table patients add column if not exists cap text;
