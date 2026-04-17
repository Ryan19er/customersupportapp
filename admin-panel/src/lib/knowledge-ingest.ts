// Shared knowledge-ingestion helpers used by the admin upload API.
//
// Runs on Node (not Edge) because it uses pdf-parse / mammoth, both of which
// need Node Buffers + fs. Keeps parsing + chunking + embedding + DB writes
// in one place so the upload route handler stays small.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

import { embedBatch } from "@/lib/embed-client";

// ---------------------------------------------------------------------------
// Product / subsystem classification (mirrors scripts/ingest_knowledge.py).
// ---------------------------------------------------------------------------

const PRODUCT_ALIASES: Array<[string, string[]]> = [
  ["ss1510", ["ss1510", "compact fiber"]],
  ["ss3015cpr", ["ss3015cpr", "cpr", "3015cpr"]],
  ["ss3015cp", ["ss3015cp", "ss4015cp", "ss6015cp", "ss4020cp", "ss6020cp", "nighthawk cp", "3015cp"]],
  ["ss3015", ["ss3015", "ss4015", "ss6015", "ss4020", "ss6020", "nighthawk"]],
  ["sl3015cp", ["sl3015cp", "sl4020cp", "sl6020cp", "sl_3015", "sl-3015", "spirit", "maxpar"]],
  ["x3", ["x3 laser", "x3 cutter", "x3cp"]],
  ["ss2060a", ["ss2060a", "ss3060a", "auto loader", "bundle loader"]],
  ["ss2060", ["ss2060", "ss3060"]],
  ["slx1390", ["slx1390", "slx 1390", "co2 laser"]],
  ["marking_laser", ["fiber marking", "mini split", "marking laser"]],
  ["press_brake", ["press brake", "ep-press", "epress", "ibend"]],
  ["rapid_sander", ["rapid sander", "deburring"]],
];

const SUBSYSTEMS: Array<[string, string[]]> = [
  ["assist_gas", ["assist gas", "gas pressure", "oxygen", "nitrogen", "air compressor", "compressor"]],
  ["chiller", ["chiller", "water tank", "coolant", "coolant flow"]],
  ["laser_source", ["laser source", "ipg", "max photonics", "raycus", "maxphotonics"]],
  ["optics", ["optic", "lens", "nozzle", "focus", "collimator", "protective window", "mirror"]],
  ["head", ["cutting head", "blt420", "blt641", "raytools", "autofocus"]],
  ["motion", ["servo", "drive", "axis", "gantry", "rail", "linear guide"]],
  ["controller", ["hypcut", "cypcut", "cypnest", "hmi", "ethercat", "controller", "power automation"]],
  ["software", ["cypnest", "lantek", "lightburn", "nesting"]],
  ["enclosure", ["enclosure", "door interlock", "filtration", "smoke", "dust collector"]],
  ["rotary", ["rotary", "chuck", "pneumatic chuck", "tube attachment"]],
  ["hydraulics", ["hydraulic"]],
  ["safety", ["iris", "laser safe", "estop", "e-stop", "emergency stop"]],
  ["installation", ["installation", "install guide", "commissioning", "power up"]],
  ["consumables", ["consumable", "fiber laser consumables", "nozzle list"]],
];

const SYMPTOM_KEYWORDS: Array<[string, string[]]> = [
  ["burn_marks", ["burn mark", "dross", "slag", "bad edge"]],
  ["pierce_failure", ["pierce fail", "will not pierce", "blow through"]],
  ["alignment", ["alignment", "beam alignment", "centering"]],
  ["focus_offset", ["focus", "focus height", "standoff"]],
  ["gas_pressure", ["gas pressure", "psi", "bar pressure"]],
  ["alarm", ["alarm", "fault", "err code", "error code"]],
  ["homing", ["homing", "home axis", "not homing"]],
  ["communication", ["comms", "communication", "ethercat error", "bus error"]],
  ["cooling", ["chiller alarm", "coolant low", "water temp"]],
  ["safety_interlock", ["interlock", "door open", "light curtain"]],
];

const ERROR_CODE_RE = /\b(?:ERR|ALM|F|E|FAULT|ALARM)[ -]?([A-Z0-9]{2,5})\b/gi;

export function classifyProduct(text: string): string | null {
  const h = text.toLowerCase();
  for (const [slug, aliases] of PRODUCT_ALIASES) {
    for (const a of aliases) if (h.includes(a)) return slug;
  }
  return null;
}

export function classifySubsystem(text: string): string | null {
  const h = text.toLowerCase();
  for (const [slug, keys] of SUBSYSTEMS) {
    for (const k of keys) if (h.includes(k)) return slug;
  }
  return null;
}

