import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = process.env.APP_ORIGIN || "http://localhost:3107";
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next =
    url.searchParams.get("next") === "/reset-password"
      ? "/reset-password"
      : "/app";
  const client = await createClient();
  const { error } = code
    ? await client.auth.exchangeCodeForSession(code)
    : tokenHash && (type === "invite" || type === "recovery")
      ? await client.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("Missing authentication token") };
  return NextResponse.redirect(
    error ? `${origin}/login?error=expired` : `${origin}${next}`,
  );
}
