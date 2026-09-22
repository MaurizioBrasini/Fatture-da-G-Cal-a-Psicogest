-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- Durata esplicita di uno slot fisso (richiesta di Maurizio 2026-09-22,
-- caso reale: "Riunione scienziati" dura 2 ore, non i 60 minuti standard).
--
-- Finora "Genera occorrenze future" indovinava la durata di ogni nuova
-- occorrenza dall'ULTIMO evento reale già a calendario per quel paziente
-- (durataMinuti calcolato da inizio/fine dell'evento Google, vedi
-- fetchGoogleCalendarEvents) — funziona, ma l'orizzonte di lettura guarda
-- indietro solo 14 giorni: per una cadenza quindicinale o più larga non è
-- garantito trovarne uno abbastanza recente, e il fallback silenzioso è 60
-- minuti (sbagliato per un impegno di 2 ore). Con questa colonna, se
-- valorizzata, ha sempre la precedenza sull'inferenza — nessuna sorpresa.
--
-- Nullable e retrocompatibile: gli slot esistenti restano null e continuano
-- a inferire la durata dall'ultimo evento reale esattamente come prima.

alter table patient_slots add column if not exists durata_minuti int;
