-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- Aggiunge a patient_slots il flag "alternanza fissa": alcuni pazienti (o un
-- solo membro di una coppia alternata sulla stessa fascia) non possono
-- cambiare il proprio turno fisso (es. solo 1° e 3° lunedì del mese, mai 2°
-- e 4°) — per loro le chiusure/indisponibilità di Maurizio NON devono far
-- slittare automaticamente le occorrenze future: resta il ritmo fisso
-- impostato, ed è Maurizio a decidere caso per caso cosa fare
-- dell'appuntamento caduto su una data indisponibile.

alter table patient_slots add column if not exists alternanza_fissa boolean not null default false;
