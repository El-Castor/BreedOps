import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/request-security";
import { createAdminClient } from "@/lib/supabase/admin";

function loginRedirect(error?: string) {
  const origin = process.env.APP_ORIGIN || "http://localhost:3107";
  return NextResponse.redirect(
    `${origin}/login${error ? `?error=${error}` : ""}`,
    303,
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return loginRedirect("unexpected");
  const form = await request.formData();
  const result = z
    .object({
      email: z.string().email().max(254),
      password: z.string().min(1).max(1024),
    })
    .safeParse({ email: form.get("email"), password: form.get("password") });
  if (!result.success) return loginRedirect("invalid");
  const client = await createClient();
  const { data, error } = await client.auth.signInWithPassword(result.data);
  if (error)
    return loginRedirect(
      error.code === "email_not_confirmed" ? "unconfirmed" : "invalid",
    );
  try {
    const admin = createAdminClient();
    const profile = await admin
      .from("profiles")
      .select("is_active,deleted_at,organization_id")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (profile.error) throw profile.error;
    if (
      !profile.data ||
      profile.data.deleted_at ||
      !profile.data.organization_id
    ) {
      await client.auth.signOut();
      return loginRedirect("membership");
    }
    if (!profile.data.is_active) {
      await client.auth.signOut();
      return loginRedirect("disabled");
    }
  } catch {
    await client.auth.signOut();
    return loginRedirect("configuration");
  }
  return NextResponse.redirect(
    `${process.env.APP_ORIGIN || "http://localhost:3107"}/app`,
    303,
  );
}
