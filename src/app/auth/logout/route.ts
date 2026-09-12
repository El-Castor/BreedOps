import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const client = await createClient();
  const { error } = await client.auth.signOut();
  if (error)
    return new Response("Déconnexion impossible. Réessayez.", { status: 503 });
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
