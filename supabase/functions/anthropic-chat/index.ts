const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type IncomingMessage = {
  role: "user" | "assistant";
  content: Array<{ type: "text"; text: string }>;
};

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-6";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();
  if (!apiKey) {
    return json(
      {
        error:
          "Missing ANTHROPIC_API_KEY secret on Supabase Edge Functions.",
      },
      500,
    );
  }

  let payload: {
    model?: string;
    max_tokens?: number;
    system?: string;
    messages?: IncomingMessage[];
  };

  try {
    payload = await req.json();
  } catch (_) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!messages.length) {
    return json({ error: "messages is required" }, 400);
  }

  const body = {
    model: payload.model || DEFAULT_MODEL,
    max_tokens: typeof payload.max_tokens === "number" ? payload.max_tokens : 4096,
    system: payload.system || "",
    messages,
  };

  const upstream = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  const raw = await upstream.text();
  let parsed: any = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch (_) {
    parsed = null;
  }

  if (!upstream.ok) {
    const detail = parsed?.error?.message || parsed?.message || raw ||
      `Anthropic HTTP ${upstream.status}`;
    return json({ error: detail, status: upstream.status }, upstream.status);
  }

  const text = parsed?.content?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) {
    return json(
      {
        error: "Anthropic response missing text content",
        raw: parsed ?? raw,
      },
      502,
    );
  }

  return json({ text, model: body.model });
});

