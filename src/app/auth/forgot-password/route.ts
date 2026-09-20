import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/request-security";
export async function POST(request: Request) {
  const origin = process.env.APP_ORIGIN || "http://localhost:3107";
  if (!sameOrigin(request))
    return NextResponse.redirect(`${origin}/forgot-password?sent=1`, 303);
  const form = await request.formData();
  const parsed = z.string().email().max(254).safeParse(form.get("email"));
  if (parsed.success) {
    const client = await createClient();
    await client.auth.resetPasswordForEmail(parsed.data.toLowerCase(), {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });
  }
  return NextResponse.redirect(`${origin}/forgot-password?sent=1`, 303);
}
