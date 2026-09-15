"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import { computeGrigliaDisponibilita, todayISO, formatDataItaliana } from "@/lib/logic";

// Il venerdì non è più un giorno dedicato ai pazienti (vedi richiesta
// 2026-09-15): la griglia e i conteggi di disponibilità coprono solo
// lunedì-giovedì. Se compaiono comunque slot attivi di venerdì (dato
// anomalo rispetto a questa scelta), li segnaliamo invece di nasconderli.
const GIORNI = [1, 2, 3, 4];
const GIORNI_COL = { 1: "Lun", 2: "Mar", 3: "Mer", 4: "Gio" };
const GIORNI_LABEL = { 1: "Lunedì", 2: "Martedì", 3: "Mercoledì", 4: "Giovedì" };

// Fascia mattutina che Maurizio a volte usa per supervisioni anziché
// pazienti: i posti liberi qui dentro non vanno contati tra i posti per
// nuovi pazienti, ma tracciati a parte come "disponibile per supervisioni".
const SUPERVISIONI_DA = "09:30";
const SUPERVISIONI_A = "14:30";
const isFasciaSupervisioni = (orario) => orario >= SUPERVISIONI_DA && orario <= SUPERVISIONI_A;

// Da una cella griglia[orario].giorni[g] ricava una riga per ogni "fase"
// del suo ciclo: una riga per ogni paziente che la occupa, più una riga
// "libero" per ogni fase ancora senza nessuno — così due pazienti alternati
// su base quindicinale finiscono su due righe separate anziché sulla stessa.
function righeCella(c) {
  if (!c || c.stato === "libero") return [{ tipo: "libero" }];
  const occupate = c.pazienti.map((p) => ({ tipo: "occupato", nome: p.nome, stato: p.stato }));
  const libere = Array.from({ length: c.fasiLibere || 0 }, () => ({ tipo: "libero" }));
  return [...occupate, ...libere];
}

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
  const sospesi = new Set();
  [...r.quindicinaliPieni, ...r.quindicinaliSingoli, ...r.mensili, ...r.settimanali].forEach((g) =>
    g.pazienti.forEach((p) => p.stato === "sospeso" && sospesi.add(p.nome))
  );
  const slotVenerdi = [...r.settimanali, ...r.quindicinaliPieni, ...r.quindicinaliSingoli, ...r.mensili].filter(
    (g) => g.weekday === 5
  );

  const disponibili = [];
  const supervisioni = [];
  let nLiberiPazienti = 0;
  let nLiberiSupervisioni = 0;
  r.griglia.forEach((row) => {
    const mattinaSupervisioni = isFasciaSupervisioni(row.orario);
    GIORNI.forEach((g) => {
      const c = row.giorni[g];
      const libere = righeCella(c).filter((x) => x.tipo === "libero").length;
      if (libere === 0) return;
      const detail =
        !c || c.stato === "libero"
          ? "Nessuno slot fisso assegnato su questa fascia."
          : `Le altre fasi sono occupate da ${c.pazienti.map((p) => p.nome).join(", ")} (${c.cadenza}).`;
      const voce = { giorno: GIORNI_LABEL[g], orario: row.orario, count: libere, detail };
      if (mattinaSupervisioni) {
        supervisioni.push(voce);
        nLiberiSupervisioni += libere;
      } else {
        disponibili.push(voce);
        nLiberiPazienti += libere;
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

        {slotVenerdi.length > 0 && (
          <div className="error-box" style={{ marginBottom: 16 }}>
            Attenzione: risultano {slotVenerdi.length} slot attivi di venerdì, anche se il venerdì non è più considerato
            un giorno dedicato ai pazienti — non compaiono nella griglia qui sotto, controllali manualmente:{" "}
            {slotVenerdi.map((s) => `${s.orario} ${s.pazienti.map((p) => p.nome).join("/")}`).join(", ")}.
          </div>
        )}

        <div className="disp-stats">
          <div className="disp-stat">
            <div className="n">{r.totaleSlotAttivi}</div>
            <div className="l">Slot fissi attivi</div>
          </div>
          <div className="disp-stat accent">
            <div className="n">{nLiberiPazienti}</div>
            <div className="l">Posti liberi per nuovi pazienti</div>
          </div>
          <div className="disp-stat accent">
            <div className="n">{nLiberiSupervisioni}</div>
            <div className="l">Disponibile per supervisioni (mattina {SUPERVISIONI_DA}–{SUPERVISIONI_A})</div>
          </div>
          <div className="disp-stat">
            <div className="n">{sospesi.size}</div>
            <div className="l">Sospesi che occupano comunque una fascia</div>
          </div>
        </div>

        <h2 className="sub-heading">Griglia settimanale, lunedì–giovedì</h2>
        <div className="disp-legend">
          <span><span className="disp-swatch" style={{ background: "var(--accent-soft)" }} />Verde "Disponibile" = nessun paziente assegnato</span>
          <span><span className="disp-swatch" style={{ background: "var(--danger)" }} />Nome in rosso = sospeso</span>
        </div>
        <div className="table-scroll" style={{ marginBottom: 28 }}>
          <div className="disp-grid">
            <div />
            {GIORNI.map((g) => (
              <div key={g} className="disp-dayhead">{GIORNI_COL[g]}</div>
            ))}
            {r.griglia.map((row) => {
              const mattinaSupervisioni = isFasciaSupervisioni(row.orario);
              return (
                <div key={row.orario} style={{ display: "contents" }}>
                  <div className="disp-timehead">{row.orario}</div>
                  {GIORNI.map((g) => {
                    const c = row.giorni[g];
                    const righe = righeCella(c);
                    return (
                      <div key={g} className="disp-cell">
                        {c && c.stato !== "libero" && <span className="disp-tag">{c.cadenza}</span>}
                        {righe.map((riga, i) =>
                          riga.tipo === "libero" ? (
                            <div key={i} className="disp-subrow libero">
                              Disponibile{mattinaSupervisioni ? " (supervisioni)" : ""}
                            </div>
                          ) : (
                            <div key={i} className="disp-subrow occupato">
                              <span className={riga.stato === "sospeso" ? "disp-susp" : ""}>{riga.nome}</span>
                            </div>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        <h2 className="sub-heading">Posti disponibili per nuovi pazienti ({nLiberiPazienti})</h2>
        {disponibili.length === 0 ? (
          <div className="empty-row">Nessuna fascia con margine al momento.</div>
        ) : (
          <div style={{ marginBottom: 28 }}>
            {disponibili.map((a, i) => (
              <div key={i} className="disp-avail-row">
                <div className="when">{a.orario}<span className="day">{a.giorno}</span></div>
                <div className="muted small">{a.detail}</div>
                <div className="frac-badge">{a.count} {a.count === 1 ? "posto" : "posti"}</div>
              </div>
            ))}
          </div>
        )}

        <h2 className="sub-heading">Disponibile per supervisioni ({nLiberiSupervisioni})</h2>
        {supervisioni.length === 0 ? (
          <div className="empty-row">Nessuna fascia mattutina libera al momento.</div>
        ) : (
          <div style={{ marginBottom: 28 }}>
            {supervisioni.map((a, i) => (
              <div key={i} className="disp-avail-row">
                <div className="when">{a.orario}<span className="day">{a.giorno}</span></div>
                <div className="muted small">{a.detail}</div>
                <div className="frac-badge">{a.count} {a.count === 1 ? "posto" : "posti"}</div>
              </div>
            ))}
          </div>
        )}
        <p className="sub" style={{ marginBottom: 28 }}>
          Il venerdì non è più considerato un giorno dedicato ai pazienti e non compare in questa griglia. Le fasce del
          mattino ({SUPERVISIONI_DA}–{SUPERVISIONI_A}) ospitano a volte supervisioni: i loro posti liberi sono
          conteggiati a parte e non tra i posti per nuovi pazienti. I pazienti sospesi occupano ancora formalmente la
          loro fascia: la decisione di liberarla resta manuale.
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
