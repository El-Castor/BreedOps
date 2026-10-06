import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireIdentity } from "@/lib/auth";

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user, profile, team } = await requireIdentity();
  return (
    <AppShell
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
