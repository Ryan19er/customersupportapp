// Ranked retrieval edge function.
// Input: { query, product_slug?, symptom_tags?, error_codes?, limit?, session_id? }
// Output: { evidence: Array<{idx,type,id,text,heading,product_slug,subsystem,score}> }
//
// Calls the embed function for query embedding (cached by hash for 10 min)
// and then invokes the `retrieve_knowledge` SQL RPC for hybrid ranking.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

type Req = {
  query: string;
  product_slug?: string | null;
  symptom_tags?: string[];
  error_codes?: string[];
  limit?: number;
  session_id?: string;
};

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function embedQuery(query: string, session_id?: string): Promise<number[] | null> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return null;

  const db = createClient(url, serviceKey);
  const hash = await sha256Hex(query);

  // 10-minute cache lookup.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: cached } = await db
    .from("query_embedding_cache")
    .select("embedding")
    .eq("query_hash", hash)
    .gte("created_at", tenMinAgo)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cached?.embedding) {
    try {
      // pgvector round-trip returns a string like "[0.1,0.2,...]".
      if (typeof cached.embedding === "string") {
        return JSON.parse(cached.embedding);
      }
      return cached.embedding as unknown as number[];
    } catch {
      // fall through to fresh embed
    }
  }

  const fnUrl = `${url.replace(/\/+$/, "")}/functions/v1/embed`;
  const embedKey = Deno.env.get("EMBED_FUNCTION_BEARER") || Deno.env.get("SUPABASE_ANON_KEY") || serviceKey;
  const resp = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${embedKey}`,
    },
    body: JSON.stringify({ input: [query.slice(0, 8000)] }),
  });
  const raw = await resp.text();
  if (!resp.ok) return null;
  try {
    const parsed = JSON.parse(raw);
    const vec = parsed?.vectors?.[0];
    if (!Array.isArray(vec)) return null;
    // Cache (fire-and-forget; ignore error).
    db.from("query_embedding_cache")
      .insert({
        session_id: session_id ?? null,
        query_hash: hash,
        embedding: vec,
      })
      .then(() => {}, () => {});
    return vec;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Req;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const query = (body.query ?? "").toString().trim();
  if (!query) return json({ error: "query is required" }, 400);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return json({ error: "Supabase not configured" }, 500);

  const db = createClient(url, serviceKey);
  const vec = await embedQuery(query, body.session_id);
  if (!vec) {
    return json({ error: "Failed to embed query" }, 502);
  }

  const limit = Math.max(1, Math.min(32, body.limit ?? 8));
  const { data, error } = await db.rpc("retrieve_knowledge", {
    p_query_embedding: vec,
    p_query_text: query,
    p_product_slug: body.product_slug ?? null,
    p_symptom_tags: body.symptom_tags ?? [],
    p_error_codes: body.error_codes ?? [],
    p_limit: limit,
  });

  if (error) {
    return json({ error: error.message }, 500);
  }

  const rows = (data as any[] | null) ?? [];
  const evidence = rows.map((r, idx) => ({
    idx: idx + 1,
    type: r.source_type as string,
    id: r.source_id as string,
    document_id: r.document_id as string | null,
    text: String(r.text ?? "").slice(0, 1800),
    heading: r.heading ?? null,
    product_slug: r.product_slug ?? null,
    subsystem: r.subsystem ?? null,
    symptom_tags: r.symptom_tags ?? [],
    error_codes: r.error_codes ?? [],
    score: Number(r.total_score ?? 0),
    scores: {
      vector: Number(r.vector_score ?? 0),
      lexical: Number(r.lexical_score ?? 0),
      tag: Number(r.tag_score ?? 0),
    },
  }));

  return json({ evidence, count: evidence.length });
});
