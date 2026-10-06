import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireIdentity } from "@/lib/auth";

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { client, user, profile, team } = await requireIdentity();
  // RLS scopes this to the caller's team, except a system_admin, who sees
  // every team's programs here too — organization_id lets the shell label
  // which team each one belongs to instead of listing bare technical codes.
  const { data: programs } = await client
    .from("programs")
    .select("id,organization_id,code,name")
    .is("deleted_at", null)
    .order("code");
  const otherTeamIds = [
    ...new Set(
      (programs ?? [])
        .map((item) => item.organization_id)
        .filter((id) => id !== team.id),
    ),
  ];
  const { data: otherTeams } = otherTeamIds.length
    ? await client
        .from("organizations")
        .select("id,name")
        .in("id", otherTeamIds)
    : { data: [] };
  const teamNameById = new Map([
    [team.id, team.name],
    ...(otherTeams ?? []).map((item) => [item.id, item.name] as const),
  ]);
  return (
    <AppShell
      programs={(programs ?? []).map((item) => ({
        ...item,
        teamName: teamNameById.get(item.organization_id) ?? "—",
      }))}
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
