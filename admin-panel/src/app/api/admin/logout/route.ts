import { clearAdminSessionResponse } from "@/lib/admin-auth";

export async function POST() {
  return clearAdminSessionResponse();
}

