"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Sidebar from "@/components/Sidebar";
import Modal from "@/components/Modal";
import { DEFAULT_SETTINGS, tariffaStandard, formatDataItaliana } from "@/lib/logic";

const TIPOLOGIA_LABEL = { individuale: "Individuale", coppia: "Coppia", consulenza: "Consulenza", supervisione: "Supervisione" };

function personaVuota() {
  return { nome: "", email: "", telefono: "" };
}

export default function ConsensiPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [consensi, setConsensi] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: s }] = await Promise.all([
      supabase.from("consensi").select("*").order("created_at", { ascending: false }),
      supabase.from("settings").select("*").maybeSingle(),
    ]);
    setConsensi(c || []);
    if (s) setSettings({ ...DEFAULT_SETTINGS, ...s });
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // --- Nuovo invito ---
  const [nuovoModal, setNuovoModal] = useState(null); // { tipo, tipologia, regime_tariffario, persone: [...] } | null
  const [nuovoRisultato, setNuovoRisultato] = useState(null);
  const [nuovoInvio, setNuovoInvio] = useState(false);

  function apriNuovo() {
    setNuovoModal({ tipo: "individuale", tipologia: "individuale", regime_tariffario: "regolare", persone: [personaVuota()] });
    setNuovoRisultato(null);
  }
  function cambiaTipo(tipo) {
    setNuovoModal((m) => ({
      ...m,
      tipo,
      tipologia: tipo === "coppia" ? "coppia" : "individuale",
      persone: tipo === "coppia" ? [personaVuota(), personaVuota()] : [personaVuota()],
    }));
  }

  async function inviaNuovo() {
    setNuovoInvio(true);
    try {
      const res = await fetch("/api/consensi/invia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nuovoModal),
      });
      const data = await res.json();
      setNuovoRisultato(data);
      if (data.ok) load();
    } catch (e) {
      setNuovoRisultato({ ok: false, risultati: [{ ok: false, error: e.message }] });
    }
    setNuovoInvio(false);
  }

  async function copia(testo) {
    try {
      await navigator.clipboard.writeText(testo);
      alert("Link copiato.");
    } catch {
      window.prompt("Copia il link:", testo);
    }
  }

  // --- Revisione/approvazione ---
  const [revisione, setRevisione] = useState(null); // consenso.id in revisione | null
  const [datiApprova, setDatiApprova] = useState({});
  const [approvaInvio, setApprovaInvio] = useState(false);
  const [approvaErrore, setApprovaErrore] = useState("");

  function apriRevisione(c) {
    setRevisione(c.id);
    setApprovaErrore("");
    setDatiApprova({
      nome_calendario: c.tipo === "coppia" ? "" : `${c.nome || ""} ${c.cognome || ""}`.trim(),
      costo_unitario: tariffaStandard(c.tipologia, c.regime_tariffario, settings),
      soglia_fatturazione: 5,
      modalita_pagamento: "Bonifico",
      fatturareAConsensoId: c.id,
    });
  }

  async function confermaApprova(c) {
    setApprovaInvio(true);
    setApprovaErrore("");
    try {
      const res = await fetch(`/api/consensi/${c.id}/approva`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datiApprova),
      });
      const data = await res.json();
      if (!res.ok) {
        setApprovaErrore(data.error || "Approvazione non riuscita.");
        setApprovaInvio(false);
        return;
      }
      setRevisione(null);
      load();
    } catch (e) {
      setApprovaErrore(e.message);
    }
    setApprovaInvio(false);
  }

  async function scaricaPdf(id, quale) {
    const res = await fetch(`/api/consensi/${id}/pdf-url?quale=${quale}`);
    const data = await res.json();
    if (data.url) window.open(data.url, "_blank");
    else alert(data.error || "PDF non disponibile.");
  }

  if (loading) return <div style={{ padding: 40 }}>Caricamento…</div>;

  const inAttesa = consensi.filter((c) => c.stato === "inviato");
  const daRivedere = consensi.filter((c) => c.stato === "compilato");
  const approvati = consensi.filter((c) => c.stato === "approvato");

  // Raggruppa per coppia_gruppo dove presente, così una coppia appare come una riga sola.
  function raggruppa(lista) {
    const visti = new Set();
    const gruppi = [];
    for (const c of lista) {
      if (visti.has(c.id)) continue;
      if (c.coppia_gruppo) {
        const compagni = lista.filter((x) => x.coppia_gruppo === c.coppia_gruppo);
        compagni.forEach((x) => visti.add(x.id));
        gruppi.push(compagni);
      } else {
        visti.add(c.id);
        gruppi.push([c]);
      }
    }
    return gruppi;
  }

  return (
    <div className="app-root">
      <Sidebar readyCount={0} />
      <main className="main">
        <header className="view-header">
          <div>
            <h1>Consensi informati</h1>
            <p className="sub">Link da mandare prima del primo incontro, con anagrafica e consenso informato.</p>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={apriNuovo}>+ Nuovo invito</button>
          </div>
        </header>

        <section className="section">
          <div className="section-head"><h2>In attesa di compilazione ({inAttesa.length})</h2></div>
          <div className="section-body">
            {inAttesa.length === 0 ? (
              <div className="empty-row">Nessuno.</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Nome (promemoria)</th><th>Tipo</th><th>Contatto</th><th>Inviato</th><th></th></tr></thead>
                <tbody>
                  {inAttesa.map((c) => (
                    <tr key={c.id}>
                      <td className="name">{c.nome_invitato}</td>
                      <td>{c.tipo === "coppia" ? "Coppia" : "Individuale"} — {TIPOLOGIA_LABEL[c.tipologia]}</td>
                      <td className="mono small">{c.email_invitato || c.telefono_invitato || "—"}</td>
                      <td className="mono">{formatDataItaliana(c.created_at.slice(0, 10))}</td>
                      <td>
                        <button className="btn-small" onClick={() => copia(`${settings.app_base_url || ""}/consenso/${c.token}`)}>Copia link</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head"><h2>Da rivedere ({daRivedere.length})</h2></div>
          <div className="section-body">
            {daRivedere.length === 0 ? (
              <div className="empty-row">Nessuno.</div>
            ) : (
              raggruppa(daRivedere).map((gruppo) => {
                const c = gruppo[0];
                const entrambiPronti = gruppo.length === 2 && gruppo.every((x) => x.stato === "compilato");
                const inAttesaPartner = c.tipo === "coppia" && !entrambiPronti;
                return (
                  <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, marginBottom: 10 }}>
                    {gruppo.map((p) => (
                      <div key={p.id} style={{ marginBottom: 6 }}>
                        <strong>{p.nome} {p.cognome}</strong> — {p.email} — {p.telefono} — CF: {p.codice_fiscale}
                        <div className="muted small">Compilato il {new Date(p.compilato_at).toLocaleString("it-IT")} da IP {p.ip_compilazione || "—"}</div>
                      </div>
                    ))}
                    {inAttesaPartner && <p className="muted small">In attesa che l&apos;altro partner compili il proprio modulo.</p>}
                    {!inAttesaPartner && (
                      <button className="btn btn-small" onClick={() => apriRevisione(c)}>Rivedi e approva</button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head"><h2>Approvati ({approvati.length})</h2></div>
          <div className="section-body">
            {approvati.length === 0 ? (
              <div className="empty-row">Nessuno.</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Nome</th><th>Tipo</th><th>Approvato</th><th></th></tr></thead>
                <tbody>
                  {approvati.map((c) => (
                    <tr key={c.id}>
                      <td className="name">{c.nome} {c.cognome}</td>
                      <td>{TIPOLOGIA_LABEL[c.tipologia]}</td>
                      <td className="mono">{new Date(c.approvato_at).toLocaleDateString("it-IT")}</td>
                      <td>
                        <button className="btn-small" onClick={() => scaricaPdf(c.id, "individuale")}>PDF consenso</button>{" "}
                        {c.pdf_path_video && <button className="btn-small" onClick={() => scaricaPdf(c.id, "video")}>PDF registrazione</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>

      {nuovoModal && (
        <Modal maxWidth={520}>
          <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>Nuovo invito</h2>
          {!nuovoRisultato ? (
            <>
              <label className="muted small" style={{ display: "block", marginTop: 10 }}>
                <input type="radio" checked={nuovoModal.tipo === "individuale"} onChange={() => cambiaTipo("individuale")} /> Individuale
              </label>
              <label className="muted small" style={{ display: "block" }}>
                <input type="radio" checked={nuovoModal.tipo === "coppia"} onChange={() => cambiaTipo("coppia")} /> Coppia (2 moduli individuali + registrazione sedute)
              </label>

              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <label className="muted small" style={{ flex: 1 }}>
                  Tipologia
                  <select style={{ display: "block", width: "100%", marginTop: 4 }} value={nuovoModal.tipologia} onChange={(e) => setNuovoModal((m) => ({ ...m, tipologia: e.target.value }))}>
                    <option value="individuale">Individuale</option>
                    <option value="coppia">Coppia</option>
                    <option value="consulenza">Consulenza</option>
                    <option value="supervisione">Supervisione</option>
                  </select>
                </label>
                <label className="muted small" style={{ flex: 1 }}>
                  Regime
                  <select style={{ display: "block", width: "100%", marginTop: 4 }} value={nuovoModal.regime_tariffario} onChange={(e) => setNuovoModal((m) => ({ ...m, regime_tariffario: e.target.value }))}>
                    <option value="regolare">Regolare</option>
                    <option value="agevolata">Agevolata</option>
                  </select>
                </label>
              </div>
              <p className="muted small" style={{ marginTop: 8 }}>
                Tariffa che comparirà nel modulo: € {tariffaStandard(nuovoModal.tipologia, nuovoModal.regime_tariffario, settings)} a seduta.
              </p>

              {nuovoModal.persone.map((p, i) => (
                <div key={i} style={{ marginTop: 12, paddingTop: 12, borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                  <p className="muted small" style={{ margin: "0 0 6px" }}>
                    {nuovoModal.tipo === "coppia" ? `Partner ${i + 1}` : "Paziente"} — nome/email/telefono sono facoltativi, solo un promemoria per te
                  </p>
                  <input
                    placeholder="Nome (facoltativo)"
                    style={{ display: "block", width: "100%", marginBottom: 6, padding: "6px 8px" }}
                    value={p.nome}
                    onChange={(e) => setNuovoModal((m) => ({ ...m, persone: m.persone.map((pp, j) => (j === i ? { ...pp, nome: e.target.value } : pp)) }))}
                  />
                  <input
                    placeholder="Email (facoltativa — se c'è, manda anche l'email automatica)"
                    style={{ display: "block", width: "100%", marginBottom: 6, padding: "6px 8px" }}
                    value={p.email}
                    onChange={(e) => setNuovoModal((m) => ({ ...m, persone: m.persone.map((pp, j) => (j === i ? { ...pp, email: e.target.value } : pp)) }))}
                  />
                  <input
                    placeholder="Telefono (facoltativo, solo per tua memoria)"
                    style={{ display: "block", width: "100%", padding: "6px 8px" }}
                    value={p.telefono}
                    onChange={(e) => setNuovoModal((m) => ({ ...m, persone: m.persone.map((pp, j) => (j === i ? { ...pp, telefono: e.target.value } : pp)) }))}
                  />
                </div>
              ))}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                <button className="btn btn-ghost" onClick={() => setNuovoModal(null)}>Annulla</button>
                <button className="btn btn-primary" disabled={nuovoInvio} onClick={inviaNuovo}>{nuovoInvio ? "Genero…" : "Genera link"}</button>
              </div>
            </>
          ) : (
            <>
              {nuovoRisultato.risultati?.map((r, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <strong>{r.nome}</strong>
                  {r.ok ? (
                    <>
                      <div className="mono small" style={{ wordBreak: "break-all" }}>{r.link}</div>
                      <button className="btn-small" onClick={() => copia(r.link)}>Copia link</button>
                      {r.emailInviata && <span className="muted small"> — email inviata anche a {r.email}</span>}
                    </>
                  ) : (
                    <div style={{ color: "#A23B3B" }}>{r.error}</div>
                  )}
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button className="btn btn-primary" onClick={() => setNuovoModal(null)}>Chiudi</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {revisione && (() => {
        const c = consensi.find((x) => x.id === revisione);
        if (!c) return null;
        const gruppo = c.coppia_gruppo ? consensi.filter((x) => x.coppia_gruppo === c.coppia_gruppo) : [c];
        return (
          <Modal maxWidth={560}>
            <h2 style={{ marginTop: 0, fontFamily: "Georgia, serif", fontWeight: 500 }}>Rivedi e approva</h2>
            {gruppo.map((p) => (
              <div key={p.id} style={{ marginBottom: 10, fontSize: 13.5 }}>
                <strong>{p.nome} {p.cognome}</strong><br />
                Nato/a a {p.luogo_nascita} il {p.data_nascita} — {p.indirizzo}, {p.cap} {p.localita} ({p.provincia})<br />
                CF: {p.codice_fiscale} — Tel: {p.telefono} — Email: {p.email}<br />
                Consensi: prestazione {p.consenso_prestazione ? "SÌ" : "NO"}, dati personali {p.consenso_dati_personali ? "SÌ" : "NO"}, Sistema TS {p.consenso_sistema_ts ? "SÌ" : "NO"}
                {c.tipo === "coppia" && <>, videoregistrazione {p.consenso_videoregistrazione ? "SÌ" : "NO"}</>}
              </div>
            ))}

            {c.tipo === "coppia" && (
              <label className="muted small" style={{ display: "block", marginTop: 10 }}>
                Fattura a
                <select
                  style={{ display: "block", width: "100%", marginTop: 4 }}
                  value={datiApprova.fatturareAConsensoId}
                  onChange={(e) => setDatiApprova((d) => ({ ...d, fatturareAConsensoId: Number(e.target.value) }))}
                >
                  {gruppo.map((p) => (
                    <option key={p.id} value={p.id}>{p.nome} {p.cognome}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="muted small" style={{ display: "block", marginTop: 10 }}>
              Nome calendario
              <input
                style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px" }}
                value={datiApprova.nome_calendario}
                onChange={(e) => setDatiApprova((d) => ({ ...d, nome_calendario: e.target.value }))}
              />
            </label>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <label className="muted small" style={{ flex: 1 }}>
                Costo a seduta
                <input type="number" step="0.01" style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px" }} value={datiApprova.costo_unitario} onChange={(e) => setDatiApprova((d) => ({ ...d, costo_unitario: parseFloat(e.target.value) || 0 }))} />
              </label>
              <label className="muted small" style={{ flex: 1 }}>
                Soglia fatturazione
                <input type="number" style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px" }} value={datiApprova.soglia_fatturazione} onChange={(e) => setDatiApprova((d) => ({ ...d, soglia_fatturazione: parseInt(e.target.value) || 5 }))} />
              </label>
            </div>

            {approvaErrore && <p style={{ color: "#A23B3B" }}>{approvaErrore}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setRevisione(null)}>Annulla</button>
              <button className="btn btn-primary" disabled={approvaInvio || !datiApprova.nome_calendario} onClick={() => confermaApprova(c)}>
                {approvaInvio ? "Creo il paziente…" : "Approva e crea paziente"}
              </button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
