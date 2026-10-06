"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";

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

const collapseKey = "breedops-sidebar";

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
  const [collapsed, setCollapsed] = useState(false);
  const [programMenu, setProgramMenu] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(collapseKey) === "collapsed");
    } catch {
      // Preference storage is optional.
    }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((value) => {
      try {
        localStorage.setItem(collapseKey, value ? "expanded" : "collapsed");
      } catch {
        // Preference storage is optional.
      }
      return !value;
    });
  };
  const programValue = params.get("program");
  const program =
    programValue && programValue !== "undefined" ? programValue : null;
  // Pages fall back to the first program; the header mirrors that choice.
  const scoped = programScoped.has(pathname);
  const activeProgram = scoped
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
  const navLink = (path: string, label: string, icon: IconName) => {
    const active =
      path === "/app/admin/users"
        ? pathname.startsWith("/app/admin")
        : pathname === path;
    return (
      <Link
        key={path}
        href={href(path)}
        className={active ? "active" : ""}
        aria-current={active ? "page" : undefined}
        title={label}
        onClick={() => setOpen(false)}
      >
        <Icon name={icon} size={18} />
        <span className="nav-label">{label}</span>
      </Link>
    );
  };
  return (
    <div className={`app-shell${collapsed ? " collapsed" : ""}`}>
      <aside id="main-navigation" className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-top">
          <Link
            href={href("/app")}
            className="brand"
            aria-label="Accueil BreedOps"
          >
            <span className="brand-mark">
              <Icon name="leaf" size={18} />
            </span>
            <span className="brand-text">
              <strong>BreedOps</strong>
              <small>{identity.teamName}</small>
            </span>
          </Link>
        </div>
        <nav aria-label="Navigation principale">
          {groups.map((group) => (
            <div key={group.label} className="nav-group">
              <p className="nav-group-label">{group.label}</p>
              {group.items.map(([path, label, icon]) =>
                navLink(path, label, icon),
              )}
            </div>
          ))}
          {isAdmin && (
            <div className="nav-group">
              <p className="nav-group-label">Administration</p>
              {navLink("/app/admin/users", "Utilisateurs", "users")}
            </div>
          )}
        </nav>
        <button
          type="button"
          className="sidebar-collapse"
          onClick={toggleCollapsed}
          aria-label={
            collapsed ? "Déplier la navigation" : "Replier la navigation"
          }
          title={collapsed ? "Déplier" : "Replier"}
        >
          <Icon name={collapsed ? "uncollapse" : "collapse"} size={18} />
          <span className="nav-label">Replier</span>
        </button>
      </aside>
      <div className="app-main">
        <header className="app-header">
          <button
            className="mobile-menu icon-button"
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="main-navigation"
          >
            <span className="sr-only">Ouvrir la navigation</span>
            <Icon name="menu" size={18} />
          </button>
          {activeProgram ? (
            <div className="program-selector">
              <button
                type="button"
                className="program-selector-trigger"
                aria-expanded={programMenu}
                aria-haspopup="true"
                onClick={() => setProgramMenu((value) => !value)}
                title="Programme actif"
              >
                <Icon name="program" />
                <span className="code">{activeProgram.code}</span>
                <span className="name">{activeProgram.name}</span>
                <Icon name="expand" size={14} />
              </button>
              {programMenu && (
                <div className="program-selector-menu">
                  <p className="menu-label">Programmes de l’équipe</p>
                  {programs.map((item) => (
                    // Document navigation: query-only client navigation is
                    // unreliable on some pages (agend TD-003).
                    <a
                      key={item.id}
                      href={`${pathname}?program=${item.id}`}
                      className={item.id === activeProgram.id ? "active" : ""}
                    >
                      <span className="code">{item.code}</span>
                      <span>{item.name}</span>
                      {item.id === activeProgram.id && (
                        <Icon name="check" size={14} />
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="header-team">{identity.teamName}</span>
          )}
          <div className="header-spacer" />
          <span
            className="icon-button future-slot"
            aria-label="Notifications prévues ultérieurement"
            title="Notifications · bientôt"
          >
            <Icon name="bell" />
          </span>
          <ThemeToggle />
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
                <span className="avatar large">{initials}</span>
                <div>
                  <strong>{identity.displayName}</strong>
                  <span>{identity.email}</span>
                  <span>
                    {roleLabels[identity.role]} · {identity.teamName}
                  </span>
                </div>
              </div>
              <hr />
              <Link href="/app/profile">
                <Icon name="profile" />
                Mon profil
              </Link>
              {isAdmin && (
                <Link href="/app/admin/users">
                  <Icon name="settings" />
                  Administration
                </Link>
              )}
              <form action="/auth/logout" method="post">
                <button className="menu-action">
                  <Icon name="logout" />
                  Déconnexion
                </button>
              </form>
            </div>
          </details>
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
