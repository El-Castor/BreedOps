import { NextResponse } from "next/server";

// Minimal V1 operational baseline (see docs/ADMIN_GUIDE.md "Supervision").
// Deliberately unauthenticated - a reverse proxy or process supervisor
// needs to reach this without credentials - and deliberately reports only
// "ok"/"degraded" plus which required piece of configuration is missing,
// never a connection string, a port, an internal hostname, or any
// response from an actual database/Storage call. A live upstream call
// from a public, unauthenticated endpoint would itself be a minor
// information-disclosure and probing surface, so this only confirms the
// Next.js process is alive and its required environment is present -
// exactly what a startup/liveness check needs, nothing more.
export async function GET() {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "APP_ORIGIN",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    return NextResponse.json(
      { status: "degraded", reason: "configuration" },
      { status: 503 },
    );
  }
  return NextResponse.json({ status: "ok" });
}
