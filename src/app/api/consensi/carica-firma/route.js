// Carica l'immagine della firma di Maurizio nel bucket privato "consensi" e
// la ricorda in settings.firma_professionista_url — usata poi su ogni PDF
// di consenso generato (vedi consensoPdf.js), non serve ricaricarla ogni
// volta.
import { utenteAutenticato } from "@/lib/apiAuth";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { NextResponse } from "next/server";

export async function POST(request) {
  const { supabase, user, errore } = await utenteAutenticato();
  if (errore) return errore;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file) return NextResponse.json({ error: "Nessun file ricevuto." }, { status: 400 });

  const estensione = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : null;
  if (!estensione) return NextResponse.json({ error: "Usa un'immagine PNG o JPG." }, { status: 400 });

  const path = `firma-professionista.${estensione}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Storage via service role: il bucket "consensi" è privato e senza policy
  // RLS dedicate (creato via script) — il client normale (anon key + sessione)
  // verrebbe bloccato. L'autenticazione vera è già stata controllata sopra.
  const storage = createServiceRoleClient();
  const { error: uploadError } = await storage.storage.from("consensi").upload(path, bytes, {
    contentType: file.type,
    upsert: true,
  });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { error: updateError } = await supabase.from("settings").update({ firma_professionista_url: path }).eq("user_id", user.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: true, path });
}
