import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createAdminSessionResponse, isValidAdminLogin } from "@/lib/admin-auth";

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { username, password } = parsed.data;
  if (!isValidAdminLogin(username, password)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  return createAdminSessionResponse();
}

