-- Da eseguire IN AGGIUNTA agli schema_addendum* già eseguiti.
--
-- Moduli di consenso informato (richiesta di Maurizio 2026-09-22): link
-- unico e univoco mandato a un futuro paziente prima del primo incontro,
-- che raccoglie l'anagrafica Psicogest (nome, cognome, luogo/data di
-- nascita, residenza, codice fiscale, telefono, email) e i consensi
-- (prestazione+preventivo, dati personali/salute, invio Sistema Tessera
-- Sanitaria, e per le coppie anche la videoregistrazione delle sedute) —
-- firma elettronica semplice (nome + checkbox), non SPID/firma disegnata.
--
-- Una riga per PERSONA invitata (una coppia = due righe, stesso
-- coppia_gruppo per abbinarle in revisione) — mai scritta direttamente in
-- `patients`: resta "da rivedere" finché Maurizio non approva.
--
-- IP/user agent/ID dell'invio email sono la prova che la compilazione è
-- arrivata davvero dal link mandato al paziente, non da Maurizio stesso.

create table if not exists consensi (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,

  -- impostati da Maurizio quando genera l'invito
  tipo text not null default 'individuale', -- individuale | coppia
  coppia_gruppo uuid, -- stesso valore per i due inviti di una coppia
  -- Spesso il primo contatto è solo un numero WhatsApp, non un'email
  -- (richiesta di Maurizio 2026-09-22) — nome/email/telefono sono tutti
  -- facoltativi, solo promemoria per Maurizio: l'identità vera è quella che
  -- la persona scrive compilando il modulo, provata da IP/orario/token
  -- univoco (vedi sotto), non dal canale di invio.
  nome_invitato text not null default '',
  email_invitato text not null default '',
  telefono_invitato text not null default '',
  tipologia text not null default 'individuale', -- individuale | coppia | consulenza | supervisione
  regime_tariffario text not null default 'regolare',
  tariffa numeric, -- prezzo a seduta al momento dell'invio, stampato nel PDF
  resend_message_id text, -- prova che l'email è partita verso email_invitato
  stato text not null default 'inviato', -- inviato | compilato | approvato

  -- compilati dal paziente
  nome text,
  cognome text,
  luogo_nascita text,
  data_nascita date,
  indirizzo text,
  cap text,
  provincia text,
  localita text,
  codice_fiscale text,
  telefono text,
  email text,
  consenso_prestazione boolean,
  consenso_dati_personali boolean,
  consenso_sistema_ts boolean,
  consenso_videoregistrazione boolean, -- solo tipo = coppia
  compilato_at timestamptz,
  ip_compilazione text,
  user_agent_compilazione text,

  -- esito della revisione di Maurizio
  patient_id bigint references patients(id) on delete set null,
  approvato_at timestamptz,
  pdf_path text, -- PDF del consenso individuale (sempre uno a persona)
  pdf_path_video text, -- PDF condiviso di videoregistrazione (solo coppie, stesso su entrambe le righe della coppia)

  created_at timestamptz not null default now()
);

alter table consensi enable row level security;
create policy "own consensi" on consensi for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Firma di Maurizio (immagine caricata una volta, riusata su ogni PDF) e URL
-- pubblico dell'app (serve per comporre il link /consenso/<token> nell'email
-- — da impostare in Impostazioni con l'indirizzo reale del deploy Vercel,
-- nessun default indovinato).
alter table settings add column if not exists firma_professionista_url text;
alter table settings add column if not exists app_base_url text;
