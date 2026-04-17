// Supabase-native embeddings using the built-in gte-small model.
// Runs inside the edge runtime — zero external API calls, no API key required.
// Returns 384-dim vectors. Used by ingestion, retrieve, and the admin panel.

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "gte-small";
// Keep the embed batch small enough to fit Supabase Edge Function compute limits.
// gte-small loads a few MB of weights + per-text inference work; large batches
// trigger WORKER_RESOURCE_LIMIT. 8 is a safe max for the free/default tier.
const MAX_BATCH = 8;
// Truncate individual inputs to keep memory predictable.
const MAX_CHARS_PER_INPUT = 4000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

type Req = {
  input?: string | string[];
  model?: string; // accepted for backward compat, ignored — always gte-small
};

// `Supabase.ai` is injected by the edge runtime. Construct the session once at
// module scope so the model weights stay warm across invocations.
// deno-lint-ignore no-explicit-any
const SupabaseGlobal: any = (globalThis as any).Supabase;
// deno-lint-ignore no-explicit-any
let session: any = null;
function getSession(): any {
  if (session) return session;
  if (!SupabaseGlobal?.ai?.Session) return null;
  session = new SupabaseGlobal.ai.Session(MODEL);
  return session;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const sess = getSession();
  if (!sess) {
    return json(
      {
        error:
          "Supabase.ai is not available in this runtime. Make sure the function is deployed to Supabase Edge Runtime (it does not work in vanilla Deno).",
      },
      500,
    );
  }

  let body: Req;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const inputs = Array.isArray(body.input)
    ? body.input
    : typeof body.input === "string"
    ? [body.input]
    : [];
  if (!inputs.length) return json({ error: "input required" }, 400);
  if (inputs.length > MAX_BATCH) {
    return json(
      { error: `Batch exceeds ${MAX_BATCH}. Send smaller batches.`, max_batch: MAX_BATCH },
      400,
    );
  }
  const cleaned = inputs.map((s) => String(s ?? "").slice(0, MAX_CHARS_PER_INPUT));

  const vectors: number[][] = [];
  for (const text of cleaned) {
    try {
      const out = await sess.run(text, { mean_pool: true, normalize: true });
      if (!Array.isArray(out)) {
        return json({ error: "Embedding model returned unexpected shape" }, 502);
      }
      vectors.push(out as number[]);
    } catch (e) {
      return json({ error: `Embedding failed: ${(e as Error).message}` }, 500);
    }
  }

  return json({ model: MODEL, dim: vectors[0]?.length ?? 0, vectors });
});
