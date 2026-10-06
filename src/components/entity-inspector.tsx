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
import { Icon } from "@/components/icons";
import { ActionMenu, DecisionBadge } from "@/components/ui";
import {
  setBreedingEntityArchived,
  updateBreedingNotes,
  updateCross,
  updateParentLine,
} from "@/app/app/breeding-actions";

export type BreedingEntityKind = "parent" | "cross" | "family" | "lot";

export type DetailField = { label: string; value: string; wide?: boolean };

export type RelationGroup = {
  label: string;
  items: { code: string; archived: boolean }[];
};

type PhenotypeItem = {
  code: string;
  decision: string | null;
  weightedScore: string | null;
  normalizedScore: string | null;
  evaluationDate: string | null;
};

type EditDescriptor =
  | {
      type: "parent";
      values: Record<
        | "line_name"
        | "generation"
        | "accession"
        | "source"
        | "origin"
        | "description"
        | "notes",
        string
      >;
    }
  | { type: "cross"; status: string; notes: string }
  | { type: "notes"; entity: "families" | "seed_lots"; notes: string };

/** One scientific record as shown by registers and the pedigree. */
export type BreedingEntityDetail = {
  id: string;
  kind: BreedingEntityKind;
  code: string;
  title: string;
  status: string;
  generation: number | null;
  archived: boolean;
  lifecycleEntity: "parent_lines" | "crosses" | "families" | "seed_lots";
  pedigreeHref: string;
  overview: DetailField[];
  lineageSummary: string;
  lineage: RelationGroup[];
  propagation: { title: string; fields: DetailField[] } | null;
  phenotypes: {
    count: number;
    evaluated: number;
    latest: PhenotypeItem | null;
    items: PhenotypeItem[];
  };
  notes: string | null;
  edit: EditDescriptor;
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
      <EntityInspector
        key={selected?.id ?? "none"}
        entity={selected}
        onClose={close}
      />
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
      <td className="cell-actions">
        <EntityActions entity={entity} />
      </td>
    </tr>
  );
}

function EntityActions({ entity }: { entity: BreedingEntityDetail }) {
  const { open } = useEntityInspector();
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <ActionMenu label={`Actions pour ${entity.code}`} ref={menu}>
      <button
        type="button"
        onClick={() => {
          menu.current?.removeAttribute("open");
          open(entity);
        }}
      >
        Voir le détail
      </button>
      <Link href={entity.pedigreeHref}>Voir le pedigree</Link>
      <div className="menu-separator" />
      <LifecycleForm entity={entity} />
    </ActionMenu>
  );
}

