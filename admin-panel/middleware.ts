import { NextRequest, NextResponse } from "next/server";

import { adminSessionCookieName } from "@/lib/admin-auth";

const publicPaths = ["/login", "/api/admin/login"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Customer Flutter app is copied into public/ at build time; serve it at /
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/index.html";
    return NextResponse.rewrite(url);
  }

  const isPublic = publicPaths.some((p) => pathname === p);
  const hasSession = req.cookies.get(adminSessionCookieName)?.value === "ok";

  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (!isPublic && !hasSession) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/admin/:path*", "/api/admin/:path*", "/login"],
};

