"use client";
// Pagina PUBBLICA (nessun login, vedi middleware.js) aperta dal link
// mandato al paziente prima del primo incontro. Legge/scrive solo tramite
// /api/consensi/pubblico/[token] (service role, mai la sessione di
// Maurizio).
import { useEffect, useState } from "react";
import { testoInformativaIndividuale, DICHIARAZIONI_INDIVIDUALE, TESTO_VIDEOREGISTRAZIONE } from "@/lib/logic";

const CAMPI_VUOTI = {
  nome: "",
  cognome: "",
  data_nascita: "",
  luogo_nascita: "",
  indirizzo: "",
  cap: "",
  localita: "",
  provincia: "",
  codice_fiscale: "",
  telefono: "",
  email: "",
};

export default function ConsensoPage({ params }) {
  const { token } = params;
  const [stato, setStato] = useState("caricamento"); // caricamento | form | inviato | errore | gia_fatto
  const [consenso, setConsenso] = useState(null);
  const [campi, setCampi] = useState(CAMPI_VUOTI);
  const [consensi, setConsensi] = useState({ consenso_prestazione: null, consenso_dati_personali: null, consenso_sistema_ts: null, consenso_videoregistrazione: false });
  const [errore, setErrore] = useState("");
  const [invio, setInvio] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/consensi/pubblico/${token}`);
        const data = await res.json();
        if (!res.ok) {
          setErrore(data.error || "Link non valido.");
          setStato("errore");
          return;
        }
        if (data.consenso.stato !== "inviato") {
          setStato("gia_fatto");
          return;
        }
        setConsenso(data.consenso);
        setCampi((c) => ({ ...c, email: data.consenso.email_invitato || "" }));
        setStato("form");
      } catch (e) {
        setErrore(e.message);
        setStato("errore");
      }
    })();
  }, [token]);

  function setCampo(chiave, valore) {
    setCampi((c) => ({ ...c, [chiave]: valore }));
  }

  async function invia() {
    setErrore("");
    if (consensi.consenso_prestazione === null || consensi.consenso_dati_personali === null || consensi.consenso_sistema_ts === null) {
      setErrore("Risponda a tutte e tre le domande di consenso (sì o no) prima di procedere.");
      return;
    }
    setInvio(true);
    try {
      const res = await fetch(`/api/consensi/pubblico/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...campi, ...consensi }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrore(data.error || "Invio non riuscito.");
        setInvio(false);
        return;
      }
      setStato("inviato");
    } catch (e) {
      setErrore(e.message);
      setInvio(false);
    }
  }

  const stile = { fontFamily: "ui-sans-serif, system-ui", maxWidth: 700, margin: "0 auto", padding: "32px 20px 80px", color: "#1E2B27" };
  const box = { background: "#fff", border: "1px solid #DDE3DD", borderRadius: 10, padding: 20, marginBottom: 16 };
  const label = { display: "block", fontSize: 13, color: "#55645D", marginBottom: 4, marginTop: 12 };
  const input = { width: "100%", padding: "8px 10px", border: "1px solid #DDE3DD", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };

  if (stato === "caricamento") return <div style={stile}>Caricamento…</div>;
  if (stato === "errore") return <div style={stile}><p style={{ color: "#A23B3B" }}>{errore}</p></div>;
  if (stato === "gia_fatto") {
    return (
      <div style={stile}>
        <h1 style={{ fontFamily: "Georgia, serif" }}>Modulo già ricevuto</h1>
        <p>Questo modulo risulta già compilato. Se pensa si tratti di un errore, contatti direttamente il dott. Brasini.</p>
      </div>
    );
  }
  if (stato === "inviato") {
    return (
      <div style={stile}>
        <h1 style={{ fontFamily: "Georgia, serif" }}>Grazie</h1>
        <p>Il modulo è stato ricevuto correttamente. Il dott. Brasini lo riceverà a breve.</p>
      </div>
    );
  }

  return (
    <div style={stile}>
      <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 500 }}>Modulo di consenso informato</h1>
      <p style={{ color: "#55645D" }}>Gentile {consenso.nome_invitato}, La preghiamo di compilare questo modulo prima del primo incontro.</p>

      <div style={box}>
        <h2 style={{ fontFamily: "Georgia, serif", fontWeight: 500, marginTop: 0 }}>Informativa</h2>
        {testoInformativaIndividuale({ tipologia: consenso.tipologia, regime: consenso.regime_tariffario, tariffa: consenso.tariffa }).map((p, i) => (
          <p key={i} style={{ fontSize: 13.5, lineHeight: 1.5 }}>{p}</p>
        ))}
      </div>

      <div style={box}>
        <h2 style={{ fontFamily: "Georgia, serif", fontWeight: 500, marginTop: 0 }}>I Suoi dati</h2>
        <label style={label}>Nome</label>
        <input style={input} value={campi.nome} onChange={(e) => setCampo("nome", e.target.value)} />
        <label style={label}>Cognome</label>
        <input style={input} value={campi.cognome} onChange={(e) => setCampo("cognome", e.target.value)} />
        <label style={label}>Luogo di nascita</label>
        <input style={input} value={campi.luogo_nascita} onChange={(e) => setCampo("luogo_nascita", e.target.value)} />
        <label style={label}>Data di nascita</label>
        <input type="date" style={input} value={campi.data_nascita} onChange={(e) => setCampo("data_nascita", e.target.value)} />
        <label style={label}>Indirizzo di residenza (via e numero civico)</label>
        <input style={input} value={campi.indirizzo} onChange={(e) => setCampo("indirizzo", e.target.value)} />
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>CAP</label>
            <input style={input} value={campi.cap} onChange={(e) => setCampo("cap", e.target.value)} />
          </div>
          <div style={{ flex: 2 }}>
            <label style={label}>Località</label>
            <input style={input} value={campi.localita} onChange={(e) => setCampo("localita", e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Provincia</label>
            <input style={input} maxLength={2} value={campi.provincia} onChange={(e) => setCampo("provincia", e.target.value.toUpperCase())} />
          </div>
        </div>
        <label style={label}>Codice fiscale</label>
        <input style={input} value={campi.codice_fiscale} onChange={(e) => setCampo("codice_fiscale", e.target.value.toUpperCase())} />
        <label style={label}>Telefono</label>
        <input style={input} value={campi.telefono} onChange={(e) => setCampo("telefono", e.target.value)} />
        <label style={label}>Email</label>
        <input type="email" style={input} value={campi.email} onChange={(e) => setCampo("email", e.target.value)} />
      </div>

      <div style={box}>
        <h2 style={{ fontFamily: "Georgia, serif", fontWeight: 500, marginTop: 0 }}>Consensi</h2>
        {DICHIARAZIONI_INDIVIDUALE.map((d) => (
          <div key={d.chiave} style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>{d.testo}</p>
            <label style={{ marginRight: 16, fontSize: 14 }}>
              <input
                type="radio"
                name={d.chiave}
                checked={consensi[d.chiave] === true}
                onChange={() => setConsensi((c) => ({ ...c, [d.chiave]: true }))}
              />{" "}
              Sì, fornisco il consenso
            </label>
            <label style={{ fontSize: 14 }}>
              <input
                type="radio"
                name={d.chiave}
                checked={consensi[d.chiave] === false}
                onChange={() => setConsensi((c) => ({ ...c, [d.chiave]: false }))}
              />{" "}
              No, non fornisco il consenso
            </label>
          </div>
        ))}
      </div>

      {consenso.tipo === "coppia" && (
        <div style={box}>
          <h2 style={{ fontFamily: "Georgia, serif", fontWeight: 500, marginTop: 0 }}>Videoregistrazione delle sedute</h2>
          {TESTO_VIDEOREGISTRAZIONE.map((p, i) => (
            <p key={i} style={{ fontSize: 13.5, lineHeight: 1.5 }}>{p}</p>
          ))}
          <label style={{ fontSize: 14 }}>
            <input
              type="checkbox"
              checked={consensi.consenso_videoregistrazione}
              onChange={(e) => setConsensi((c) => ({ ...c, consenso_videoregistrazione: e.target.checked }))}
            />{" "}
            Comprendo e acconsento a quanto sopra.
          </label>
        </div>
      )}

      {errore && <p style={{ color: "#A23B3B" }}>{errore}</p>}
      <button
        onClick={invia}
        disabled={invio}
        style={{ background: "#3F6659", color: "#fff", border: "none", borderRadius: 7, padding: "10px 20px", fontSize: 14, cursor: "pointer" }}
      >
        {invio ? "Invio…" : "Invia il modulo"}
      </button>
    </div>
  );
}