function LifecycleForm({ entity }: { entity: BreedingEntityDetail }) {
  return (
    <ActionForm
      action={setBreedingEntityArchived}
      actionName={`lifecycle-${entity.kind}-${entity.id}`}
      className="entity-lifecycle-form"
      submitLabel={entity.archived ? "Restaurer" : "Archiver"}
      revealOnFlash={false}
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
  const [editing, setEditing] = useState(false);
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
        <div className="inspector-actions">
          <Link className="button-link" href={entity.pedigreeHref}>
            Voir dans le pedigree
          </Link>
          {!entity.archived && (
            <button
              type="button"
              aria-pressed={editing}
              onClick={() => setEditing((value) => !value)}
            >
              {editing ? "Annuler la modification" : "Modifier"}
            </button>
          )}
          <LifecycleForm entity={entity} />
        </div>
        <div className="inspector-body">
          {editing && <EntityEditSection entity={entity} />}
          <EntityFieldSection title="Aperçu" fields={entity.overview} />
          <EntityLineageSection entity={entity} />
          {entity.propagation && (
            <EntityFieldSection
              title={entity.propagation.title}
              fields={entity.propagation.fields}
            />
          )}
          <EntityPhenotypeSection phenotypes={entity.phenotypes} />
          <EntityMediaSection />
          <EntityNotesSection notes={entity.notes} />
        </div>
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
          {entity.archived && (
            <span className="inspector-badge archived">Archivé</span>
          )}
          <span
            className={`inspector-badge${entity.archived ? "" : " success"}`}
          >
            {entity.status}
          </span>
          {entity.generation != null && (
            <span className="inspector-badge">
              Génération {entity.generation}
            </span>
          )}
        </div>
      </div>
      <button
        ref={closeButton}
        type="button"
        className="close"
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
}: {
  title: string;
  fields: DetailField[];
}) {
  return (
    <section>
      <h3>{title}</h3>
      <dl className="inspector-fields">
        {fields.map((field) => (
          <div key={field.label} className={field.wide ? "wide" : undefined}>
            <dt>{field.label}</dt>
            <dd className={field.value === "—" ? "empty" : undefined}>
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function EntityLineageSection({ entity }: { entity: BreedingEntityDetail }) {
  return (
    <section>
      <h3>Lignée</h3>
      <p className="inspector-note">{entity.lineageSummary}</p>
      <dl>
        {entity.lineage.map((group) => (
          <div className="relation-group" key={group.label}>
            <dt>{group.label}</dt>
            <dd>
              <ul className="relation-list">
                {group.items.length ? (
                  group.items.map((item) => (
                    <li
                      key={item.code}
                      className={item.archived ? "archived" : undefined}
                      title={item.archived ? "Archivé" : undefined}
                    >
                      {item.code}
                      {item.archived && (
                        <span className="sr-only"> (archivé)</span>
                      )}
                    </li>
                  ))
                ) : (
                  <li className="none">Aucun</li>
                )}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function EntityPhenotypeSection({
  phenotypes,
}: {
  phenotypes: BreedingEntityDetail["phenotypes"];
}) {
  const latest = phenotypes.latest;
  return (
    <section>
      <h3>Phénotypage et sélection</h3>
      {phenotypes.count ? (
        <>
          <dl className="phenotype-stats">
            <div>
              <dt>Phénotypes</dt>
              <dd>{phenotypes.count}</dd>
            </div>
            <div>
              <dt>Évalués</dt>
              <dd>{phenotypes.evaluated}</dd>
            </div>
            <div>
              <dt>Dernier score</dt>
              <dd>
                {latest?.normalizedScore != null
                  ? `${latest.normalizedScore} %`
                  : "—"}
              </dd>
            </div>
          </dl>
          {latest && (
            <p className="inspector-note">
              Dernière évaluation {latest.evaluationDate} · {latest.code} ·{" "}
              {latest.weightedScore} pts pondérés
            </p>
          )}
          <ul className="phenotype-summary">
            {phenotypes.items.map((item) => (
              <li key={item.code}>
                <strong>{item.code}</strong>
                <DecisionBadge decision={item.decision} />
                <small>
                  {item.weightedScore == null
                    ? "Aucune évaluation"
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
      <div className="media-empty">
        <Icon name="image" />
        <p>
          Aucune image enregistrée.
          <br />
          L’ajout de photos de plantes sera disponible dans un prochain jalon.
        </p>
        <button
          type="button"
          className="secondary"
          disabled
          title="Le stockage des images est prévu dans un prochain jalon."
        >
          Ajouter une image · bientôt
        </button>
      </div>
    </section>
  );
}

function EntityNotesSection({ notes }: { notes: string | null }) {
  return (
    <section>
      <h3>Notes</h3>
      {notes ? (
        <p className="inspector-prose">{notes}</p>
      ) : (
        <p className="inspector-note">Aucune note.</p>
      )}
    </section>
  );
}

function EntityEditSection({ entity }: { entity: BreedingEntityDetail }) {
  const edit = entity.edit;
  return (
    <section className="inspector-edit" aria-label="Modifier la fiche">
      <h3>Modifier la fiche</h3>
      {edit.type === "parent" && (
        <ActionForm
          action={updateParentLine}
          actionName={`edit-parent-${entity.id}`}
          submitLabel="Enregistrer la fiche"
          resetOnSuccess={false}
        >
          <input type="hidden" name="id" value={entity.id} />
          <label>
            Nom de la lignée
            <input
              name="line_name"
              defaultValue={edit.values.line_name}
              required
              maxLength={160}
            />
          </label>
          <div className="fields-2">
            <label>
              Génération
              <input
                name="generation"
                type="number"
                min="0"
                defaultValue={edit.values.generation}
              />
            </label>
            <label>
              Accession
              <input
                name="accession"
                defaultValue={edit.values.accession}
                maxLength={120}
              />
            </label>
          </div>
          <label>
            Source
            <input
              name="source"
              defaultValue={edit.values.source}
              maxLength={160}
            />
          </label>
          <label>
            Origine / provenance
            <input
              name="origin"
              defaultValue={edit.values.origin}
              maxLength={160}
            />
          </label>
          <label>
            Description
            <textarea
              name="description"
              defaultValue={edit.values.description}
              maxLength={1000}
              rows={2}
            />
          </label>
          <label>
            Notes
            <textarea
              name="notes"
              defaultValue={edit.values.notes}
              maxLength={1000}
              rows={3}
            />
          </label>
        </ActionForm>
      )}
      {edit.type === "cross" && (
        <ActionForm
          action={updateCross}
          actionName={`edit-cross-${entity.id}`}
          submitLabel="Enregistrer"
          resetOnSuccess={false}
        >
          <input type="hidden" name="id" value={entity.id} />
          <label>
            État du croisement
            <select name="status" defaultValue={edit.status}>
              <option value="planned">Planifié</option>
              <option value="active">Actif</option>
              <option value="completed">Terminé</option>
              <option value="cancelled">Annulé</option>
            </select>
          </label>
          <label>
            Notes
            <textarea
              name="notes"
              defaultValue={edit.notes}
              maxLength={1000}
              rows={3}
            />
          </label>
        </ActionForm>
      )}
      {edit.type === "notes" && (
        <ActionForm
          action={updateBreedingNotes}
          actionName={`edit-notes-${entity.id}`}
          submitLabel="Enregistrer les notes"
          resetOnSuccess={false}
        >
          <input type="hidden" name="entity" value={edit.entity} />
          <input type="hidden" name="id" value={entity.id} />
          <label>
            Notes
            <textarea
              name="notes"
              defaultValue={edit.notes}
              maxLength={1000}
              rows={4}
            />
          </label>
        </ActionForm>
      )}
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
