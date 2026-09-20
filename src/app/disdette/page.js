"use client";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import {
  formatDataItaliana,
  tempoInZonaRossa,
  bilancioAlla,
  addDays,
  daysBetween,
  SOGLIA_DISDETTE_DEFAULT,
  GIORNI_PERIODO_DISDETTE,
} from "@/lib/logic";

// Periodi del bilancio (giorni); null = dall'inizio della rilevazione.
const PERIODI = [
  { giorni: 91, label: "ultimi 3 mesi" },
  { giorni: 182, label: "ultimi 6 mesi" },
  { giorni: 365, label: "ultimi 12 mesi" },
  { giorni: null, label: "dall'inizio della rilevazione" },
];

const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);

const NOMI_MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const etichettaMese = (m) => `${NOMI_MESI[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export default function DisdettePage() {
  const [dati, setDati] = useState(null);
  const [errore, setErrore] = useState("");
  const [loading, setLoading] = useState(true);
  // Soglia modificabile solo per esplorare: il calcolo dei flag è locale,
  // non serve rileggere il calendario per cambiarla.
  const [sogliaPct, setSogliaPct] = useState(Math.round(SOGLIA_DISDETTE_DEFAULT * 100));
  const [periodo, setPeriodo] = useState(GIORNI_PERIODO_DISDETTE);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/disdette/statistiche", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Errore nel calcolo delle statistiche.");
        setDati(data);
      } catch (e) {
        setErrore(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const soglia = (Number(sogliaPct) || 0) / 100;
  const periodoLabel = PERIODI.find((p) => p.giorni === periodo)?.label || "";
  // Bilancio, segnalazione e zona rossa ricalcolati qui con soglia e periodo
  // scelti nella pagina (i dati grezzi per paziente arrivano già cumulativi).
  const righe = (dati?.righe || []).map((r) => {
    const b = bilancioAlla(r.andamento, dati.oggi, periodo);
    const percentuale = b.appuntamenti ? b.disdette / b.appuntamenti : 0;
    const datiInsufficienti = b.appuntamenti < dati.minAppuntamenti;
    return {
      ...r,
      appuntamenti: b.appuntamenti,
      disdette: b.disdette,
      percentuale,
      datiInsufficienti,
      segnalato: !datiInsufficienti && percentuale > soglia,
      zonaRossa: tempoInZonaRossa(r.andamento, soglia, dati.minAppuntamenti, dati.oggi, periodo),
    };
  });
  const segnalati = righe.filter((r) => r.segnalato);
  righe.sort((a, b) => Number(b.segnalato) - Number(a.segnalato) || b.percentuale - a.percentuale);
  // Se la finestra scelta parte prima dell'inizio della rilevazione, il
  // bilancio copre meno tempo di quello richiesto: va detto, non taciuto.
  const inizioFinestra = dati?.inizio ? (periodo == null ? dati.inizio : addDays(dati.oggi, -periodo)) : null;
  const giorniCoperti = dati?.inizio && dati.inizio > inizioFinestra ? daysBetween(dati.inizio, dati.oggi) : null;

  return (
    <div className="app-root">
      <Sidebar readyCount={0} />
      <main className="main">
        <header className="view-header">
          <div>
            <h1>Disdette</h1>
            <p className="sub">
              Bilancio delle disdette di chi occupa uno slot fisso: sul periodo scelto, quante volte su quelle fissate
              ha dato buca.
            </p>
          </div>
          <div className="header-actions">
            <label className="small muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Periodo
              <select value={periodo === null ? "tutto" : periodo} onChange={(e) => setPeriodo(e.target.value === "tutto" ? null : Number(e.target.value))}>
                {PERIODI.map((p) => (
                  <option key={p.label} value={p.giorni === null ? "tutto" : p.giorni}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="small muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Segnala oltre
              <input
                type="number"
                className="num"
                min={1}
                max={99}
                value={sogliaPct}
                onChange={(e) => setSogliaPct(e.target.value)}
                style={{ width: 56 }}
              />
              %
            </label>
          </div>
        </header>

        {loading && <div className="empty-row">Lettura del calendario in corso…</div>}
        {errore && <div className="error-box">{errore}</div>}

        {dati && !dati.inizio && (
          <div className="empty-row">Nessuna disdetta registrata finora: le statistiche compariranno da sole.</div>
        )}

        {dati?.inizio && (
          <>
            <p className="sub" style={{ marginBottom: 16 }}>
              Dati dal <strong>{formatDataItaliana(dati.inizio)}</strong>, giorno da cui le disdette vengono registrate:
              prima non esiste alcuna traccia, quindi non è possibile ricostruire lo storico precedente. Una percentuale
              è affidabile solo con almeno {dati.minAppuntamenti} appuntamenti fissati; sotto quella quota il paziente
              non viene mai segnalato (una sola disdetta su 3 incontri sarebbe rumore, non un&apos;abitudine).
            </p>
            {giorniCoperti !== null && (
              <div className="error-box">
                Il periodo scelto ({periodoLabel}) è più lungo dei dati disponibili: il bilancio copre solo{" "}
                <strong>{giorniCoperti} giorni</strong> (dal {formatDataItaliana(dati.inizio)}). Diventerà completo man
                mano che la rilevazione prosegue.
              </div>
            )}
            <p className="sub" style={{ marginBottom: 16 }}>
              <strong>Tempo in zona rossa:</strong> somma di tutti i periodi in cui il bilancio ({periodoLabel}) del
              paziente è stato sopra soglia, anche se è uscito e rientrato. Per ciascun paziente il conteggio parte dal
              primo momento in cui raggiunge il minimo di {dati.minAppuntamenti} appuntamenti nel periodo (prima non può
              essere in zona rossa) e comunque non prima del {formatDataItaliana(dati.inizio)}.
            </p>

            {segnalati.length > 0 ? (
              <div className="error-box">
                <strong>
                  {segnalati.length} {segnalati.length === 1 ? "paziente supera" : "pazienti superano"} il {sogliaPct}% di
                  disdette ({periodoLabel}):
                </strong>{" "}
                {segnalati.map((r) => `${r.nome} (${pct(r.percentuale)}, ${r.disdette} su ${r.appuntamenti})`).join(", ")}.
                Per liberare lo slot: Pazienti → colonna Frequenza → &quot;Su richiesta&quot;.
              </div>
            ) : (
              <div className="empty-row" style={{ marginBottom: 16 }}>
                Nessun paziente con slot fisso supera il {sogliaPct}% (tra chi ha almeno {dati.minAppuntamenti}{" "}
                appuntamenti fissati).
              </div>
            )}

            <h2 className="sub-heading">Pazienti con slot fisso ({righe.length})</h2>
            <table className="tbl" style={{ marginBottom: 28 }}>
              <thead>
                <tr>
                  <th>Paziente</th>
                  <th>Appuntamenti</th>
                  <th>Disdette</th>
                  <th>Bilancio ({periodoLabel})</th>
                  <th>Tempo in zona rossa</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {righe.map((r) => (
                  <tr key={r.patientId}>
                    <td className="name" style={r.segnalato ? { color: "var(--danger)" } : undefined}>{r.nome}</td>
                    <td className="mono">{r.appuntamenti}</td>
                    <td className="mono">{r.disdette}</td>
                    <td className="mono">
                      {pct(r.percentuale)} <span className="muted">({r.disdette} su {r.appuntamenti})</span>
                    </td>
                    <td className="mono">
                      {r.zonaRossa ? (
                        <>
                          {r.zonaRossa.giorniTotali} gg totali
                          {r.zonaRossa.periodi.length > 1 ? ` in ${r.zonaRossa.periodi.length} periodi` : ""}
                          <div className="muted small">
                            dal {formatDataItaliana(r.zonaRossa.primoIngresso)} ·{" "}
                            {r.zonaRossa.inCorso ? "ora in zona rossa" : "ora fuori"}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {r.segnalato && <span className="tag tag-danger">oltre soglia</span>}
                      {!r.segnalato && r.datiInsufficienti && <span className="muted small">dati insufficienti</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h2 className="sub-heading">Andamento mensile (tutti i pazienti con slot fisso)</h2>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Mese</th>
                  <th>Appuntamenti</th>
                  <th>Disdette</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {dati.mensile.map((m) => (
                  <tr key={m.mese}>
                    <td className="name">{etichettaMese(m.mese)}</td>
                    <td className="mono">{m.appuntamenti}</td>
                    <td className="mono">{m.disdette}</td>
                    <td className="mono">{pct(m.disdette / m.appuntamenti)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="sub" style={{ marginTop: 16 }}>
              Sono contate tutte le disdette registrate (addebitate e non), qualunque il motivo: la lettura del contesto
              resta tua. Gli appuntamenti futuri non entrano nel calcolo.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
