// Link firmato temporaneo per scaricare un PDF già generato — il bucket
// "consensi" è privato, serve passare dal service role (mai esposto al
// browser) dopo aver controllato che chi chiede è Maurizio stesso.
import { utenteAutenticato } from "@/lib/apiAuth";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { NextResponse } from "next/server";

export async function GET(request, { params }) {
  const { supabase, errore } = await utenteAutenticato();
  if (errore) return errore;

  const quale = new URL(request.url).searchParams.get("quale") || "individuale";
  const { data: consenso, error: findError } = await supabase
    .from("consensi")
    .select("pdf_path, pdf_path_video")
    .eq("id", Number(params.id))
    .maybeSingle();
  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  const path = quale === "video" ? consenso?.pdf_path_video : consenso?.pdf_path;
  if (!path) return NextResponse.json({ error: "PDF non ancora generato." }, { status: 404 });

  const storage = createServiceRoleClient();
  const { data, error } = await storage.storage.from("consensi").createSignedUrl(path, 300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
