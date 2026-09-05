// Overlay + riquadro bianco condivisi da tutti i popup dell'app (numero
// fattura, rinumerazione calendario, storico paziente) — prima erano
// tre copie quasi identiche di questo stesso markup.
export default function Modal({ maxWidth = 480, children }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <div style={{ background: "white", borderRadius: 12, padding: 24, maxWidth, width: "90%", maxHeight: "80vh", overflowY: "auto" }}>
        {children}
      </div>
    </div>
  );
}
