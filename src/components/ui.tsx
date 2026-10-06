import Link from "next/link";
import type { ReactNode, Ref } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Breadcrumbs({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav className="breadcrumbs" aria-label="Fil d’Ariane">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`}>
          {index > 0 && <span aria-hidden="true">/</span>}
          {item.href ? <Link href={item.href}>{item.label}</Link> : item.label}
        </span>
      ))}
    </nav>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`card ${className}`.trim()}>{children}</section>;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {aside}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  href,
  attention = false,
}: {
  label: string;
  value: ReactNode;
  href?: string;
  attention?: boolean;
}) {
  const className = `metric${attention ? " attention" : ""}`;
  const content = (
    <>
      <small>{label}</small>
      <strong>{value}</strong>
    </>
  );
  return href ? (
    <Link className={`${className} metric-link`} href={href}>
      {content}
    </Link>
  ) : (
    <article className={className}>{content}</article>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "archived";
}) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

const decisionLabels: Record<string, string> = {
  elite: "Elite",
  advance: "Advance",
  reserve: "Reserve",
  eliminate: "Eliminate",
};

// Selection decisions computed by PostgreSQL, with one shared visual scale.
export function DecisionBadge({ decision }: { decision: string | null }) {
  if (!decision) return <span className="status-badge">Non évalué</span>;
  return (
    <span className={`decision-badge ${decision}`}>
      {decisionLabels[decision] ?? decision}
    </span>
  );
}

const kindLabels = {
  parent: "Lignée",
  cross: "Croisement",
  family: "Famille",
  lot: "Lot",
} as const;

export function KindBadge({ kind }: { kind: keyof typeof kindLabels }) {
  return <span className={`kind-badge ${kind}`}>{kindLabels[kind]}</span>;
}

export function ActionMenu({
  label,
  children,
  wide = false,
  ref,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  ref?: Ref<HTMLDetailsElement>;
}) {
  return (
    <details className="action-menu" data-row-control ref={ref}>
      <summary aria-label={label} title={label}>
        ⋯
      </summary>
      <div className={`action-menu-panel${wide ? " wide" : ""}`}>
        {children}
      </div>
    </details>
  );
}

export function PageNotice({
  children,
  tone = "success",
}: {
  children: ReactNode;
  tone?: "success" | "error";
}) {
  return (
    <p
      className={`page-notice${tone === "error" ? " error" : ""}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

export function ProgramSwitch({
  programs,
  activeId,
  basePath,
}: {
  programs: { id: string; code: string }[];
  activeId?: string;
  basePath: string;
}) {
  if (programs.length < 2) return null;
  return (
    <div className="program-switch">
      <span>Programme</span>
      <nav className="chip-nav" aria-label="Changer de programme">
        {programs.map((program) => (
          <Link
            key={program.id}
            className={program.id === activeId ? "active" : ""}
            href={`${basePath}?program=${program.id}`}
          >
            {program.code}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        –
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
      {action && (
        <Link className="button-link" href={action.href}>
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function ErrorState({
  message,
  retryHref,
}: {
  message: string;
  retryHref?: string;
}) {
  return (
    <div className="error-state" role="alert">
      <strong>Chargement impossible</strong>
      <p>{message}</p>
      {retryHref && (
        <Link className="button-link secondary" href={retryHref}>
          Réessayer
        </Link>
      )}
    </div>
  );
}

export function DataTable({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function ProgramContext({
  team,
  program,
}: {
  team: string;
  program?: {
    id: string;
    code: string;
    name: string;
    species?: string | null;
    campaign?: string | null;
  };
}) {
  return (
    <aside className="context-bar" aria-label="Contexte actif">
      <div>
        <span>Équipe</span>
        <strong>{team}</strong>
      </div>
      <div>
        <span>Programme</span>
        <strong>
          {program ? `${program.code} · ${program.name}` : "Aucun programme"}
        </strong>
      </div>
      <div>
        <span>Espèce</span>
        <strong>{program?.species || "—"}</strong>
      </div>
      <div>
        <span>Campagne</span>
        <strong>{program?.campaign || "—"}</strong>
      </div>
    </aside>
  );
}
