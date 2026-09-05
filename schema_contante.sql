-- Da eseguire IN AGGIUNTA a schema.sql + schema_addendum.sql già eseguiti
-- Gestione della quota in contanti non fatturata (es. paziente che paga
-- 60€ in fattura + 10€ a parte in contanti, mai su Psicogest).

alter table patients add column if not exists quota_contante_seduta numeric not null default 0;
alter table patients add column if not exists contante_dovuto numeric not null default 0;

create table if not exists contante_pagamenti (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id bigint references patients(id) on delete set null,
  importo numeric not null,
  data date not null,
  created_at timestamptz not null default now()
);

alter table contante_pagamenti enable row level security;

create policy "own contante pagamenti" on contante_pagamenti for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
