-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- Integrazione email (Resend): invio broadcast a tutti i pazienti (es.
-- chiusura natalizia) ed email automatica di riprenotazione dopo una
-- disdetta, con il link "Prenotazioni online dr. Brasini".

-- Mittente e link di prenotazione, modificabili da Impostazioni.
alter table settings add column if not exists email_mittente_nome text default 'Dr. Maurizio Brasini';
alter table settings add column if not exists email_mittente_indirizzo text default 'maurizio.brasini@psiconet.it';
alter table settings add column if not exists link_prenotazioni_online text default 'https://calendar.app.google/eWXK76xeVknxzeM86';

-- Log di ogni email inviata (broadcast o riprenotazione), per storico in
-- "Comunicazioni" e per evitare invii doppi. batch_id raggruppa le righe di
-- uno stesso invio broadcast (nullo per le email di riprenotazione, una per
-- volta).
create table if not exists email_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid,
  patient_id bigint references patients(id) on delete set null,
  email text not null,
  oggetto text not null,
  tipo text not null check (tipo in ('broadcast', 'riprenotazione')),
  stato text not null check (stato in ('ok', 'errore')),
  errore text,
  created_at timestamptz not null default now()
);

alter table email_log enable row level security;

create policy "own email_log" on email_log for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
