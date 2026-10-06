import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireIdentity } from "@/lib/auth";

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { client, user, profile, team } = await requireIdentity();
  // RLS limits programs to the caller's team; the header shows the active one.
  const { data: programs } = await client
    .from("programs")
    .select("id,code,name")
    .is("deleted_at", null)
    .order("code");
  return (
    <AppShell
      programs={programs ?? []}
      identity={{
        displayName:
          profile.display_name || user.email || "Utilisateur BreedOps",
        email: user.email || "",
        role: profile.role,
        teamName: team.name,
      }}
    >
      {children}
    </AppShell>
  );
}
