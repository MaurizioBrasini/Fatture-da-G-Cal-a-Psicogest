export const metadata = {
  title: "Informativa sulla privacy - Fatture da G-Cal a Psicogest",
};

const stile = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "40px 20px 60px",
  fontFamily: "ui-sans-serif, system-ui",
  color: "#1F2A25",
  lineHeight: 1.6,
};

export default function PrivacyPage() {
  return (
    <main style={stile}>
      <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 500 }}>Informativa sulla privacy</h1>
      <p style={{ color: "#55645D" }}>Ultimo aggiornamento: 29 settembre 2026</p>

      <h2>Cos&apos;è questa applicazione</h2>
      <p>
        &laquo;Fatture da G-Cal a Psicogest&raquo; è uno strumento gestionale ad uso interno dello studio del dott.
        Maurizio Brasini (psicologo). Serve a contare le sedute segnate nel calendario Google dello studio e a
        preparare i file di fatturazione da importare nel gestionale Psicogest. Non è un servizio aperto al pubblico:
        l&apos;unico utente che accede è il titolare dello studio, con il proprio account Google.
      </p>

      <h2>Quali dati Google utilizza</h2>
      <ul>
        <li>
          <strong>Google Calendar</strong> (permesso <code>calendar.events</code>): legge gli appuntamenti del
          calendario dello studio per contare le sedute e, su richiesta, scrive nella descrizione degli eventi il
          codice di numerazione della seduta (per esempio &laquo;R3&raquo;). Può anche creare, spostare o eliminare
          eventi quando l&apos;utente lo chiede espressamente dall&apos;app.
        </li>
        <li>
          <strong>Contatti Google</strong> (permessi di sola lettura <code>contacts.readonly</code> e{" "}
          <code>contacts.other.readonly</code>): cerca e verifica il nome, il telefono e l&apos;email dei pazienti già
          presenti in rubrica, per non doverli inserire due volte.
        </li>
        <li>
          <strong>Account Google</strong>: l&apos;indirizzo email dell&apos;account serve solo per riconoscere
          l&apos;utente al momento dell&apos;accesso.
        </li>
      </ul>

      <h2>Come vengono usati e conservati</h2>
      <p>
        I dati sono usati esclusivamente per le funzioni descritte sopra. Il token di accesso a Google è conservato
        in un database Supabase protetto da autenticazione; i dati anagrafici dei pazienti, il conteggio delle sedute
        e lo storico delle fatture emesse sono conservati nello stesso database. I dati non vengono venduti,
        ceduti a terzi, usati per pubblicità né per addestrare modelli di intelligenza artificiale.
      </p>
      <p>
        L&apos;uso e il trasferimento delle informazioni ricevute dalle API di Google rispettano la{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , compresi i requisiti di &laquo;Limited Use&raquo;.
      </p>

      <h2>Servizi di terze parti</h2>
      <ul>
        <li>Supabase, per il database e l&apos;autenticazione.</li>
        <li>Vercel, per l&apos;hosting dell&apos;applicazione.</li>
        <li>
          Resend, per l&apos;invio delle email ai pazienti (per esempio il link di riprenotazione), solo quando
          l&apos;utente lo richiede.
        </li>
      </ul>

      <h2>Dati dei pazienti</h2>
      <p>
        L&apos;app tratta dati dei pazienti dello studio (nome, contatti, codice fiscale, numero di sedute e importi
        fatturati) soltanto per la gestione amministrativa e fiscale dell&apos;attività professionale. Il contenuto
        clinico delle sedute non viene inserito né conservato nell&apos;app. Per il trattamento dei dati dei pazienti
        vale l&apos;informativa privacy consegnata dallo studio a ciascun paziente.
      </p>

      <h2>Revoca dell&apos;accesso e cancellazione dei dati</h2>
      <p>
        L&apos;accesso dell&apos;app all&apos;account Google può essere revocato in qualsiasi momento da{" "}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
          myaccount.google.com/permissions
        </a>
        . Per chiedere la cancellazione dei dati conservati dall&apos;app scrivi all&apos;indirizzo qui sotto.
      </p>

      <h2>Contatti</h2>
      <p>
        Titolare del trattamento: dott. Maurizio Brasini, Via Taranto 59, 00182 Roma. Email:{" "}
        <a href="mailto:maurizio.brasini@psiconet.it">maurizio.brasini@psiconet.it</a>.
      </p>

      <p style={{ marginTop: 32 }}>
        <a href="/termini">Termini di servizio</a> &middot; <a href="/login">Torna all&apos;accesso</a>
      </p>
    </main>
  );
}
