export const metadata = {
  title: "Termini di servizio - Fatture da G-Cal a Psicogest",
};

const stile = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "40px 20px 60px",
  fontFamily: "ui-sans-serif, system-ui",
  color: "#1F2A25",
  lineHeight: 1.6,
};

export default function TerminiPage() {
  return (
    <main style={stile}>
      <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 500 }}>Termini di servizio</h1>
      <p style={{ color: "#55645D" }}>Ultimo aggiornamento: 29 settembre 2026</p>

      <h2>Uso dell&apos;applicazione</h2>
      <p>
        &laquo;Fatture da G-Cal a Psicogest&raquo; è uno strumento gestionale interno dello studio del dott. Maurizio
        Brasini, riservato al titolare dello studio. L&apos;accesso avviene con l&apos;account Google dello studio e
        non è previsto per altri utenti.
      </p>

      <h2>Cosa fa e cosa non fa</h2>
      <p>
        L&apos;app legge il calendario Google dello studio, conta le sedute, prepara i file Excel da importare in
        Psicogest e può scrivere codici di numerazione nelle note degli appuntamenti. Non emette fatture: le fatture
        vengono emesse e trasmesse da Psicogest, dopo la verifica del titolare.
      </p>

      <h2>Responsabilità</h2>
      <p>
        L&apos;applicazione è fornita &laquo;così com&apos;è&raquo;, senza garanzie. Il titolare è tenuto a
        controllare i dati e i file generati prima di usarli a fini fiscali.
      </p>

      <h2>Privacy</h2>
      <p>
        Il trattamento dei dati è descritto nell&apos;<a href="/privacy">informativa sulla privacy</a>.
      </p>

      <h2>Contatti</h2>
      <p>
        <a href="mailto:maurizio.brasini@psiconet.it">maurizio.brasini@psiconet.it</a>
      </p>

      <p style={{ marginTop: 32 }}>
        <a href="/privacy">Informativa sulla privacy</a> &middot; <a href="/login">Torna all&apos;accesso</a>
      </p>
    </main>
  );
}
