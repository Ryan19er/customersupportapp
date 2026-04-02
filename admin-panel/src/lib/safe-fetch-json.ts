/** Parse fetch Response body as JSON; never throws (safe for empty/HTML error pages). */
export async function readJsonBody<T = unknown>(res: Response): Promise<{
  parsed: boolean;
  data: T | null;
  parseError: string | null;
}> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return {
      parsed: false,
      data: null,
      parseError: `Could not read response body (HTTP ${res.status})`,
    };
  }
  if (!text.trim()) {
    return {
      parsed: false,
      data: null,
      parseError: `Empty body (HTTP ${res.status}). Check Vercel env SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and redeploy.`,
    };
  }
  try {
    return { parsed: true, data: JSON.parse(text) as T, parseError: null };
  } catch {
    const preview = text.slice(0, 120).replace(/\s+/g, " ");
    return {
      parsed: false,
      data: null,
      parseError: `Not JSON (HTTP ${res.status}): ${preview}${text.length > 120 ? "…" : ""}`,
    };
  }
}
