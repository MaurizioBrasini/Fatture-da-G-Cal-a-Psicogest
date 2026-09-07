-- Da eseguire IN AGGIUNTA a schema.sql e schema_addendum.sql già eseguiti.
-- Registra le disdette/buche rilevate dalla nota "disdetto" sugli eventi di
-- calendario, con lo stato di fatturazione (charged/not_charged) calcolato
-- automaticamente dalla soglia di preavviso di 48h.
--
-- Chiave unica (patient_id, original_date): garantisce che lo stesso
-- paziente+data non venga registrato due volte se "Registra disdette" viene
-- confermato più di una volta sullo stesso evento (idempotenza lato
-- database, non sul testo della nota — la nota "disdetto" resta visibile
-- sull'evento anche dopo la registrazione, volutamente, per pulizia
-- storica sulle buche).

create table if not exists cancellations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id bigint not null references patients(id) on delete cascade,
  event_id text not null,
  original_date date not null,
  cancelled_at timestamptz not null,
  billing_status text not null check (billing_status in ('charged', 'not_charged')),
  created_at timestamptz not null default now(),
  unique (patient_id, original_date)
);

alter table cancellations enable row level security;

create policy "own cancellations" on cancellations for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Nota: la tabella `calendar_cache` (usata da src/app/page.js per il
-- salvataggio degli eventi letti dal calendario) risulta già esistente sul
-- tuo Supabase ma non era mai stata aggiunta a un file schema_*.sql
-- tracciato nel repo. Non la ricreiamo qui per non rischiare di duplicare
-- una policy già presente con lo stesso nome — se un giorno serve
-- ricostruirla da zero, la sua forma (dedotta dall'uso nel codice) è:
--   user_id uuid primary key, from_date date, to_date date,
--   from_hour text, to_hour text, events jsonb, fetched_at timestamptz.
