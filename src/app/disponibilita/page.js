"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import { computeGrigliaDisponibilita, todayISO, formatDataItaliana } from "@/lib/logic";

const GIORNI_COL = { 1: "Lun", 2: "Mar", 3: "Mer", 4: "Gio", 5: "Ven" };
const GIORNI_LABEL = { 1: "Lunedì", 2: "Martedì", 3: "Mercoledì", 4: "Giovedì", 5: "Venerdì" };

export default function DisponibilitaPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [{ data: patients, error: errP }, { data: slots, error: errS }] = await Promise.all([
      supabase.from("patients").select("id,nome_calendario,fatturare_a,stato"),
      supabase.from("patient_slots").select("weekday,time_of_day,interval_days,anchor_date,patient_id").eq("active", true),
    ]);
    if (errP || errS) {
      setError((errP || errS).message);
      setLoading(false);
      return;
    }
    const pazientiById = Object.fromEntries((patients || []).map((p) => [p.id, p]));
    const righe = (slots || [])
      .map((s) => {
        const p = pazientiById[s.patient_id];
        return { ...s, nome: p?.nome_calendario || p?.fatturare_a || "?", stato: p?.stato || "?" };
      })
      .sort((a, b) => a.weekday - b.weekday || a.time_of_day.localeCompare(b.time_of_day));
    setReport(computeGrigliaDisponibilita(righe));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div style={{ padding: 40 }}>Caricamento…</div>;

  if (error) {
    return (
      <div className="app-root">
        <Sidebar readyCount={0} />
        <main className="main">
          <div className="error-box">{error}</div>
        </main>
      </div>
    );
  }

  const r = report;
  const nPieno = r.griglia.reduce((a, row) => a + Object.values(row.giorni).filter((c) => c.stato === "pieno").length, 0);
  const nParziale = r.griglia.reduce((a, row) => a + Object.values(row.giorni).filter((c) => c.stato === "parziale").length, 0);
  const nLibero = r.griglia.reduce((a, row) => a + Object.values(row.giorni).filter((c) => c.stato === "libero").length, 0);
  const sospesi = new Set();
  [...r.quindicinaliPieni, ...r.quindicinaliSingoli, ...r.mensili].forEach((g) => g.pazienti.forEach((p) => p.stato === "sospeso" && sospesi.add(p.nome)));

  const disponibili = [];
  r.griglia.forEach((row) => {
    [1, 2, 3, 4, 5].forEach((g) => {
      const c = row.giorni[g];
      if (c.stato === "libero") {
        disponibili.push({ giorno: GIORNI_LABEL[g], orario: row.orario, badge: "libero", detail: "Nessuno slot fisso assegnato su questa fascia." });
      } else if (c.stato === "parziale") {
        const nomi = c.pazienti.map((p) => p.nome).join(", ");
        const etichetta = c.cadenza === "mensile" ? `${c.fasiLibere} settimane su 4 libere` : "1 settimana su 2 libera";
        disponibili.push({ giorno: GIORNI_LABEL[g], orario: row.orario, badge: `${c.fasiLibere} libere`, detail: `Occupata da ${nomi} (${c.cadenza}) — ${etichetta}` });
      }
    });
  });

  return (
    <div className="app-root">
      <Sidebar readyCount={0} />
      <main className="main">
        <header className="view-header">
          <div>
            <h1>Disponibilità</h1>
            <p className="sub">
              Slot settimanali, quindicinali e mensili ricavati dal vivo da patient_slots, con i posti ancora liberi per
              nuovi pazienti — sostituisce la lettura manuale del calendario mensile.
            </p>
          </div>
          <div className="header-actions">
            <span className="muted small">aggiornato al {formatDataItaliana(todayISO())}</span>
          </div>
        </header>

        <div className="disp-stats">
          <div className="disp-stat">
            <div className="n">{r.totaleSlotAttivi}</div>
            <div className="l">Slot fissi attivi</div>
          </div>
          <div className="disp-stat">
            <div className="n">{nPieno}</div>
            <div className="l">Fasce piene, nessun posto</div>
          </div>
          <div className="disp-stat accent">
            <div className="n">{nParziale}</div>
            <div className="l">Fasce con almeno una fase libera</div>
          </div>
          <div className="disp-stat accent">
            <div className="n">{nLibero}</div>
            <div className="l">Fasce senza nessun paziente</div>
          </div>
          <div className="disp-stat">
            <div className="n">{sospesi.size}</div>
            <div className="l">Sospesi che occupano comunque una fascia</div>
          </div>
        </div>

        <h2 className="sub-heading">Griglia settimanale, lunedì–venerdì</h2>
        <div className="disp-legend">
          <span><span className="disp-swatch" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} />Pieno</span>
          <span><span className="disp-swatch" style={{ background: "var(--warn)" }} />Parziale — un posto libero</span>
          <span><span className="disp-swatch" style={{ background: "var(--accent)" }} />Libero — nessun paziente</span>
          <span><span className="disp-swatch" style={{ background: "var(--danger)" }} />Nome in rosso = sospeso</span>
        </div>
        <div className="table-scroll" style={{ marginBottom: 28 }}>
          <div className="disp-grid">
            <div />
            {[1, 2, 3, 4, 5].map((g) => (
              <div key={g} className="disp-dayhead">{GIORNI_COL[g]}</div>
            ))}
            {r.griglia.map((row) => (
              <div key={row.orario} style={{ display: "contents" }}>
                <div className="disp-timehead">{row.orario}</div>
                {[1, 2, 3, 4, 5].map((g) => {
                  const c = row.giorni[g];
                  return (
                    <div key={g} className={`disp-cell ${c.stato}`}>
                      {c.stato === "libero" ? (
                        <span className="disp-tag">Libero</span>
                      ) : (
                        <>
                          <span className="disp-tag">{c.stato === "pieno" ? "Pieno" : "Parziale"} · {c.cadenza}</span>
                          <span>
                            {c.pazienti.map((p, i) => (
                              <span key={p.nome}>
                                {i > 0 && " / "}
                                <span className={p.stato === "sospeso" ? "disp-susp" : ""}>{p.nome}</span>
                              </span>
                            ))}
                          </span>
                          {c.fasiLibere > 0 && <span className="disp-frac">{c.fasiTotali - c.fasiLibere}/{c.fasiTotali} occupate</span>}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <h2 className="sub-heading">Posti disponibili per nuovi pazienti ({disponibili.length})</h2>
        {disponibili.length === 0 ? (
          <div className="empty-row">Nessuna fascia con margine al momento.</div>
        ) : (
          <div style={{ marginBottom: 28 }}>
            {disponibili.map((a, i) => (
              <div key={i} className="disp-avail-row">
                <div className="when">{a.orario}<span className="day">{a.giorno}</span></div>
                <div className="muted small">{a.detail}</div>
                <div className="frac-badge">{a.badge}</div>
              </div>
            ))}
          </div>
        )}
        <p className="sub" style={{ marginBottom: 28 }}>
          Il venerdì (e il weekend) risultano liberi su tutte le fasce solo perché nessuno slot fisso vi è mai stato
          assegnato — verifica se è comunque un giorno di studio prima di proporlo. I pazienti sospesi occupano ancora
          formalmente la loro fascia: la decisione di liberarla resta manuale.
        </p>

        <h2 className="sub-heading">Slot settimanali — pieni per definizione ({r.settimanali.length})</h2>
        <table className="tbl" style={{ marginBottom: 24 }}>
          <thead><tr><th>Giorno</th><th>Orario</th><th>Paziente</th></tr></thead>
          <tbody>
            {r.settimanali.map((s, i) => (
              <tr key={i}><td>{s.giorno}</td><td className="mono">{s.orario}</td><td>{s.pazienti.map((p) => p.nome).join(", ")}</td></tr>
            ))}
          </tbody>
        </table>

        <h2 className="sub-heading">Slot quindicinali pieni — 2 pazienti alternati ({r.quindicinaliPieni.length})</h2>
        <table className="tbl" style={{ marginBottom: 24 }}>
          <thead><tr><th>Giorno</th><th>Orario</th><th>Pazienti alternati</th></tr></thead>
          <tbody>
            {r.quindicinaliPieni.map((s, i) => (
              <tr key={i}><td>{s.giorno}</td><td className="mono">{s.orario}</td><td>{s.pazienti.map((p) => p.nome).join(" / ")}</td></tr>
            ))}
          </tbody>
        </table>

        <h2 className="sub-heading">Slot mensili ({r.mensili.length})</h2>
        <table className="tbl" style={{ marginBottom: 24 }}>
          <thead><tr><th>Giorno</th><th>Orario</th><th>Pazienti (fase occupata)</th><th>Fasi libere</th></tr></thead>
          <tbody>
            {r.mensili.map((s, i) => (
              <tr key={i}>
                <td>{s.giorno}</td>
                <td className="mono">{s.orario}</td>
                <td>{s.pazienti.map((p) => `${p.nome} (${p.anchor_date})`).join(", ")}</td>
                <td className="mono">{s.fasiLibere}/4</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}