export function extractSymptomTags(text: string): string[] {
  const h = text.toLowerCase();
  const out: string[] = [];
  for (const [tag, keys] of SYMPTOM_KEYWORDS) {
    for (const k of keys) {
      if (h.includes(k)) {
        out.push(tag);
        break;
      }
    }
  }
  return Array.from(new Set(out));
}

export function extractErrorCodes(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(ERROR_CODE_RE)) {
    const code = (m[0] ?? "").toUpperCase().replace(/\s+/g, "");
    if (code) out.push(code);
  }
  return Array.from(new Set(out)).slice(0, 20);
}

// ---------------------------------------------------------------------------
// File extraction.
// ---------------------------------------------------------------------------

export async function extractText(file: {
  buffer: Buffer;
  mime: string;
  name: string;
}): Promise<string> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf") || file.mime === "application/pdf") {
    // Dynamic import so pdf-parse's top-level self-test (which reads a
    // bundled test PDF when module.parent is null) does not break Turbopack.
    // Using a dynamic import at runtime means module.parent is set and the
    // self-test branch is skipped.
    const mod: any = await import("pdf-parse");
    const pdfParse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string }>;
    const parsed = await pdfParse(file.buffer);
    return String(parsed.text ?? "");
  }
  if (
    lower.endsWith(".docx") ||
    file.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammoth = await import("mammoth");
    const res = await mammoth.extractRawText({ buffer: file.buffer });
    return String(res.value ?? "");
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md") || file.mime.startsWith("text/")) {
    return file.buffer.toString("utf8");
  }
  throw new Error(
    `Unsupported file type: ${file.mime || lower}. Upload PDF, DOCX, TXT, or MD.`,
  );
}

// ---------------------------------------------------------------------------
// Chunking — ~600 words with ~80-word overlap, broken on paragraphs.
// ---------------------------------------------------------------------------

export type RawChunk = { ord: number; heading: string | null; text: string };

export function chunkText(text: string, targetWords = 600, overlapWords = 80): RawChunk[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const chunks: RawChunk[] = [];
  let currentWords: string[] = [];
  let currentHeading: string | null = null;
  let ord = 0;

  const flush = () => {
    if (!currentWords.length) return;
    chunks.push({
      ord: ord++,
      heading: currentHeading,
      text: currentWords.join(" ").trim(),
    });
    if (overlapWords > 0 && currentWords.length > overlapWords) {
      currentWords = currentWords.slice(-overlapWords);
    } else {
      currentWords = [];
    }
  };

  for (const para of paragraphs) {
    const isHeading = para.length < 120 && /^[A-Z0-9][^.!?]*$/.test(para);
    if (isHeading) {
      flush();
      currentHeading = para;
      continue;
    }
    const words = para.split(/\s+/);
    for (const w of words) {
      currentWords.push(w);
      if (currentWords.length >= targetWords) flush();
    }
    currentWords.push(""); // preserve paragraph break with a blank
  }
  flush();

  return chunks
    .map((c) => ({ ...c, text: c.text.replace(/\s+/g, " ").trim() }))
    .filter((c) => c.text.length > 20);
}

// ---------------------------------------------------------------------------
// Main ingestion entry point: upload raw file -> Supabase Storage, extract
// text, write knowledge_documents + knowledge_chunks with embeddings.
// ---------------------------------------------------------------------------

export type IngestInput = {
  file: { buffer: Buffer; name: string; mime: string };
  createdBy: string;
  title?: string | null;
  displayTitle?: string | null;
  productSlug?: string | null;
  subsystem?: string | null;
  docType?: string | null;
  machineFamily?: string | null;
};

export type IngestResult = {
  documentId: string;
  fileUrl: string;
  chunkCount: number;
  productSlug: string | null;
  subsystem: string | null;
  alreadyIngested: boolean;
};

