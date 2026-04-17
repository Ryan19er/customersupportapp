// DELETE /api/admin/knowledge/documents/:id
//
// Removes a knowledge document, its chunks (via the FK cascade), and the
// underlying Supabase Storage object so it no longer shows up as a download
// in customer chat.

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const init = getSupabaseAdminClientSafe();
  if (!init.ok) {
    return NextResponse.json({ error: init.error }, { status: 503 });
  }
  const supabase = init.client;

  const { data: doc, error: fetchErr } = await supabase
    .from("knowledge_documents")
    .select("id, source_ref, source_type")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // Delete DB row (chunks cascade).
  const { error: delErr } = await supabase
    .from("knowledge_documents")
    .delete()
    .eq("id", id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Best-effort storage cleanup — only remove files we placed in the bucket.
  if ((doc as any).source_type === "upload" && (doc as any).source_ref) {
    await supabase.storage
      .from("knowledge-docs")
      .remove([(doc as any).source_ref as string]);
  }

  return NextResponse.json({ ok: true });
}
