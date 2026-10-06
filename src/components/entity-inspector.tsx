"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActionForm } from "@/components/action-form";
import { setBreedingEntityArchived } from "@/app/app/breeding-actions";

export type BreedingEntityKind = "parent" | "cross" | "family" | "lot";

export type BreedingEntityDetail = {
  id: string;
  kind: BreedingEntityKind;
  code: string;
  title: string;
  status: string;
  archived: boolean;
  lifecycleEntity: "parent_lines" | "crosses" | "families" | "seed_lots";
  pedigreeHref: string;
  sections: { title: string; fields: { label: string; value: string }[] }[];
  phenotypeSummary: {
    code: string;
    decision: string | null;
    weightedScore: string | null;
    normalizedScore: string | null;
    evaluationDate: string | null;
  }[];
};

type InspectorContextValue = {
  open: (entity: BreedingEntityDetail) => void;
};

const InspectorContext = createContext<InspectorContextValue | null>(null);

export function EntityInspectorWorkspace({
  children,
}: {
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<BreedingEntityDetail | null>(null);
  const context = useMemo(() => ({ open: setSelected }), []);
  const close = useCallback(() => setSelected(null), []);
  return (
    <InspectorContext.Provider value={context}>
      {children}
      <EntityInspector entity={selected} onClose={close} />
    </InspectorContext.Provider>
  );
}

export function useEntityInspector() {
  const context = useContext(InspectorContext);
  if (!context)
    throw new Error("Entity inspector controls require a workspace provider");
  return context;
}

function isNestedControl(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "a,button,input,select,textarea,label,form,details,summary,[data-row-control]",
      ),
    )
  );
}

// The row renders its own actions cell so each entity crosses the server/client
// boundary once; React 19.0 cannot resolve deduplicated prop references during
// client navigation, which silently aborted same-page links.
export function EntityTableRow({
  entity,
  children,
}: {
  entity: BreedingEntityDetail;
  children: ReactNode;
}) {
  const { open } = useEntityInspector();
  const activate = (event: MouseEvent<HTMLTableRowElement>) => {
    if (!isNestedControl(event.target)) open(entity);
  };
  const keyActivate = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (
      !isNestedControl(event.target) &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      open(entity);
    }
  };
  return (
    <tr
      className={`entity-row${entity.archived ? " archived" : ""}`}
      onClick={activate}
      onKeyDown={keyActivate}
      tabIndex={0}
      aria-label={`Voir le détail de ${entity.code}`}
    >
      {children}
      <td>
        <EntityActions entity={entity} />
      </td>
    </tr>
  );
}

function EntityActions({ entity }: { entity: BreedingEntityDetail }) {
  const { open } = useEntityInspector();
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <details className="entity-actions" data-row-control ref={menu}>
      <summary aria-label={`Actions pour ${entity.code}`}>⋯</summary>
      <div className="entity-actions-menu">
        <button
          type="button"
          className="quiet"
          onClick={() => {
            menu.current?.removeAttribute("open");
            open(entity);
          }}
        >
          Voir le détail
        </button>
        <Link href={entity.pedigreeHref}>Voir le pedigree</Link>
        <LifecycleForm entity={entity} />
      </div>
    </details>
  );
}

function LifecycleForm({ entity }: { entity: BreedingEntityDetail }) {
  return (
    <ActionForm
      action={setBreedingEntityArchived}
      actionName={`lifecycle-${entity.kind}-${entity.id}`}
      className="entity-lifecycle-form"
      submitLabel={entity.archived ? "Restaurer" : "Archiver"}
    >
      <input type="hidden" name="entity" value={entity.lifecycleEntity} />
      <input type="hidden" name="id" value={entity.id} />
      <input
        type="hidden"
        name="operation"
        value={entity.archived ? "restore" : "archive"}
      />
    </ActionForm>
  );
}

