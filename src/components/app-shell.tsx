"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

type Identity = {
  displayName: string;
  email: string;
  role: "system_admin" | "team_admin" | "user";
  teamName: string;
};

const items = [
  ["/app", "Vue d’ensemble", "⌂"],
  ["/app/breeding", "Programme", "⌘"],
  ["/app/pedigree", "Pedigree", "⌁"],
  ["/app/phenotypes", "Phénotypes", "◇"],
  ["/app/inventory", "Inventaire", "□"],
  ["/app/operations", "Opérations", "◷"],
] as const;

export function AppShell({
  identity,
  children,
}: {
  identity: Identity;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const programValue = params.get("program");
  const program =
    programValue && programValue !== "undefined" ? programValue : null;
  const href = (path: string) =>
    program && path !== "/app/profile" && path !== "/app/admin/users"
      ? `${path}?program=${program}`
      : path;
  const initials =
    identity.displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "BO";
  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          className="mobile-menu"
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="main-navigation"
        >
          <span className="sr-only">Ouvrir la navigation</span>☰
        </button>
        <Link
          href={href("/app")}
          className="brand"
          aria-label="Accueil BreedOps"
        >
          <span className="brand-mark">B</span>
          <span>
            <strong>BreedOps</strong>
            <small>{identity.teamName}</small>
          </span>
        </Link>
        <div className="header-spacer" />
        <span
          className="future-slot"
          aria-label="Notifications prévues ultérieurement"
        >
          Notifications · bientôt
        </span>
        <details className="user-menu">
          <summary aria-label="Menu utilisateur">
            <span className="avatar">{initials}</span>
            <span className="user-menu-label">
              <strong>{identity.displayName}</strong>
              <small>{identity.role}</small>
            </span>
          </summary>
          <div className="user-popover">
            <strong>{identity.displayName}</strong>
            <span>{identity.email}</span>
            <span>
              {identity.teamName} · {identity.role}
            </span>
            <hr />
            <Link href="/app/profile">Mon profil</Link>
            {identity.role !== "user" && (
              <Link href="/app/admin/users">Administration utilisateurs</Link>
            )}
            <form action="/auth/logout" method="post">
              <button className="menu-action">Déconnexion</button>
            </form>
          </div>
        </details>
      </header>
      <aside id="main-navigation" className={`sidebar ${open ? "open" : ""}`}>
        <nav aria-label="Navigation principale">
          {items.map(([path, label, icon]) => (
            <Link
              key={path}
              href={href(path)}
              className={pathname === path ? "active" : ""}
              onClick={() => setOpen(false)}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </Link>
          ))}
          {identity.role !== "user" && (
            <Link
              href="/app/admin/users"
              className={pathname.startsWith("/app/admin") ? "active" : ""}
              onClick={() => setOpen(false)}
            >
              <span aria-hidden="true">♙</span>Utilisateurs
            </Link>
          )}
        </nav>
        <p className="sidebar-caption">
          Traçabilité scientifique
          <br />
          et opérations d’élevage
        </p>
      </aside>
      <main className="app-content">{children}</main>
    </div>
  );
}
