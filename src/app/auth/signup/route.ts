import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { sameOrigin } from "@/lib/request-security";
export async function POST(request: Request) {
  const origin = process.env.APP_ORIGIN || "http://localhost:3107";
  if (process.env.ALLOW_SELF_SIGNUP !== "true" || !sameOrigin(request))
    return NextResponse.redirect(`${origin}/login`, 303);
  const form = await request.formData();
  const parsed = z
    .object({
      email: z.string().email().max(254),
      displayName: z.string().trim().min(1).max(120),
    })
    .safeParse({
      email: form.get("email"),
      displayName: form.get("display_name"),
    });
  if (parsed.success) {
    const admin = createAdminClient();
    await admin.auth.admin.inviteUserByEmail(parsed.data.email.toLowerCase(), {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
      data: { display_name: parsed.data.displayName, pending_assignment: true },
    });
  }
  return NextResponse.redirect(`${origin}/signup?sent=1`, 303);
}
