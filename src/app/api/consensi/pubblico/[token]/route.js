// Rotta PUBBLICA (nessun login) del link mandato al paziente. Usa la
// service role key perché chi apre questo link non ha alcuna sessione
// Supabase — la sicurezza qui sta nel fatto che si può leggere/scrivere
// SOLO la riga che corrisponde esattamente al token nell'URL (mai un
// elenco, mai una ricerca libera sulla tabella consensi).
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { NextResponse } from "next/server";

// Solo i campi che servono per mostrare il modulo — mai i dati già
// compilati da un'altra persona (es. l'altro partner di una coppia, se
// avesse lo stesso coppia_gruppo — qui si legge comunque solo per token).
export async function GET(request, { params }) {
  const supabase = createServiceRoleClient();
  const { data: consenso, error } = await supabase
    .from("consensi")
    .select("token, tipo, nome_invitato, email_invitato, tipologia, regime_tariffario, tariffa, stato")
    .eq("token", params.token)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!consenso) return NextResponse.json({ error: "Link non valido." }, { status: 404 });
  return NextResponse.json({ consenso });
}

export async function POST(request, { params }) {
  const supabase = createServiceRoleClient();
  const { data: consenso, error: findError } = await supabase
    .from("consensi")
    .select("id, stato, tipo")
    .eq("token", params.token)
    .maybeSingle();
  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!consenso) return NextResponse.json({ error: "Link non valido." }, { status: 404 });
  // Link "usato una sola volta": una volta compilato non si può ricompilare
  // (né, tantomeno, dopo che Maurizio l'ha approvato).
  if (consenso.stato !== "inviato") {
    return NextResponse.json({ error: "Questo modulo è già stato compilato." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const richiesti = ["nome", "cognome", "data_nascita", "luogo_nascita", "indirizzo", "cap", "localita", "provincia", "codice_fiscale", "telefono", "email"];
  const mancanti = richiesti.filter((k) => !String(body[k] || "").trim());
  if (mancanti.length) {
    return NextResponse.json({ error: `Campi mancanti: ${mancanti.join(", ")}.` }, { status: 400 });
  }
  if (typeof body.consenso_prestazione !== "boolean" || typeof body.consenso_dati_personali !== "boolean" || typeof body.consenso_sistema_ts !== "boolean") {
    return NextResponse.json({ error: "Rispondi a tutti e tre i consensi (sì o no)." }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
  const userAgent = request.headers.get("user-agent") || null;

  const aggiornamento = {
    nome: body.nome.trim(),
    cognome: body.cognome.trim(),
    luogo_nascita: body.luogo_nascita.trim(),
    data_nascita: body.data_nascita,
    indirizzo: body.indirizzo.trim(),
    cap: body.cap.trim(),
    provincia: body.provincia.trim(),
    localita: body.localita.trim(),
    codice_fiscale: body.codice_fiscale.trim().toUpperCase(),
    telefono: body.telefono.trim(),
    email: body.email.trim(),
    consenso_prestazione: body.consenso_prestazione,
    consenso_dati_personali: body.consenso_dati_personali,
    consenso_sistema_ts: body.consenso_sistema_ts,
    consenso_videoregistrazione: consenso.tipo === "coppia" ? !!body.consenso_videoregistrazione : null,
    compilato_at: new Date().toISOString(),
    ip_compilazione: ip,
    user_agent_compilazione: userAgent,
    stato: "compilato",
  };

  const { error: updateError } = await supabase.from("consensi").update(aggiornamento).eq("id", consenso.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
