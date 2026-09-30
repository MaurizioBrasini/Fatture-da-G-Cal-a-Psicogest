-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- "Registra disdette" (Dashboard): quando Maurizio toglie la spunta a una
-- disdetta proposta o a un duplicato da ripulire e conferma, quella scelta
-- viene ricordata qui e l'evento non viene più riproposto (caso reale
-- 2026-09-30: un evento valido veniva ripresentato a ogni scansione).
-- L'ultima parola resta sua: dall'elenco "Scartati" può rimettere in
-- proposta qualunque evento (si cancella la riga).
--
-- La chiave è l'id dell'evento Google: se l'evento viene davvero ricreato
-- (nuovo id) torna a essere proposto.

create table if not exists disdette_scartate (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  tipo text not null check (tipo in ('disdetta', 'duplicato')),
  patient_id bigint references patients(id) on delete cascade,
  data date,
  ora text,
  nome text,
  created_at timestamptz not null default now(),
  unique (user_id, event_id, tipo)
);

alter table disdette_scartate enable row level security;
create policy "own disdette_scartate" on disdette_scartate for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
