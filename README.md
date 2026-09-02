# Fatture da G-Cal a Psicogest

## Cos'è

Legge gli appuntamenti da Google Calendar, li abbina all'anagrafica pazienti,
conta le sedute verso la soglia di fatturazione impostata per ciascuno, e
genera un file Excel pronto per l'importazione massiva su Psicogest
(Strumenti → Importa fatture).

## Prima di avviare in locale (o pubblicare)

1. Crea il file `.env.local` copiando `.env.local.example` e compilalo con:
   - `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` — da
     Supabase: Project Settings → API.
   - `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` — da Google Cloud Console:
     Credenziali → il tuo Client OAuth.
2. Esegui su Supabase (SQL Editor) `schema.sql` e poi `schema_addendum.sql`.
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
   quattro variabili di `.env.local`.
3. Dopo il primo deploy, prendi l'indirizzo che ti dà Vercel (es.
   `https://tuo-progetto.vercel.app`) e aggiungi
   `https://tuo-progetto.vercel.app/auth/callback` tra gli URI di
   reindirizzamento autorizzati su Google Cloud Console.
4. Finché la schermata di consenso OAuth di Google resta in modalità
   "Testing", solo gli indirizzi email aggiunti come "Test users" (Google
   Auth Platform → Audience) potranno accedere — sufficiente per un uso
   personale/di studio, nessuna verifica richiesta.
