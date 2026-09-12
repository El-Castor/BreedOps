import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const result = z
    .object({
      email: z.string().email().max(254),
      password: z.string().min(1).max(1024),
    })
    .safeParse({ email: form.get("email"), password: form.get("password") });
  if (!result.success)
    return NextResponse.redirect(
      new URL("/login?error=invalid", request.url),
      303,
    );
  const client = await createClient();
  const { error } = await client.auth.signInWithPassword(result.data);
  return NextResponse.redirect(
    new URL(error ? "/login?error=invalid" : "/app", request.url),
    303,
  );
}
