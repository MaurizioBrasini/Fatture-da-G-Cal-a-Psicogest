-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- Chiude il bug reale scoperto il 2026-09-11 (Alessandra C., Flavia e
-- Edoardo, Clara e Christian ricomparsi più volte dopo essere stati
-- cancellati): "Genera occorrenze future" non aveva modo di distinguere
-- "questa data non è mai esistita" (sicuro da creare) da "questa data era
-- stata generata e poi cancellata direttamente su Google Calendar, senza
-- passare da nessun flusso dell'app" (NON va mai ricreata in automatico).
-- generated_occurrences registra ogni volta che un'occorrenza viene creata,
-- così una cancellazione diretta su Google Calendar (che Maurizio deve
-- poter continuare a fare, è un'azione legittima) viene riconosciuta come
-- anomalia da decidere esplicitamente invece che silenziosamente ricreata.

create table if not exists generated_occurrences (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id bigint not null references patients(id) on delete cascade,
  data date not null,
  created_at timestamptz not null default now(),
  unique (patient_id, data)
);

alter table generated_occurrences enable row level security;

create policy "own generated_occurrences" on generated_occurrences for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
