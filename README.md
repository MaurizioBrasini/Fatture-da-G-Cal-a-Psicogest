# Gestione pazienti (Fatture da G-Cal a Psicogest)

## Cos'è

Applicazione dello studio che collega Google Calendar, l'anagrafica dei
pazienti e Psicogest:

- **Dashboard**: legge gli appuntamenti dal calendario, li abbina ai pazienti,
  conta le sedute verso la soglia di fatturazione e genera l'Excel per
  l'importazione massiva su Psicogest (Strumenti → Importa fatture).
- **Pazienti**: anagrafica, slot fissi (settimanale / quindicinale / mensile),
  tariffe, quota e incassi in contanti, stato (attivo / sospeso dalla
  fatturazione / concluso).
- **Disponibilità**: griglia degli slot liberi ricavata dagli slot dei pazienti,
  chiusure del calendario.
- **Prenotazioni online**: riconciliazione delle prenotazioni fatte dal link
  Google, con le regole di frequenza e di calendario già popolato.
- **Disdette**, **Storico** (fatture emesse, rigenerazione Excel),
  **Comunicazioni** (email ai pazienti), **Impostazioni**.

## Struttura del codice

```
src/
  app/            Pagine (Next.js) e rotte API (app/api/…)
  components/     Finestre e pezzi di interfaccia riutilizzati
  lib/
    logic.js      Indice: riesporta tutto ciò che sta in core/
    core/         Logica applicativa pura (nessun accesso a rete o database),
                  un file per argomento: util, slot, pazienti, disdette,
                  fatture, rinumerazione, prenotazioni, chiusure
    apiAuth.js    Controllo utente comune alle rotte API
    googleCalendar.js, googlePeople.js, email.js, supabase/   Servizi esterni
db/               Script SQL per Supabase, con l'ordine di esecuzione (db/README.md)
scripts/          Test automatici e script di servizio (scripts/README.md)
```

La regola pratica: **le decisioni stanno in `src/lib/core/`** (testate con
`npm test`), le pagine e le rotte si limitano a leggere/scrivere dati e a
mostrare il risultato.

## Dopo ogni modifica

```
npm test        # test della logica (scripts/test-logic.mjs)
npm run build   # verifica che l'app compili
```

## Prima di avviare in locale (o pubblicare)

1. Crea il file `.env.local` copiando `.env.local.example` e compilalo con:
   - `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` — da
     Supabase: Project Settings → API.
   - `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` — da Google Cloud Console:
     Credenziali → il tuo Client OAuth.
2. Esegui su Supabase gli script di `db/` nell'ordine descritto in `db/README.md`.
3. Su Supabase, Authentication → Providers → Google: incolla Client ID e
   Client secret, e copia il "Redirect URL" che ti mostra — va aggiunto tra
   gli "URI di reindirizzamento autorizzati" nel Client OAuth su Google Cloud
   Console.
4. Su Google Cloud Console, aggiungi anche `http://localhost:3000/auth/callback`
   tra gli URI di reindirizzamento autorizzati (per provare in locale).

## Avvio in locale

```
npm install
npm run dev
```

Apri http://localhost:3000 — verrai reindirizzato al login, poi ad accedere
con Google (la prima volta chiede il permesso di lettura del calendario).

## Pubblicazione su Vercel

1. Importa il repository GitHub su vercel.com.
2. Nelle variabili d'ambiente del progetto Vercel, inserisci le stesse
   variabili di `.env.local`.
3. Dopo il primo deploy, prendi l'indirizzo che ti dà Vercel (es.
   `https://tuo-progetto.vercel.app`) e aggiungi
   `https://tuo-progetto.vercel.app/auth/callback` tra gli URI di
   reindirizzamento autorizzati su Google Cloud Console.
4. Finché la schermata di consenso OAuth di Google resta in modalità
   "Testing", solo gli indirizzi email aggiunti come "Test users" (Google
   Auth Platform → Audience) potranno accedere — sufficiente per un uso
   personale/di studio, nessuna verifica richiesta.
