-- Schema per "Fatture da G-Cal a Psicogest"
-- Da eseguire in Supabase: SQL Editor -> New query -> incolla ed esegui

create table if not exists patients (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  nome_calendario text not null default '',
  fatturare_a text not null default '',
  codice_fiscale text not null default '',
  tipologia text not null default 'individuale', -- individuale | coppia | consulenza
  costo_unitario numeric not null default 0,
  soglia_fatturazione int not null default 5,
  giorni_stale_override int,
  ancora_data date,
  ancora_valore int not null default 0,
  modalita_pagamento text not null default 'Bonifico',
  stato text not null default 'attivo',
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  soglia_default int not null default 5,
  giorni_stale int not null default 60,
  bollo_soglia numeric not null default 77.47,
  prestazione_individuale text not null default 'psicoterapia individuale',
  prestazione_coppia text not null default 'psicoterapia di coppia',
  prestazione_consulenza text not null default 'consulenza psicologica'
);

create table if not exists invoice_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id bigint references patients(id) on delete set null,
  data date not null,
  codice_fiscale text not null default '',
  totale_sedute int not null default 0,
  onorario numeric not null default 0,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists pending_batch (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data_fattura date not null,
  rows jsonb not null,
  patient_ids bigint[] not null,
  created_at timestamptz not null default now()
);

alter table patients enable row level security;
alter table settings enable row level security;
alter table invoice_history enable row level security;
alter table pending_batch enable row level security;

create policy "own patients" on patients for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own settings" on settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own history" on invoice_history for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own pending" on pending_batch for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
