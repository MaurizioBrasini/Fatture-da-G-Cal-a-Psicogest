-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- Link di prenotazione dedicato alle email di "Comunicazioni" (broadcast
-- personalizzate con [nome]/[data]/[link]) — separato dal link usato per le
-- email automatiche di riprenotazione dopo una disdetta
-- (link_prenotazioni_online, schema_addendum10.sql), perché Maurizio lo usa
-- per una pagina di prenotazione diversa (es. incontri intermedi).

alter table settings add column if not exists link_comunicazioni text default 'https://calendar.app.google/cYP4PBewfvmv4rKV9';
