"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function ReviewRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const status = searchParams.get("status") ?? "pending";
    const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    const next = `/admin?workspace=conversations&review_status=${encodeURIComponent(status)}${
      hash ? `&review_id=${encodeURIComponent(hash)}` : ""
    }`;
    router.replace(next);
  }, [router, searchParams]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <p className="text-sm text-slate-400">
        Redirecting to Customer chats and notes correction workspace...
      </p>
    </main>
  );
}
