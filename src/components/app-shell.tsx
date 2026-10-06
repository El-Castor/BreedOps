"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

type Role = "system_admin" | "team_admin" | "user";

type Identity = {
  displayName: string;
  email: string;
  role: Role;
  teamName: string;
};

type Program = { id: string; code: string; name: string };

const roleLabels: Record<Role, string> = {
  system_admin: "Administrateur système",
  team_admin: "Administrateur d’équipe",
  user: "Membre",
};

const groups: { label: string; items: [string, string, IconName][] }[] = [
  { label: "Pilotage", items: [["/app", "Vue d’ensemble", "overview"]] },
  {
    label: "Sélection",
    items: [
      ["/app/breeding", "Programme", "program"],
      ["/app/pedigree", "Pedigree", "pedigree"],
      ["/app/phenotypes", "Phénotypes", "phenotype"],
    ],
  },
  {
    label: "Laboratoire",
    items: [
      ["/app/inventory", "Inventaire", "inventory"],
      ["/app/operations", "Opérations", "operations"],
    ],
  },
];

const programScoped = new Set([
  "/app",
  "/app/breeding",
  "/app/pedigree",
  "/app/phenotypes",
  "/app/operations",
]);

export function AppShell({
  identity,
  programs,
  children,
}: {
  identity: Identity;
  programs: Program[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const programValue = params.get("program");
  const program =
    programValue && programValue !== "undefined" ? programValue : null;
  // Pages fall back to the first program; the header mirrors that choice.
  const activeProgram = programScoped.has(pathname)
    ? programs.find((item) => item.id === program) ?? programs[0]
    : undefined;
  const href = (path: string) =>
    program && programScoped.has(path) ? `${path}?program=${program}` : path;
  const initials =
    identity.displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "BO";
  const isAdmin = identity.role !== "user";
  return (
    <div className="app-shell">
      <aside id="main-navigation" className={`sidebar ${open ? "open" : ""}`}>
        <Link
          href={href("/app")}
          className="brand"
          aria-label="Accueil BreedOps"
        >
          <span className="brand-mark">
            <Icon name="leaf" />
          </span>
          <span>
            <strong>BreedOps</strong>
            <small>{identity.teamName}</small>
          </span>
        </Link>
        <nav aria-label="Navigation principale">
          {groups.map((group) => (
            <div key={group.label} style={{ display: "contents" }}>
              <p className="nav-group-label">{group.label}</p>
              {group.items.map(([path, label, icon]) => (
                <Link
                  key={path}
                  href={href(path)}
                  className={pathname === path ? "active" : ""}
                  aria-current={pathname === path ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <Icon name={icon} />
                  {label}
                </Link>
              ))}
            </div>
          ))}
          {isAdmin && (
            <>
              <p className="nav-group-label">Administration</p>
              <Link
                href="/app/admin/users"
                className={pathname.startsWith("/app/admin") ? "active" : ""}
                aria-current={
                  pathname.startsWith("/app/admin") ? "page" : undefined
                }
                onClick={() => setOpen(false)}
              >
                <Icon name="users" />
                Utilisateurs
              </Link>
            </>
          )}
        </nav>
        <p className="sidebar-caption">
          Traçabilité scientifique et opérations d’élevage
        </p>
      </aside>
      <div className="app-main">
        <header className="app-header">
          <button
            className="mobile-menu"
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="main-navigation"
          >
            <span className="sr-only">Ouvrir la navigation</span>
            <Icon name="menu" width={18} height={18} />
          </button>
          <div className="header-context">
            {activeProgram ? (
              <Link
                className="program-chip"
                href={`/app/breeding?program=${activeProgram.id}`}
                title="Programme actif"
              >
                <span className="code">{activeProgram.code}</span>
                <span className="name">{activeProgram.name}</span>
              </Link>
            ) : (
              <strong>{identity.teamName}</strong>
            )}
          </div>
          <div className="header-spacer" />
          <span
            className="future-slot"
            aria-label="Notifications prévues ultérieurement"
          >
            <Icon name="bell" />
            <span>Bientôt</span>
          </span>
          <details className="user-menu">
            <summary aria-label="Menu utilisateur">
              <span className="avatar">{initials}</span>
              <span className="user-menu-label">
                <strong>{identity.displayName}</strong>
                <small>{roleLabels[identity.role]}</small>
              </span>
            </summary>
            <div className="user-popover">
              <div className="identity">
                <strong>{identity.displayName}</strong>
                <span>{identity.email}</span>
                <span>
                  {roleLabels[identity.role]} · {identity.teamName}
                </span>
              </div>
              <hr />
              <Link href="/app/profile">Mon profil</Link>
              {isAdmin && <Link href="/app/admin/users">Administration</Link>}
              <form action="/auth/logout" method="post">
                <button className="menu-action">Déconnexion</button>
              </form>
            </div>
          </details>
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
