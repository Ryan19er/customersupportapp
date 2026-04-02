import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const SESSION_COOKIE = "stealth_admin_session";

export function adminUsername(): string {
  return process.env.ADMIN_USERNAME ?? "admin";
}

export function adminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? "stealth";
}

export function isValidAdminLogin(username: string, password: string): boolean {
  return username === adminUsername() && password === adminPassword();
}

export function createAdminSessionResponse() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "ok", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}

export function clearAdminSessionResponse() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}

export async function hasAdminSession(): Promise<boolean> {
  const c = await cookies();
  return c.get(SESSION_COOKIE)?.value === "ok";
}

export const adminSessionCookieName = SESSION_COOKIE;

