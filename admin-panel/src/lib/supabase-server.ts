import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseAdminInit =
  | { ok: true; client: SupabaseClient }
  | { ok: false; error: string };

/** Does not throw — use so API routes always return JSON instead of an empty 500 body. */
export function getSupabaseAdminClientSafe(): SupabaseAdminInit {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    return {
      ok: false,
      error:
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add both in Vercel → Settings → Environment Variables (Production).",
    };
  }
  return {
    ok: true,
    client: createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

/** @throws if env is missing — prefer getSupabaseAdminClientSafe in route handlers. */
export function getSupabaseAdminClient(): SupabaseClient {
  const r = getSupabaseAdminClientSafe();
  if (!r.ok) throw new Error(r.error);
  return r.client;
}

