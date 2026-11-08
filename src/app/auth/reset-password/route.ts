import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/request-security";
export async function POST(request: Request) {
  const origin = process.env.APP_ORIGIN || "http://localhost:3107";
  if (!sameOrigin(request))
    return NextResponse.redirect(`${origin}/reset-password?error=expired`, 303);
  const form = await request.formData();
  const parsed = z
    .object({ password: z.string().min(8).max(1024), confirmation: z.string() })
    .safeParse({
      password: form.get("password"),
      confirmation: form.get("confirmation"),
    });
  if (!parsed.success || parsed.data.password !== parsed.data.confirmation)
    return NextResponse.redirect(
      `${origin}/reset-password?error=mismatch`,
      303,
    );
  const client = await createClient();
  const user = await client.auth.getUser();
  if (!user.data.user || user.error)
    return NextResponse.redirect(`${origin}/reset-password?error=expired`, 303);
  const result = await client.auth.updateUser({
    password: parsed.data.password,
  });
  if (result.error)
    return NextResponse.redirect(`${origin}/reset-password?error=expired`, 303);
  await client.auth.signOut();
  return NextResponse.redirect(`${origin}/reset-password?success=1`, 303);
}