export function EntityInspector({
  entity,
  onClose,
}: {
  entity: BreedingEntityDetail | null;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const isOpen = Boolean(entity);

  // Focus moves into the panel when it opens and returns to the element that
  // opened it (row, menu entry or pedigree node) when it closes.
  useEffect(() => {
    if (!isOpen) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButton.current?.focus();
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      opener?.focus();
    };
  }, [isOpen, onClose]);

  if (!entity) return null;
  // Portaled to <body> so the sheet is never trapped beneath the app header's
  // stacking context.
  return createPortal(
    <div className="inspector-layer">
      <button
        type="button"
        className="inspector-backdrop"
        aria-label="Fermer le détail"
        tabIndex={-1}
        onClick={onClose}
      />
      <aside
        className="entity-inspector"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entity-inspector-title"
        data-entity-kind={entity.kind}
      >
        <EntityInspectorHeader
          entity={entity}
          onClose={onClose}
          closeButton={closeButton}
        />
        <div className="inspector-body">
          {entity.sections.map((item) => (
            <EntityFieldSection key={item.title} {...item} />
          ))}
          <EntityPhenotypeSection summary={entity.phenotypeSummary} />
          <EntityMediaSection />
        </div>
        <footer>
          <Link className="button-link secondary" href={entity.pedigreeHref}>
            Voir dans le pedigree
          </Link>
          <LifecycleForm entity={entity} />
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

function EntityInspectorHeader({
  entity,
  onClose,
  closeButton,
}: {
  entity: BreedingEntityDetail;
  onClose: () => void;
  closeButton: RefObject<HTMLButtonElement>;
}) {
  return (
    <header>
      <div>
        <span className="eyebrow">{kindLabel(entity.kind)}</span>
        <h2 id="entity-inspector-title" className="entity-code">
          {entity.code}
        </h2>
        <p>{entity.title}</p>
        <div className="inspector-badges">
          {entity.archived ? (
            <span className="inspector-badge archived">Archivé</span>
          ) : (
            <span className="inspector-badge">Actif</span>
          )}
          <span className="inspector-badge muted">{entity.status}</span>
        </div>
      </div>
      <button
        ref={closeButton}
        type="button"
        className="quiet close"
        onClick={onClose}
        aria-label="Fermer le détail"
      >
        ✕
      </button>
    </header>
  );
}

function EntityFieldSection({
  title,
  fields,
}: BreedingEntityDetail["sections"][number]) {
  return (
    <section>
      <h3>{title}</h3>
      <dl className="inspector-fields">
        {fields.map((field) => (
          <div key={field.label}>
            <dt>{field.label}</dt>
            <dd>{field.value || "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function EntityPhenotypeSection({
  summary,
}: {
  summary: BreedingEntityDetail["phenotypeSummary"];
}) {
  return (
    <section>
      <h3>Phénotypage</h3>
      {summary.length ? (
        <>
          <p className="inspector-note">
            {summary.length} phénotype(s) relié(s) · dernière évaluation
            calculée par PostgreSQL
          </p>
          <ul className="phenotype-summary">
            {summary.map((item) => (
              <li key={item.code}>
                <strong>{item.code}</strong>
                <span>{item.decision ?? "Non évalué"}</span>
                <small>
                  {item.weightedScore == null
                    ? "Aucun score"
                    : `${item.weightedScore} pts · ${item.normalizedScore ?? "—"} % · ${item.evaluationDate ?? "date non renseignée"}`}
                </small>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="inspector-note">Pas encore de données phénotypiques.</p>
      )}
    </section>
  );
}

// Media persistence (Supabase Storage + metadata) is a future milestone; this
// section is the stable boundary where stored plant images will render.
function EntityMediaSection() {
  return (
    <section>
      <h3>Images</h3>
      <p className="inspector-note">Aucune image enregistrée.</p>
    </section>
  );
}

function kindLabel(kind: BreedingEntityKind) {
  return {
    parent: "Lignée parentale",
    cross: "Croisement",
    family: "Famille",
    lot: "Lot de graines",
  }[kind];
}
