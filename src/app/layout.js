import "./globals.css";

export const metadata = {
  title: "Gestione pazienti/fatture",
  description: "Conteggio sedute e generazione file Psicogest",
};

export default function RootLayout({ children }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
