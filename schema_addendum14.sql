-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- Gestione delle chiusure calendario (modifica / eliminazione dall'app).
-- Finora una chiusura lasciava solo righe sparse in slot_closures (una per
-- fascia weekday+ora coinvolta) e un evento "occupato" su Google Calendar,
-- senza nessun collegamento tra le due cose e senza memoria della finestra
-- originale (date/ore): per questo non si poteva né modificare né annullare.
--
-- calendar_closures: una riga per ogni chiusura registrata, con la finestra
-- continua (data_inizio+ora_inizio → data_fine+ora_fine, ore null = "dall'inizio"
-- / "fino a fine giornata"), la nota e l'id dell'evento "occupato" creato su
-- Google Calendar (null se la creazione dell'evento era fallita).
--
-- slot_closures.closure_id: a quale chiusura appartiene la riga. Nullable per
-- le righe storiche; quelle vengono collegate al primo caricamento
-- dell'elenco chiusure, a partire dagli eventi "Indisponibile…" già presenti
-- sul calendario.

create table if not exists calendar_closures (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data_inizio date not null,
  ora_inizio time,
  data_fine date not null,
  ora_fine time,
  note text,
  google_event_id text,
  created_at timestamptz not null default now(),
  check (data_fine >= data_inizio)
);

alter table calendar_closures enable row level security;

create policy "own calendar_closures" on calendar_closures for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table slot_closures add column if not exists closure_id bigint references calendar_closures(id) on delete set null;

create index if not exists slot_closures_closure_id_idx on slot_closures(closure_id);
