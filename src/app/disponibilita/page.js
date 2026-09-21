"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import ChiusureCalendarioModal from "@/components/ChiusureCalendarioModal";
import { computeGrigliaDisponibilita, todayISO, formatDataItaliana } from "@/lib/logic";

// Il venerdì non è più un giorno dedicato ai pazienti (vedi richiesta
// 2026-09-15): la griglia e i conteggi di disponibilità coprono solo
// lunedì-giovedì. Se compaiono comunque slot attivi di venerdì (dato
// anomalo rispetto a questa scelta), li segnaliamo invece di nasconderli.
const GIORNI = [1, 2, 3, 4];
const GIORNI_COL = { 1: "Lun", 2: "Mar", 3: "Mer", 4: "Gio" };
const GIORNI_LABEL = { 1: "Lunedì", 2: "Martedì", 3: "Mercoledì", 4: "Giovedì" };

// Da una cella griglia[orario].giorni[g] ricava una riga per ogni paziente che
// la occupa (così due pazienti alternati su base quindicinale finiscono su
// righe separate anziché sulla stessa), più al massimo UNA riga "Disponibile"
// che riassume la capacità libera residua in "volte al mese": una fascia ha
// fasiTotali fasi in un ciclo di fasiTotali settimane, quindi ciascuna fase
// libera ricorre 4/fasiTotali volte in 4 settimane — es. quindicinale
// (fasiTotali=2) → 2 volte/mese a fase, mensile (fasiTotali=4) → 1 volta/mese
// a fase, da cui fasiLibere*(4/fasiTotali) volte/mese libere in quella fascia.
function righeCella(c) {
  if (!c || c.stato === "libero") return [{ tipo: "libero" }];
  const occupate = c.pazienti.map((p) => ({ tipo: "occupato", nome: p.nome, stato: p.stato }));
  const righe = [...occupate];
  if (c.fasiLibere > 0) {
    const alMese = Math.round((c.fasiLibere * 4) / c.fasiTotali);
    righe.push({ tipo: "libero", cadenza: c.cadenza, alMese });
  }
  return righe;
}

export default function DisponibilitaPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [chiusureAperte, setChiusureAperte] = useState(false);

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
  r.griglia.forEach((row) => {
    GIORNI.forEach((g) => {
      const c = row.giorni[g];
      const rigaLibera = righeCella(c).find((x) => x.tipo === "libero");
      if (!rigaLibera) return;
      const detail =
        !c || c.stato === "libero"
          ? "Nessuno slot fisso assegnato su questa fascia."
          : `Le altre fasi sono occupate da ${c.pazienti.map((p) => p.nome).join(", ")}.`;
      disponibili.push({ giorno: GIORNI_LABEL[g], orario: row.orario, cadenza: rigaLibera.cadenza, alMese: rigaLibera.alMese, detail });
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
            <button className="btn btn-ghost" onClick={() => setChiusureAperte(true)}>Chiusure calendario</button>
          </div>
        </header>

        {chiusureAperte && <ChiusureCalendarioModal onClose={() => setChiusureAperte(false)} />}

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
            <div className="n">{disponibili.length}</div>
            <div className="l">Fasce con margine per nuovi pazienti</div>
          </div>
          <div className="disp-stat">
            <div className="n">{sospesi.size}</div>
            <div className="l">Sospesi che occupano comunque una fascia</div>
          </div>
        </div>

        <h2 className="sub-heading">Griglia settimanale, lunedì–giovedì</h2>
        <div className="disp-legend">
          <span><span className="disp-swatch" style={{ background: "var(--accent-soft)" }} />Verde "Disponibile" = spazio libero</span>
          <span>Ogni ora è divisa in due caselle (le due settimane del ciclo quindicinale)</span>
          <span><span className="disp-swatch" style={{ background: "var(--danger)" }} />Nome in rosso = sospeso</span>
        </div>
        <div className="table-scroll" style={{ marginBottom: 28 }}>
          <div className="disp-grid">
            <div />
            {GIORNI.map((g) => (
              <div key={g} className="disp-dayhead">{GIORNI_COL[g]}</div>
            ))}
            {r.griglia.map((row) => (
              <div key={row.orario} style={{ display: "contents" }}>
                <div className="disp-timehead">{row.orario}</div>
                {GIORNI.map((g) => {
                  const c = row.giorni[g];
                  return (
                    <div key={g} className="disp-cell">
                      {c?.conflitto && (
                        <div className="disp-conflitto">
                          Conflitto: {c.conflittiDettaglio.map((coppia) => coppia.join(" vs ")).join(", ")}
                        </div>
                      )}
                      {c.sottoSlot.map((s, i) =>
                        s.pazienti.length === 0 ? (
                          <div key={i} className="disp-sub libero">Disponibile</div>
                        ) : (
                          <div key={i} className="disp-sub">
                            {s.pazienti.map((p, j) => (
                              <span key={j}>
                                {j > 0 && " / "}
                                <span className={p.stato === "sospeso" ? "disp-susp" : ""}>{p.nome}</span>
                              </span>
                            ))}
                          </div>
                        )
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
                <div className="frac-badge">{a.cadenza ? `${a.cadenza} — ${a.alMese} al mese` : "disponibile"}</div>
              </div>
            ))}
          </div>
        )}
        <p className="sub" style={{ marginBottom: 28 }}>
          Il venerdì non è più considerato un giorno dedicato ai pazienti e non compare in questa griglia. I pazienti
          sospesi occupano ancora formalmente la loro fascia: la decisione di liberarla resta manuale.
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
                <td>
                  {s.pazienti.map((p) => `${p.nome} (${p.anchor_date})`).join(", ")}
                  {s.conflitto && (
                    <div style={{ color: "var(--danger)", fontWeight: 600 }}>
                      Conflitto: {s.conflittiDettaglio.map((coppia) => coppia.join(" vs ")).join(", ")}
                    </div>
                  )}
                </td>
                <td className="mono">{s.fasiLibere}/4</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}
