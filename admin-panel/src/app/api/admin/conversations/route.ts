import { NextResponse } from "next/server";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

/** Unified row for contact (anon) + signed-in auth threads — matches Flutter `ChatRepository` storage. */
type UnifiedSession = {
  id: string;
  channel: "support" | "auth";
  contact_id: string | null;
  user_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
  chat_contacts: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    company_name: string | null;
  };
};

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const init = getSupabaseAdminClientSafe();
    if (!init.ok) {
      return NextResponse.json(
        { error: init.error, sessions: [], partial: false, warnings: [] },
        { status: 503 },
      );
    }
    const supabase = init.client;

    const [supportRes, authSessionsRes] = await Promise.all([
    supabase
      .from("support_chat_sessions")
      .select("id, contact_id, created_at, updated_at, chat_contacts(full_name, email, phone)")
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase
      .from("chat_sessions")
      .select("id, user_id, title, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(300),
  ]);

  const supportError = supportRes.error?.message;
  const authError = authSessionsRes.error?.message;

  const supportRows = supportRes.data ?? [];
  const authRows = authSessionsRes.data ?? [];

  const userIds = [...new Set(authRows.map((r) => r.user_id as string))];
  let profileByUserId = new Map<
    string,
    { full_name: string | null; contact_email: string | null; phone: string | null; company_name: string | null }
  >();

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, contact_email, phone, company_name")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      profileByUserId.set(p.id as string, {
        full_name: (p.full_name as string | null) ?? null,
        contact_email: (p.contact_email as string | null) ?? null,
        phone: (p.phone as string | null) ?? null,
        company_name: (p.company_name as string | null) ?? null,
      });
    }
  }

  const supportSessions: UnifiedSession[] = supportRows.map((s) => {
    const c = s.chat_contacts as
      | { full_name?: string | null; email?: string | null; phone?: string | null }
      | null
      | undefined;
    return {
      id: s.id as string,
      channel: "support",
      contact_id: s.contact_id as string,
      user_id: null,
      title: null,
      created_at: s.created_at as string,
      updated_at: s.updated_at as string,
      chat_contacts: {
        full_name: c?.full_name ?? null,
        email: c?.email ?? null,
        phone: c?.phone ?? null,
        company_name: null,
      },
    };
  });

  const authSessions: UnifiedSession[] = authRows.map((s) => {
    const uid = s.user_id as string;
    const prof = profileByUserId.get(uid);
    return {
      id: s.id as string,
      channel: "auth",
      contact_id: null,
      user_id: uid,
      title: (s.title as string | null) ?? null,
      created_at: s.created_at as string,
      updated_at: s.updated_at as string,
      chat_contacts: {
        full_name: prof?.full_name ?? null,
        email: prof?.contact_email ?? null,
        phone: prof?.phone ?? null,
        company_name: prof?.company_name ?? null,
      },
    };
  });

  const sessions = [...supportSessions, ...authSessions].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  if (supportError && authError) {
    return NextResponse.json(
      { error: `support: ${supportError}; auth: ${authError}`, sessions: [] },
      { status: 500 },
    );
  }

    return NextResponse.json({
      sessions,
      partial: Boolean(supportError || authError),
      warnings: [supportError && `support_chat_sessions: ${supportError}`, authError && `chat_sessions: ${authError}`].filter(
        Boolean,
      ) as string[],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown server error";
    return NextResponse.json(
      { error: message, sessions: [], partial: false, warnings: [] },
      { status: 500 },
    );
  }
}

