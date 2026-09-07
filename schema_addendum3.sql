-- Da eseguire IN AGGIUNTA a schema.sql, schema_addendum.sql e schema_addendum2.sql
-- già eseguiti.
--
-- Introduce gli "slot fissi" del piano settimanale/quindicinale generale
-- (patient_slots), il template delle fasce orarie disponibili in generale
-- (slot_template) e le chiusure straordinarie di una fascia (slot_closures) —
-- usate per ferie/festività su uno specifico weekday+orario, condivise da
-- entrambi i pazienti di un'eventuale coppia quindicinale che occupa quella
-- fascia (si interrogano per weekday+time_of_day, non serve un collegamento
-- esplicito al singolo patient_slot).
--
-- Aggiunge anche a `patients`:
--   email       - servirà più avanti per abbinare le prenotazioni fatte
--                 dai pazienti stessi tramite l'Appointment Schedule
--                 (matching non ancora implementato in questa fase).
--   fuori_schema - true per i pazienti "ad hoc" che non hanno una riga in
--                 patient_slots e prenotano di volta in volta uno slot
--                 libero: gestito da un semplice interruttore nella pagina
--                 pazienti, così Maurizio può aggiungere/togliere chi vuole
--                 senza bisogno di uno script.
--
-- `add column if not exists` per sicurezza: alcune colonne già usate dal
-- codice (es. regime_tariffario, contante_dovuto) risultano presenti sul
-- Supabase live senza essere mai state aggiunte a un file schema_*.sql
-- tracciato — quindi non possiamo escludere che altre piccole modifiche
-- dirette siano state fatte anche a patients.

alter table patients add column if not exists email text;
alter table patients add column if not exists fuori_schema boolean not null default false;

-- Uno slot fisso ricorrente di un paziente: un giorno della settimana + ora,
-- con cadenza settimanale (7) o quindicinale (14). Per una coppia
-- quindicinale che si alterna sulla stessa fascia, ci sono DUE righe (una
-- per paziente) con lo stesso weekday+time_of_day ma anchor_date sfalsate di
-- 7 giorni.
create table if not exists patient_slots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id bigint not null references patients(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  time_of_day time not null,
  interval_days smallint not null check (interval_days in (7, 14)),
  anchor_date date not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table patient_slots enable row level security;

create policy "own patient_slots" on patient_slots for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Stato generale di ciascuna fascia weekday+ora dello studio, a prescindere
-- dal singolo paziente che la occupa in un dato momento (serve per sapere
-- quali fasce sono aperte/chiuse in generale, es. per proporre slot liberi).
create table if not exists slot_template (
  weekday smallint not null check (weekday between 0 and 6),
  time_of_day time not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('attivo', 'indisponibile')),
  note text,
  primary key (weekday, time_of_day)
);

alter table slot_template enable row level security;

create policy "own slot_template" on slot_template for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Chiusura straordinaria di una singola data su una fascia weekday+ora
-- (es. ferie, festività): si applica a chiunque occupi quella fascia quella
-- settimana, quindi non ha bisogno di riferire un patient_slot specifico.
create table if not exists slot_closures (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  time_of_day time not null,
  closure_date date not null,
  note text,
  created_at timestamptz not null default now()
);

alter table slot_closures enable row level security;

create policy "own slot_closures" on slot_closures for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
