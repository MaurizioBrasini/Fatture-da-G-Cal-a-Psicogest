"use client";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { formatDataItaliana, inZonaRossaDa, daysBetween, SOGLIA_DISDETTE_DEFAULT, GIORNI_TENDENZA_DISDETTE } from "@/lib/logic";

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
  const righe = (dati?.righe || []).map((r) => ({
    ...r,
    segnalato: !r.datiInsufficienti && r.percentuale > soglia,
    // ricalcolata con la soglia impostata qui, non con quella di default
    zonaRossa: inZonaRossaDa(r.andamento, soglia, dati.minAppuntamenti),
  }));
  const segnalati = righe.filter((r) => r.segnalato);
  righe.sort((a, b) => Number(b.segnalato) - Number(a.segnalato) || b.percentuale - a.percentuale);

  return (
    <div className="app-root">
      <Sidebar readyCount={0} />
      <main className="main">
        <header className="view-header">
          <div>
            <h1>Disdette</h1>
            <p className="sub">
              Chi occupa uno slot fisso e disdice spesso: percentuale di appuntamenti disdetti sul totale di quelli
              fissati, con andamento recente e mensile.
            </p>
          </div>
          <div className="header-actions">
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

            {segnalati.length > 0 ? (
              <div className="error-box">
                <strong>
                  {segnalati.length} {segnalati.length === 1 ? "paziente supera" : "pazienti superano"} il {sogliaPct}% di
                  disdette:
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
                  <th>% totale</th>
                  <th>Ultimi {GIORNI_TENDENZA_DISDETTE} gg</th>
                  <th>In zona rossa da</th>
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
                      {r.appuntamentiRecenti
                        ? `${pct(r.percentualeRecente)} (${r.disdetteRecenti} su ${r.appuntamentiRecenti})`
                        : "—"}
                    </td>
                    <td className="mono">
                      {r.zonaRossa
                        ? `${formatDataItaliana(r.zonaRossa.da)} — ${daysBetween(r.zonaRossa.da, dati.oggi)} gg, ${r.zonaRossa.appuntamenti} ${r.zonaRossa.appuntamenti === 1 ? "appuntamento" : "appuntamenti"}`
                        : "—"}
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
