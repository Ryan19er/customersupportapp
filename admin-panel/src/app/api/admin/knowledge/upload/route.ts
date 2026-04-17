// POST /api/admin/knowledge/upload
//
// Multipart upload endpoint used by the admin Knowledge page. Accepts a single
// file + metadata fields, writes the file to Supabase Storage, extracts and
// chunks its text, and creates the knowledge_documents + knowledge_chunks
// rows the runtime retriever uses. The customer-facing chat then cites this
// document (and offers it as a download link) on relevant questions.
//
// Runs on the Node runtime because pdf-parse / mammoth aren't Edge-compatible.

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";
import { ingestKnowledgeFile } from "@/lib/knowledge-ingest";

export const runtime = "nodejs";
export const maxDuration = 300; // up to 5 min for big PDFs

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export async function POST(req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) {
    return NextResponse.json({ error: init.error }, { status: 503 });
  }
  const supabase = init.client;

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return NextResponse.json(
      { error: "Expected multipart/form-data body" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; max is 50 MB.` },
      { status: 413 },
    );
  }

  const title = (form.get("title") as string | null) || file.name;
  const displayTitle = (form.get("display_title") as string | null) || title;
  const productSlugRaw = (form.get("product_slug") as string | null) || "";
  const subsystemRaw = (form.get("subsystem") as string | null) || "";
  const docType = (form.get("doc_type") as string | null) || "manual";
  const createdBy = (form.get("created_by") as string | null) || "admin";

  const arrayBuf = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  try {
    const result = await ingestKnowledgeFile(supabase, {
      file: { buffer, name: file.name, mime: file.type || "application/octet-stream" },
      createdBy,
      title,
      displayTitle,
      productSlug: productSlugRaw.trim() || null,
      subsystem: subsystemRaw.trim() || null,
      docType,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Ingestion failed" },
      { status: 500 },
    );
  }
}
