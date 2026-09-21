-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- Archivio di messaggi email pronti (modelli riutilizzabili) per
-- "Comunicazioni" — salva oggetto+testo con un nome, richiamabile da un
-- menu a tendina invece di riscrivere ogni volta da zero.

create table if not exists message_templates (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  oggetto text not null,
  corpo_testo text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table message_templates enable row level security;

create policy "own message_templates" on message_templates for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
