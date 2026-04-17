// Thin server-side client for the `embed` Supabase edge function.
// Returns null when embedding is unavailable so callers can still persist
// rows (lexical + tag retrieval still work without vectors).

const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || "";
const BEARER =
  process.env.SUPABASE_ANON_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
  "";

function embedUrl(): string | null {
  if (!SUPABASE_URL) return null;
  return `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/embed`;
}

export async function embedSingle(text: string): Promise<number[] | null> {
  const url = embedUrl();
  if (!url || !BEARER) return null;
  const body = { input: [String(text ?? "").slice(0, 8000)] };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${BEARER}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { vectors?: number[][]; error?: string };
    return Array.isArray(data.vectors?.[0]) ? (data.vectors![0] as number[]) : null;
  } catch {
    return null;
  }
}

export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const url = embedUrl();
  if (!url || !BEARER) return texts.map(() => null);
  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += 64) chunks.push(texts.slice(i, i + 64));
  const out: (number[] | null)[] = [];
  for (const batch of chunks) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${BEARER}`,
        },
        body: JSON.stringify({ input: batch.map((t) => String(t ?? "").slice(0, 8000)) }),
      });
      if (!resp.ok) {
        out.push(...batch.map(() => null));
        continue;
      }
      const data = (await resp.json()) as { vectors?: number[][] };
      if (Array.isArray(data.vectors) && data.vectors.length === batch.length) {
        out.push(...data.vectors);
      } else {
        out.push(...batch.map(() => null));
      }
    } catch {
      out.push(...batch.map(() => null));
    }
  }
  return out;
}
