-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- Esito dell'ultimo giro automatico di "Genera occorrenze future" (cron
-- settimanale, /api/cron/genera-occorrenze): {eseguito_il, creati, falliti,
-- anomalie, errore}. La Dashboard lo mostra in una riga, così un giro andato
-- male (token Google scaduto, troppi eventi da creare...) non passa inosservato.

alter table settings add column if not exists ultima_generazione_auto jsonb;
