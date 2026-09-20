import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "./lib/supabase/config";

export async function middleware(request: NextRequest) {
  const { url, key } = supabaseConfig();
  let response = NextResponse.next({ request });
  const client = createServerClient(url, key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const { data: auth } = await client.auth.getUser();
  const path = request.nextUrl.pathname;
  let hasActiveProfile = false;
  if (auth.user) {
    const { data: profile } = await client
      .from("profiles")
      .select("id")
      .eq("user_id", auth.user.id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle();
    hasActiveProfile = Boolean(profile);
  }
  if (path.startsWith("/app") && (!auth.user || !hasActiveProfile)) {
    if (auth.user) await client.auth.signOut();
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = auth.user ? "?error=membership" : "?error=expired";
    return NextResponse.redirect(target);
  }
  if (path === "/login" && auth.user && hasActiveProfile) {
    const target = request.nextUrl.clone();
    target.pathname = "/app";
    target.search = "";
    return NextResponse.redirect(target);
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/app/:path*",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/auth/:path*",
  ],
};
