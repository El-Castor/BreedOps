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

// The deployment-level reverse proxy (see docs/DEPLOYMENT_GUIDE.md) is
// expected to set X-Forwarded-For; without one in front (e.g. local dev),
// every request buckets under the same "direct" key for the IP scope,
// leaving only the per-email scope meaningfully effective - documented
// trade-off, not a bug.
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "direct";
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

  const admin = createAdminClient();
  const emailKey = result.data.email.trim().toLowerCase();
  const ipKey = clientIp(request);
  const [emailLock, ipLock] = await Promise.all([
    admin.rpc("auth_rate_limit_check", {
      p_scope: "login_email",
      p_key: emailKey,
    }),
    admin.rpc("auth_rate_limit_check", { p_scope: "login_ip", p_key: ipKey }),
  ]);
  if ((emailLock.data ?? 0) > 0 || (ipLock.data ?? 0) > 0) {
    return loginRedirect("locked");
  }

  const client = await createClient();
  const { data, error } = await client.auth.signInWithPassword(result.data);
  await Promise.all([
    admin.rpc("auth_rate_limit_record", {
      p_scope: "login_email",
      p_key: emailKey,
      p_success: !error,
    }),
    admin.rpc("auth_rate_limit_record", {
      p_scope: "login_ip",
      p_key: ipKey,
      p_success: !error,
    }),
  ]);
  if (error)
    return loginRedirect(
      error.code === "email_not_confirmed" ? "unconfirmed" : "invalid",
    );
  try {
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
