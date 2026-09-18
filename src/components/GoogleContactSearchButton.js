"use client";
import { useState } from "react";

// Bottone "🔍" che, cliccato, apre un piccolo campo di ricerca inline sui
// Contatti Google (via /api/contacts/search) e restituisce il contatto
// scelto tramite onSelect — non scrive nulla da solo, è il chiamante a
// decidere cosa fare col contatto (precompilare campi, aggiungere un
// destinatario, ecc.).
export default function GoogleContactSearchButton({ onSelect, title = "Cerca nei Contatti Google" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [risultati, setRisultati] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errore, setErrore] = useState(null);

  async function cerca(query) {
    setQ(query);
    if (!query.trim()) {
      setRisultati([]);
      return;
    }
    setLoading(true);
    setErrore(null);
    try {
      const res = await fetch("/api/contacts/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ricerca fallita");
      setRisultati(data.risultati || []);
    } catch (e) {
      setErrore(e.message);
    } finally {
      setLoading(false);
    }
  }

  function scegli(contatto) {
    onSelect(contatto);
    setOpen(false);
    setQ("");
    setRisultati([]);
  }

  if (!open) {
    return (
      <button type="button" className="btn-small" title={title} onClick={() => setOpen(true)}>
        🔍
      </button>
    );
  }

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <input
        autoFocus
        style={{ width: 160 }}
        placeholder="Cerca contatto…"
        value={q}
        onChange={(e) => cerca(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {(loading || errore || risultati.length > 0 || q.trim()) && (
        <div
          style={{
            position: "absolute",
            zIndex: 10,
            top: "100%",
            left: 0,
            background: "white",
            border: "1px solid #ccc",
            borderRadius: 6,
            minWidth: 220,
            maxHeight: 220,
            overflowY: "auto",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          {loading && (
            <div className="muted small" style={{ padding: 8 }}>
              Cerco…
            </div>
          )}
          {errore && (
            <div className="small" style={{ padding: 8, color: "crimson" }}>
              {errore}
            </div>
          )}
          {!loading &&
            !errore &&
            risultati.map((c) => (
              <div
                key={c.resourceName}
                className="small"
                style={{ padding: 8, cursor: "pointer", borderTop: "1px solid #eee" }}
                onMouseDown={() => scegli(c)}
              >
                <strong>{c.nome}</strong>
                {c.telefoni?.[0] && <div className="muted">{c.telefoni[0]}</div>}
                {c.email?.[0] && <div className="muted">{c.email[0]}</div>}
              </div>
            ))}
          {!loading && !errore && risultati.length === 0 && q.trim() && (
            <div className="muted small" style={{ padding: 8 }}>
              Nessun contatto trovato
            </div>
          )}
        </div>
      )}
    </span>
  );
}
