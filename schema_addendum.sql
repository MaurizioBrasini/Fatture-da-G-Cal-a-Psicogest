-- Da eseguire IN AGGIUNTA allo schema.sql già eseguito
-- Conserva il refresh token di Google in modo che l'app possa continuare
-- a leggere il calendario senza chiederti di rifare il login ogni ora.

create table if not exists google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table google_tokens enable row level security;

create policy "own google token" on google_tokens for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
