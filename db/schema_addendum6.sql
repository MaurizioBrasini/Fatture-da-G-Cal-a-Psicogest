-- Da eseguire IN AGGIUNTA a schema.sql, schema_addendum.sql, schema_addendum2.sql,
-- schema_addendum3.sql, schema_addendum4.sql e schema_addendum5.sql già eseguiti.
--
-- Memoria delle occorrenze future deliberatamente escluse da "Genera
-- occorrenze future" (es. Elisabetta U. il 16/9, cancellata apposta da
-- Maurizio) — senza questa tabella, ogni volta che si rilancia il bottone
-- la stessa data mancante ricompare in anteprima e va rideselezionata a
-- mano ogni giro.

create table if not exists skipped_occurrences (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id bigint not null references patients(id) on delete cascade,
  data date not null,
  note text,
  created_at timestamptz not null default now(),
  unique (patient_id, data)
);

alter table skipped_occurrences enable row level security;

create policy "own skipped_occurrences" on skipped_occurrences for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
