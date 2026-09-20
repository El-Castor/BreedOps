import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  const origin = process.env.APP_ORIGIN || "http://localhost:3107";
  if (!sameOrigin(request))
    return NextResponse.redirect(`${origin}/login?error=unexpected`, 303);
  const client = await createClient();
  const { error } = await client.auth.signOut();
  if (error)
    return NextResponse.redirect(`${origin}/login?error=unexpected`, 303);
  return NextResponse.redirect(`${origin}/login`, 303);
}
