import Link from "next/link";
import type { ReactNode } from "react";

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

export function MetricCard({
  label,
  value,
  href,
}: {
  label: string;
  value: ReactNode;
  href?: string;
}) {
  const content = (
    <>
      <small>{label}</small>
      <strong>{value}</strong>
    </>
  );
  return href ? (
    <Link className="metric metric-link" href={href}>
      {content}
    </Link>
  ) : (
    <article className="metric">{content}</article>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
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
        ○
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