export async function ingestKnowledgeFile(
  supabase: SupabaseClient,
  input: IngestInput,
): Promise<IngestResult> {
  const { file, createdBy } = input;
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
  const checksum = createHash("sha256").update(file.buffer).digest("hex");

  // 1. Idempotency: if we've already seen this exact file (same sha), reuse the
  //    existing document and return its file_url.
  const { data: existing } = await supabase
    .from("knowledge_documents")
    .select("id, file_url, chunk_count, product_slug, subsystem")
    .eq("checksum", checksum)
    .maybeSingle();
  if (existing && (existing as any).file_url) {
    return {
      documentId: (existing as any).id,
      fileUrl: (existing as any).file_url,
      chunkCount: (existing as any).chunk_count ?? 0,
      productSlug: (existing as any).product_slug ?? null,
      subsystem: (existing as any).subsystem ?? null,
      alreadyIngested: true,
    };
  }

  // 2. Upload the raw file to the knowledge-docs bucket. Path is namespaced by
  //    checksum so re-uploads of the same file reuse the same object.
  const storagePath = `${checksum.slice(0, 2)}/${checksum}-${safeName}`;
  const uploadRes = await supabase.storage
    .from("knowledge-docs")
    .upload(storagePath, file.buffer, {
      contentType: file.mime || "application/octet-stream",
      upsert: true,
    });
  if (uploadRes.error) {
    throw new Error(`Storage upload failed: ${uploadRes.error.message}`);
  }
  const { data: publicUrlData } = supabase.storage
    .from("knowledge-docs")
    .getPublicUrl(storagePath);
  const fileUrl = publicUrlData.publicUrl;

  // 3. Extract text and classify.
  const rawText = (await extractText(file)).trim();
  if (!rawText) {
    throw new Error(
      "Could not extract any text from this file. If it's a scanned PDF, run OCR first.",
    );
  }

  const productSlug =
    input.productSlug ?? classifyProduct(`${file.name} ${rawText.slice(0, 4000)}`);
  const subsystem =
    input.subsystem ?? classifySubsystem(`${file.name} ${rawText.slice(0, 4000)}`);
  const docType = input.docType ?? "manual";
  const machineFamily = input.machineFamily ?? null;

  // 4. Upsert the document row.
  let documentId: string;
  if (existing) {
    documentId = (existing as any).id;
    await supabase
      .from("knowledge_documents")
      .update({
        title: input.title ?? safeName,
        display_title: input.displayTitle ?? input.title ?? safeName,
        file_url: fileUrl,
        raw_text: rawText.slice(0, 2_000_000), // cap raw_text to stay under row size
        source_type: "upload",
        source_ref: storagePath,
        checksum,
        byte_size: file.buffer.byteLength,
        product_slug: productSlug,
        subsystem: subsystem,
        doc_type: docType,
        machine_family: machineFamily,
        chunk_status: "processing",
        ingested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: createdBy,
      })
      .eq("id", documentId);
  } else {
    const insertRes = await supabase
      .from("knowledge_documents")
      .insert({
        title: input.title ?? safeName,
        display_title: input.displayTitle ?? input.title ?? safeName,
        file_url: fileUrl,
        raw_text: rawText.slice(0, 2_000_000),
        source_type: "upload",
        source_ref: storagePath,
        checksum,
        byte_size: file.buffer.byteLength,
        product_slug: productSlug,
        subsystem: subsystem,
        doc_type: docType,
        machine_family: machineFamily,
        chunk_status: "processing",
        ingested_at: new Date().toISOString(),
        created_by: createdBy,
      })
      .select("id")
      .single();
    if (insertRes.error || !insertRes.data) {
      throw new Error(`knowledge_documents insert failed: ${insertRes.error?.message}`);
    }
    documentId = (insertRes.data as any).id;
  }

  // 5. Wipe any pre-existing chunks for this document (we're re-ingesting).
  await supabase.from("knowledge_chunks").delete().eq("document_id", documentId);

  // 6. Chunk + embed.
  const rawChunks = chunkText(rawText);
  if (!rawChunks.length) {
    await supabase
      .from("knowledge_documents")
      .update({ chunk_status: "ready", chunk_count: 0 })
      .eq("id", documentId);
    return {
      documentId,
      fileUrl,
      chunkCount: 0,
      productSlug,
      subsystem,
      alreadyIngested: false,
    };
  }

  const vectors = await embedBatch(rawChunks.map((c) => c.text));

  const rows = rawChunks.map((c, i) => ({
    document_id: documentId,
    ord: c.ord,
    heading: c.heading,
    text: c.text,
    token_count: Math.ceil(c.text.split(/\s+/).length / 0.75),
    product_slug: productSlug,
    machine_family: machineFamily,
    subsystem: subsystem,
    symptom_tags: extractSymptomTags(c.text),
    error_codes: extractErrorCodes(c.text),
    embedding: vectors[i] ?? null,
    source_type: "upload",
    source_ref: storagePath,
  }));

  // Insert in batches of 200 so we don't hit request-size limits on big PDFs.
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const ins = await supabase.from("knowledge_chunks").insert(batch);
    if (ins.error) {
      throw new Error(`knowledge_chunks insert failed: ${ins.error.message}`);
    }
  }

  await supabase
    .from("knowledge_documents")
    .update({ chunk_status: "ready", chunk_count: rows.length })
    .eq("id", documentId);

  return {
    documentId,
    fileUrl,
    chunkCount: rows.length,
    productSlug,
    subsystem,
    alreadyIngested: false,
  };
}
