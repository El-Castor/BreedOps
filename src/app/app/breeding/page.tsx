import Link from "next/link";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { FormDrawer } from "@/components/form-drawer";
import { Icon, type IconName } from "@/components/icons";
import {
  EntityInspectorWorkspace,
  EntityTableRow,
} from "@/components/entity-inspector";
import {
  Breadcrumbs,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgramContext,
  ProgramSwitch,
  SectionHeader,
  StatusBadge,
} from "@/components/ui";
import { requireIdentity } from "@/lib/auth";
import {
  buildBreedingEntityDetails,
  formatDay,
  statusLabel,
  unitLabel,
  type BreedingDetailSource,
} from "@/lib/breeding-entity-details";
import { collectionState } from "@/lib/query-state";
import {
  createCross,
  createFamily,
  createGerminationTest,
  createParentLine,
  createProgram,
  createSeedLot,
} from "../breeding-actions";

type Params = { program?: string; q?: string; archived?: string };

export default async function BreedingPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const { client, team } = await requireIdentity();
  const params = await searchParams;
  const programsState = collectionState(
    await client
      .from("programs")
      .select("id,code,name,species,campaign")
      .is("deleted_at", null)
      .order("code"),
    "Impossible de charger les programmes.",
  );
  if (programsState.status === "error")
    return (
      <div className="page">
        <ErrorState message={programsState.message} retryHref="/app/breeding" />
      </div>
    );
  const programs = programsState.data;
  const selected =
    programs.find((program) => program.id === params.program) ?? programs[0];
  const programId = selected?.id;
  const empty = { data: [], error: null };
  const results = programId
    ? await Promise.all([
        client
          .from("parent_lines")
          .select(
            "id,parent_code,line_name,generation,origin,description,accession,source,status,notes,created_at,updated_at,deleted_at",
          )
          .eq("program_id", programId)
          .order("parent_code"),
        client
          .from("crosses")
          .select(
            "id,cross_code,female_parent_id,male_parent_id,generation,target_traits,pollination_date,harvest_date,pollinated_units,established_units,total_seeds,status,priority,notes,created_at,updated_at,deleted_at",
          )
          .eq("program_id", programId)
          .order("created_at", { ascending: false }),
        client
          .from("families")
          .select(
            "id,family_code,cross_id,generation,status,notes,created_at,updated_at,deleted_at",
          )
          .eq("program_id", programId)
          .order("family_code"),
        client
          .from("seed_lots")
          .select(
            "id,seed_lot_code,cross_id,family_id,harvest_date,total_quantity,quantity_unit,storage_location,genetic_purity_status,verification_method,status,notes,created_at,updated_at,deleted_at",
          )
          .eq("program_id", programId)
          .order("created_at", { ascending: false }),
        client.rpc("program_cross_yields", { target_program_id: programId }),
      ])
    : [empty, empty, empty, empty, empty];
  const states = [
    collectionState(
      results[0],
      "Impossible de charger les lignées parentales.",
    ),
    collectionState(results[1], "Impossible de charger les croisements."),
    collectionState(results[2], "Impossible de charger les familles."),
    collectionState(results[3], "Impossible de charger les lots de graines."),
    collectionState(results[4], "Impossible de calculer les rendements."),
  ];
  const failed = states.find((state) => state.status === "error");
  if (failed?.status === "error")
    return (
      <div className="page">
        <ErrorState
          message={failed.message}
          retryHref={
            programId ? `/app/breeding?program=${programId}` : "/app/breeding"
          }
        />
      </div>
    );
  const allParentRecords = states[0].data as BreedingDetailSource["parents"];
  const allCrossRecords = states[1].data as BreedingDetailSource["crosses"];
  const allFamilyRecords = states[2].data as BreedingDetailSource["families"];
  const allLotRecords = states[3].data as BreedingDetailSource["lots"];
  const crossYields = states[4].data as BreedingDetailSource["crossYields"];
  // Active records feed every creation selector; archives stay out of them.
  const parents = allParentRecords.filter((item) => !item.deleted_at);
  const allCrosses = allCrossRecords.filter((item) => !item.deleted_at);
  const families = allFamilyRecords.filter((item) => !item.deleted_at);
  const lots = allLotRecords.filter((item) => !item.deleted_at);
  const showArchived = params.archived === "1";
  const query = params.q?.trim() ?? "";
  const matches = (...values: (string | null | undefined)[]) =>
    !query ||
    values.some((value) => value?.toLowerCase().includes(query.toLowerCase()));
  const visible = <T extends { deleted_at: string | null }>(rows: T[]) =>
    showArchived ? rows : rows.filter((row) => !row.deleted_at);
  const parentRows = visible(allParentRecords).filter((item) =>
    matches(item.parent_code, item.line_name, item.accession, item.source),
  );
  const crossRows = visible(allCrossRecords).filter((item) =>
    matches(item.cross_code),
  );
  const familyRows = visible(allFamilyRecords).filter((item) =>
    matches(item.family_code),
  );
  const lotRows = visible(allLotRecords).filter((item) =>
    matches(item.seed_lot_code, item.storage_location),
  );
  const testsState = collectionState(
    allLotRecords.length
      ? await client
          .from("germination_tests")
          .select(
            "id,seed_lot_id,test_date,evaluation_day,seeds_tested,seeds_germinated,germination_rate,method",
          )
          .in(
            "seed_lot_id",
            allLotRecords.map((lot) => lot.id),
          )
          .is("deleted_at", null)
          .order("test_date", { ascending: false })
      : empty,
    "Impossible de charger les tests de germination.",
  );
  if (testsState.status === "error")
    return (
      <div className="page">
        <ErrorState
          message={testsState.message}
          retryHref={`/app/breeding?program=${programId}`}
        />
      </div>
    );
  const tests = testsState.data as {
    id: string;
    seed_lot_id: string;
    test_date: string;
    evaluation_day: number;
    seeds_tested: number;
    seeds_germinated: number;
    germination_rate: number;
    method: string;
  }[];
  const phenotypesState = collectionState(
    programId
      ? await client
          .from("phenotypes")
          .select("id,phenotype_code,family_id,seed_lot_id")
          .eq("program_id", programId)
          .is("deleted_at", null)
      : empty,
    "Impossible de charger le résumé phénotypique.",
  );
  if (phenotypesState.status === "error")
    return (
      <div className="page">
        <ErrorState
          message={phenotypesState.message}
          retryHref={`/app/breeding?program=${programId}`}
        />
      </div>
    );
  const phenotypes = phenotypesState.data as BreedingDetailSource["phenotypes"];
  const evaluationsState = collectionState(
    phenotypes.length
      ? await client
          .from("phenotype_evaluations")
          .select(
            "phenotype_id,evaluation_date,weighted_score,normalized_score,automatic_decision",
          )
          .in(
            "phenotype_id",
            phenotypes.map((item) => item.id),
          )
          .is("deleted_at", null)
          .order("evaluation_date", { ascending: false })
      : empty,
    "Impossible de charger les évaluations phénotypiques.",
  );
  if (evaluationsState.status === "error")
    return (
      <div className="page">
        <ErrorState
          message={evaluationsState.message}
          retryHref={`/app/breeding?program=${programId}`}
        />
      </div>
    );
  const entityDetails = selected
    ? buildBreedingEntityDetails({
        program: selected,
        parents: allParentRecords,
        crosses: allCrossRecords,
        families: allFamilyRecords,
        lots: allLotRecords,
        crossYields,
        germinationTests: tests,
        phenotypes,
        evaluations:
          evaluationsState.data as BreedingDetailSource["evaluations"],
      })
    : [];
  const detailFor = (kind: string, entityId: string) => {
    const detail = entityDetails.find(
      (item) => item.kind === kind && item.id === entityId,
    );
    if (!detail) throw new Error("Missing breeding entity detail");
    return detail;
  };
  const parentName = (id: string) =>
    allParentRecords.find((item) => item.id === id)?.parent_code ?? "—";
  const crossName = (id: string | null) =>
    allCrossRecords.find((item) => item.id === id)?.cross_code ?? "—";
  const familyName = (id: string | null) =>
    allFamilyRecords.find((item) => item.id === id)?.family_code ?? "—";
  const lotName = (id: string) =>
    allLotRecords.find((item) => item.id === id)?.seed_lot_code ?? "—";
  const yieldOf = (id: string) =>
    crossYields.find((item) => item.cross_id === id)?.seed_yield ?? null;
  const latestTest = (lotId: string) =>
    tests.find((test) => test.seed_lot_id === lotId);
  const base = `/app/breeding?program=${programId}`;
  const queryParam = query ? `&q=${encodeURIComponent(query)}` : "";
  const counter = (rows: { deleted_at: string | null }[], shown: number) => {
    const archived = rows.filter((row) => row.deleted_at).length;
    const active = rows.length - archived;
    return [
      `${shown} affiché${shown > 1 ? "s" : ""}`,
      `${active} actif${active > 1 ? "s" : ""}`,
      archived ? `${archived} archivé${archived > 1 ? "s" : ""}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const noMatch = query ? `Aucun résultat pour « ${query} ».` : null;
  const steps: [string, number | null, string, IconName][] = [
    ["Lignées", parents.length, "#parents", "parent"],
    ["Croisements", allCrosses.length, "#crosses", "cross"],
    ["Familles", families.length, "#families", "family"],
    ["Lots", lots.length, "#lots", "lot"],
    ["Germination", tests.length, "#germination", "seed"],
    [
      "Phénotypage",
      null,
      `/app/phenotypes?program=${programId ?? ""}`,
      "phenotype",
    ],
  ];

  return (
    <EntityInspectorWorkspace>
      <div className="page">
        <Breadcrumbs
          items={[{ label: "Accueil", href: "/app" }, { label: "Programme" }]}
        />
        <PageHeader
          eyebrow="Flux d’élevage"
          title="Programme et matériel végétal"
          description="Registres des lignées, croisements, familles et lots. Sélectionnez une ligne pour ouvrir sa fiche."
          actions={
            programId ? (
              <Link
                className="button-link secondary"
                href={`/app/pedigree?program=${programId}`}
              >
                Voir le pedigree
              </Link>
            ) : undefined
          }
        />
        <ProgramContext team={team.name} program={selected} />
        <ProgramSwitch
          programs={programs}
          activeId={programId}
          basePath="/app/breeding"
        />
        {!selected ? (
          <Card>
            <EmptyState
              title="Aucun programme"
              message="Créez un programme avant d’ajouter du matériel végétal."
            />
            <ActionForm action={createProgram} actionName="program">
              <h2>Créer le premier programme</h2>
              <div className="fields-2">
                <label>
                  Code
                  <input name="code" required maxLength={80} />
                </label>
                <label>
                  Nom
                  <input name="name" required maxLength={160} />
                </label>
                <label>
                  Espèce
                  <input name="species" required maxLength={160} />
                </label>
                <label>
                  Campagne
                  <input name="campaign" maxLength={40} />
                </label>
              </div>
            </ActionForm>
          </Card>
        ) : (
          <>
            <div className="section-nav">
              <nav className="tabs" aria-label="Sections du programme">
                {steps.map(([label, count, href, icon]) => (
                  <a href={href} key={label}>
                    <Icon name={icon} />
                    {label}
                    {count != null && (
                      <span className="tab-count">{count}</span>
                    )}
                  </a>
                ))}
              </nav>
            </div>

            <div className="register-toolbar">
              <form method="get" role="search">
                <input type="hidden" name="program" value={programId} />
                {showArchived && (
                  <input type="hidden" name="archived" value="1" />
                )}
                <label className="sr-only" htmlFor="register-search">
                  Rechercher dans les registres
                </label>
                <input
                  id="register-search"
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder="Code, nom, accession, source…"
                />
                <button className="secondary">
                  <Icon name="search" />
                  Rechercher
                </button>
              </form>
              {/* Document navigation on purpose: the client router silently
                  aborted query-only navigation on this page (agend TD-003). */}
              <nav className="segmented" aria-label="Cycle de vie affiché">
                <a
                  className={showArchived ? "" : "active"}
                  aria-current={showArchived ? undefined : "true"}
                  href={`${base}${queryParam}`}
                >
                  Actifs
                </a>
                <a
                  className={showArchived ? "active" : ""}
                  aria-current={showArchived ? "true" : undefined}
                  href={`${base}&archived=1${queryParam}`}
                >
                  <Icon name="archive" size={14} /> Avec archives
                </a>
              </nav>
            </div>

            <WorkflowSection
              id="parents"
              icon="parent"
              step="1"
              title="Lignées parentales"
              description="Deux lignées distinctes sont nécessaires pour créer un croisement."
              count={counter(allParentRecords, parentRows.length)}
              actions={
                <FormDrawer
                  label="Nouvelle lignée"
                  title="Nouvelle lignée parentale"
                  description="Le code BreedOps est attribué automatiquement."
                  disabled={false}
                >
                  <ActionForm
                    action={createParentLine}
                    actionName="parent"
                    className="card form"
                    submitLabel="Ajouter la lignée"
                  >
                    <h3>Nouvelle lignée</h3>
                    <input type="hidden" name="program_id" value={programId} />
                    <p className="generated-code-hint">
                      Code BreedOps attribué automatiquement
                    </p>
                    <fieldset className="form-section">
                      <label>
                        Nom de la lignée
                        <input name="line_name" required maxLength={160} />
                      </label>
                      <div className="fields-2">
                        <label>
                          Génération
                          <input name="generation" type="number" min="0" />
                        </label>
                        <label>
                          Accession
                          <input
                            name="accession"
                            maxLength={120}
                            placeholder="Réf. externe"
                          />
                        </label>
                      </div>
                    </fieldset>
                    <fieldset className="form-section">
                      <legend>Provenance</legend>
                      <label>
                        Source
                        <input
                          name="source"
                          maxLength={160}
                          placeholder="Obtenteur, institut, fournisseur"
                        />
                      </label>
                      <label>
                        Origine
                        <input
                          name="origin"
                          maxLength={160}
                          placeholder="Population, sélection d’origine"
                        />
                      </label>
                      <label>
                        Notes
                        <textarea name="notes" maxLength={1000} rows={2} />
                      </label>
                    </fieldset>
                  </ActionForm>
                </FormDrawer>
              }
            >
              <Card>
                {parentRows.length ? (
                  <DataTable label="Lignées parentales">
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Nom · accession</th>
                          <th className="num">Gén.</th>
                          <th>Source</th>
                          <th className="num">Croisements</th>
                          <th>État</th>
                          <th>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {parentRows.map((parent) => (
                          <EntityTableRow
                            key={parent.id}
                            entity={detailFor("parent", parent.id)}
                          >
                            <td>
                              <strong className="code">
                                {parent.parent_code}
                              </strong>
                            </td>
                            <td>
                              {parent.line_name}
                              {parent.accession && (
                                <span className="secondary-line">
                                  {parent.accession}
                                </span>
                              )}
                            </td>
                            <td className="num">{parent.generation ?? "—"}</td>
                            <td>{parent.source || parent.origin || "—"}</td>
                            <td className="num">
                              {
                                allCrossRecords.filter(
                                  (cross) =>
                                    cross.female_parent_id === parent.id ||
                                    cross.male_parent_id === parent.id,
                                ).length
                              }
                            </td>
                            <td>
                              <LifecycleBadge
                                archived={Boolean(parent.deleted_at)}
                                status={parent.status}
                              />
                            </td>
                          </EntityTableRow>
                        ))}
                      </tbody>
                    </table>
                  </DataTable>
                ) : (
                  <EmptyState
                    title={
                      noMatch ? "Aucune lignée" : "Aucun parent disponible"
                    }
                    message={
                      noMatch ??
                      "Ajoutez au moins deux lignées parentales avant de créer un croisement."
                    }
                  />
                )}
              </Card>
            </WorkflowSection>

            <WorkflowSection
              id="crosses"
              icon="cross"
              step="2"
              title="Croisements"
              description="Associez deux parents. Le croisement devient disponible pour créer une famille."
              count={counter(allCrossRecords, crossRows.length)}
              actions={
                <FormDrawer
                  label="Nouveau croisement"
                  title="Nouveau croisement"
                  description="Associez deux lignées parentales actives."
                  disabled={parents.length < 2}
                  disabledReason="Deux lignées actives nécessaires"
                >
                  <ActionForm
                    action={createCross}
                    actionName="cross"
                    className="card form"
                    disabled={parents.length < 2}
                    submitLabel="Créer le croisement"
                  >
                    <h3>Nouveau croisement</h3>
                    <input type="hidden" name="program_id" value={programId} />
                    <p className="generated-code-hint">
                      Code BreedOps attribué automatiquement
                    </p>
                    <ParentSelect
                      name="female_parent_id"
                      label="Parent femelle"
                      parents={parents}
                      disabled={parents.length < 2}
                    />
                    <ParentSelect
                      name="male_parent_id"
                      label="Parent mâle"
                      parents={parents}
                      disabled={parents.length < 2}
                    />
                    <label>
                      Date de pollinisation
                      <input
                        name="pollination_date"
                        type="date"
                        required
                        disabled={parents.length < 2}
                      />
                    </label>
                    <fieldset className="form-section">
                      <legend>Quantités</legend>
                      <div className="fields-3">
                        <label>
                          Pollinisées
                          <input
                            name="pollinated_units"
                            type="number"
                            min="0"
                          />
                        </label>
                        <label>
                          Établies
                          <input
                            name="established_units"
                            type="number"
                            min="0"
                          />
                        </label>
                        <label>
                          Graines
                          <input name="total_seeds" type="number" min="0" />
                        </label>
                      </div>
                      <p className="form-hint">
                        Le rendement (graines par unité pollinisée) est calculé
                        par PostgreSQL.
                      </p>
                    </fieldset>
                    <label>
                      Notes
                      <textarea name="notes" maxLength={1000} rows={2} />
                    </label>
                    {parents.length < 2 && (
                      <p className="form-hint blocked">
                        Disponible après création de deux parents actifs.
                      </p>
                    )}
                  </ActionForm>
                </FormDrawer>
              }
            >
              {parents.length < 2 && (
                <Prerequisite
                  title="Croisement indisponible"
                  message={`${parents.length === 0 ? "Aucun parent disponible" : "Une seule lignée est disponible"}. Ajoutez au moins deux lignées distinctes.`}
                  href="#parents"
                  label="Ajouter une lignée parentale"
                />
              )}
              <Card>
                {crossRows.length ? (
                  <DataTable label="Croisements">
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>♀ × ♂</th>
                          <th>Pollinisation</th>
                          <th className="num">Graines</th>
                          <th className="num">Rendement</th>
                          <th>État</th>
                          <th>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {crossRows.map((cross) => (
                          <EntityTableRow
                            key={cross.id}
                            entity={detailFor("cross", cross.id)}
                          >
                            <td>
                              <strong className="code">
                                {cross.cross_code}
                              </strong>
                            </td>
                            <td className="code">
                              {parentName(cross.female_parent_id)} ×{" "}
                              {parentName(cross.male_parent_id)}
                            </td>
                            <td className="num">
                              {formatDay(cross.pollination_date)}
                            </td>
                            <td className="num">{cross.total_seeds ?? "—"}</td>
                            <td className="num">{yieldOf(cross.id) ?? "—"}</td>
                            <td>
                              <LifecycleBadge
                                archived={Boolean(cross.deleted_at)}
                                status={cross.status}
                              />
                            </td>
                          </EntityTableRow>
                        ))}
                      </tbody>
                    </table>
                  </DataTable>
                ) : (
                  <EmptyState
                    title="Aucun croisement"
                    message={
                      noMatch ??
                      "Créez un croisement à partir de deux lignées parentales."
                    }
                  />
                )}
              </Card>
            </WorkflowSection>

            <WorkflowSection
              id="families"
              icon="family"
              step="3"
              title="Familles"
              description="Une famille conserve le lien avec son croisement d’origine."
              count={counter(allFamilyRecords, familyRows.length)}
              actions={
                <FormDrawer
                  label="Nouvelle famille"
                  title="Nouvelle famille"
                  description="Une famille conserve le lien avec son croisement."
                  disabled={!allCrosses.length}
                  disabledReason="Un croisement actif nécessaire"
                >
                  <ActionForm
                    action={createFamily}
                    actionName="family"
                    className="card form"
                    disabled={!allCrosses.length}
                    submitLabel="Créer la famille"
                  >
                    <h3>Nouvelle famille</h3>
                    <input type="hidden" name="program_id" value={programId} />
                    <p className="generated-code-hint">
                      Code BreedOps attribué automatiquement
                    </p>
                    <label>
                      Croisement
                      <select
                        name="cross_id"
                        required
                        disabled={!allCrosses.length}
                      >
                        <option value="">Choisir un croisement</option>
                        {allCrosses.map((cross) => (
                          <option key={cross.id} value={cross.id}>
                            {cross.cross_code}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Génération
                      <input
                        name="generation"
                        type="number"
                        min="0"
                        disabled={!allCrosses.length}
                      />
                    </label>
                    <label>
                      Notes
                      <textarea
                        name="notes"
                        maxLength={1000}
                        rows={2}
                        disabled={!allCrosses.length}
                      />
                    </label>
                    {!allCrosses.length && (
                      <p className="form-hint blocked">
                        Disponible après création d’un croisement actif.
                      </p>
                    )}
                  </ActionForm>
                </FormDrawer>
              }
            >
              {!allCrosses.length && (
                <Prerequisite
                  title="Aucun croisement disponible"
                  message="Créez d’abord un croisement pour enregistrer une famille."
                  href="#crosses"
                  label="Créer un croisement"
                />
              )}
              <Card>
                {familyRows.length ? (
                  <DataTable label="Familles">
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Croisement</th>
                          <th>♀ × ♂</th>
                          <th className="num">Gén.</th>
                          <th className="num">Lots</th>
                          <th>État</th>
                          <th>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {familyRows.map((family) => {
                          const cross = allCrossRecords.find(
                            (item) => item.id === family.cross_id,
                          );
                          return (
                            <EntityTableRow
                              key={family.id}
                              entity={detailFor("family", family.id)}
                            >
                              <td>
                                <strong className="code">
                                  {family.family_code}
                                </strong>
                              </td>
                              <td className="code">
                                {crossName(family.cross_id)}
                              </td>
                              <td className="code">
                                {cross
                                  ? `${parentName(cross.female_parent_id)} × ${parentName(cross.male_parent_id)}`
                                  : "—"}
                              </td>
                              <td className="num">
                                {family.generation ?? "—"}
                              </td>
                              <td className="num">
                                {
                                  allLotRecords.filter(
                                    (lot) => lot.family_id === family.id,
                                  ).length
                                }
                              </td>
                              <td>
                                <LifecycleBadge
                                  archived={Boolean(family.deleted_at)}
                                  status={family.status}
                                />
                              </td>
                            </EntityTableRow>
                          );
                        })}
                      </tbody>
                    </table>
                  </DataTable>
                ) : (
                  <EmptyState
                    title="Aucune famille"
                    message={
                      noMatch ??
                      "Les familles créées depuis un croisement apparaîtront ici."
                    }
                  />
                )}
              </Card>
            </WorkflowSection>

            <WorkflowSection
              id="lots"
              icon="lot"
              step="4"
              title="Lots de graines"
              description="Le lot relie le matériel récolté à sa famille et à son croisement."
              count={counter(allLotRecords, lotRows.length)}
              actions={
                <FormDrawer
                  label="Nouveau lot"
                  title="Nouveau lot de graines"
                  description="Le lot relie la récolte à sa famille et à son croisement."
                  disabled={!families.length}
                  disabledReason="Une famille active nécessaire"
                >
                  <ActionForm
                    action={createSeedLot}
                    actionName="seed-lot"
                    className="card form"
                    disabled={!families.length}
                    submitLabel="Créer le lot"
                  >
                    <h3>Nouveau lot</h3>
                    <input type="hidden" name="program_id" value={programId} />
                    <p className="generated-code-hint">
                      Code BreedOps attribué automatiquement
                    </p>
                    <label>
                      Croisement
                      <select
                        name="cross_id"
                        required
                        disabled={!families.length}
                      >
                        <option value="">Choisir</option>
                        {allCrosses.map((cross) => (
                          <option key={cross.id} value={cross.id}>
                            {cross.cross_code}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Famille
                      <select
                        name="family_id"
                        required
                        disabled={!families.length}
                      >
                        <option value="">Choisir</option>
                        {families.map((family) => (
                          <option key={family.id} value={family.id}>
                            {family.family_code} · {crossName(family.cross_id)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="fields-2">
                      <label>
                        Date de récolte
                        <input
                          name="harvest_date"
                          type="date"
                          required
                          disabled={!families.length}
                        />
                      </label>
                      <label>
                        Quantité en graines
                        <input
                          name="total_quantity"
                          type="number"
                          min="0"
                          step="1"
                          required
                          disabled={!families.length}
                        />
                      </label>
                    </div>
                    <label>
                      Emplacement de stockage
                      <input
                        name="storage_location"
                        maxLength={160}
                        disabled={!families.length}
                      />
                    </label>
                    <label>
                      Notes
                      <textarea
                        name="notes"
                        maxLength={1000}
                        rows={2}
                        disabled={!families.length}
                      />
                    </label>
                    {!families.length && (
                      <p className="form-hint blocked">
                        Disponible après création d’une famille active.
                      </p>
                    )}
                  </ActionForm>
                </FormDrawer>
              }
            >
              {!families.length && (
                <Prerequisite
                  title="Aucune famille disponible"
                  message="Un lot doit appartenir à une famille. Créez d’abord la famille issue du croisement."
                  href="#families"
                  label="Créer une famille"
                />
              )}
              <Card>
                {lotRows.length ? (
                  <DataTable label="Lots de graines">
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Famille</th>
                          <th>Croisement</th>
                          <th>Récolte</th>
                          <th className="num">Quantité</th>
                          <th className="num">Germination</th>
                          <th>Stockage</th>
                          <th>État</th>
                          <th>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {lotRows.map((lot) => {
                          const test = latestTest(lot.id);
                          return (
                            <EntityTableRow
                              key={lot.id}
                              entity={detailFor("lot", lot.id)}
                            >
                              <td>
                                <strong className="code">
                                  {lot.seed_lot_code}
                                </strong>
                              </td>
                              <td className="code">
                                {familyName(lot.family_id)}
                              </td>
                              <td className="code">
                                {crossName(lot.cross_id)}
                              </td>
                              <td className="num">
                                {formatDay(lot.harvest_date)}
                              </td>
                              <td className="num">
                                {lot.total_quantity == null
                                  ? "—"
                                  : `${lot.total_quantity} ${unitLabel(lot.quantity_unit)}`}
                              </td>
                              <td className="num">
                                {test
                                  ? `${Number(test.germination_rate).toFixed(1)} %`
                                  : "—"}
                              </td>
                              <td>{lot.storage_location || "—"}</td>
                              <td>
                                <LifecycleBadge
                                  archived={Boolean(lot.deleted_at)}
                                  status={lot.status}
                                />
                              </td>
                            </EntityTableRow>
                          );
                        })}
                      </tbody>
                    </table>
                  </DataTable>
                ) : (
                  <EmptyState
                    title="Aucun lot"
                    message={
                      noMatch ??
                      "Les lots créés depuis une famille apparaîtront ici."
                    }
                  />
                )}
              </Card>
            </WorkflowSection>

            <WorkflowSection
              id="germination"
              icon="seed"
              step="5"
              title="Germination"
              description="Le taux est calculé et conservé par PostgreSQL."
              count={`${tests.length} test${tests.length > 1 ? "s" : ""}`}
              actions={
                <FormDrawer
                  label="Nouveau test"
                  title="Nouveau test de germination"
                  description="PostgreSQL calcule le taux de germination."
                  disabled={!lots.length}
                  disabledReason="Un lot actif nécessaire"
                >
                  <ActionForm
                    action={createGerminationTest}
                    actionName="germination"
                    className="card form"
                    disabled={!lots.length}
                    submitLabel="Enregistrer le test"
                  >
                    <h3>Nouveau test</h3>
                    <label>
                      Lot
                      <select
                        name="seed_lot_id"
                        required
                        disabled={!lots.length}
                      >
                        <option value="">Choisir</option>
                        {lots.map((lot) => (
                          <option key={lot.id} value={lot.id}>
                            {lot.seed_lot_code}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="fields-2">
                      <label>
                        Date
                        <input
                          name="test_date"
                          type="date"
                          required
                          disabled={!lots.length}
                        />
                      </label>
                      <label>
                        Jour d’évaluation
                        <input
                          name="evaluation_day"
                          type="number"
                          min="0"
                          required
                          disabled={!lots.length}
                        />
                      </label>
                      <label>
                        Graines testées
                        <input
                          name="seeds_tested"
                          type="number"
                          min="1"
                          required
                          disabled={!lots.length}
                        />
                      </label>
                      <label>
                        Graines germées
                        <input
                          name="seeds_germinated"
                          type="number"
                          min="0"
                          required
                          disabled={!lots.length}
                        />
                      </label>
                    </div>
                    <label>
                      Méthode
                      <input
                        name="method"
                        required
                        maxLength={160}
                        disabled={!lots.length}
                      />
                    </label>
                    {!lots.length && (
                      <p className="form-hint blocked">
                        Disponible après création d’un lot actif.
                      </p>
                    )}
                  </ActionForm>
                </FormDrawer>
              }
            >
              {!lots.length && (
                <Prerequisite
                  title="Aucun lot disponible"
                  message="Créez un lot de graines avant d’enregistrer un test."
                  href="#lots"
                  label="Créer un lot"
                />
              )}
              <Card>
                {tests.length ? (
                  <DataTable label="Tests de germination">
                    <table>
                      <thead>
                        <tr>
                          <th>Lot</th>
                          <th>Date</th>
                          <th className="num">Taux</th>
                          <th className="num">Germées / testées</th>
                          <th>Méthode</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tests.map((test) => (
                          <tr key={test.id}>
                            <td className="code">
                              {lotName(test.seed_lot_id)}
                            </td>
                            <td className="num">{formatDay(test.test_date)}</td>
                            <td className="num">
                              <strong>
                                {Number(test.germination_rate).toFixed(2)} %
                              </strong>
                            </td>
                            <td className="num">
                              {test.seeds_germinated}/{test.seeds_tested} · J
                              {test.evaluation_day}
                            </td>
                            <td>{test.method}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </DataTable>
                ) : (
                  <EmptyState
                    title="Aucun test"
                    message="Les résultats de germination apparaîtront ici."
                  />
                )}
              </Card>
            </WorkflowSection>
          </>
        )}
      </div>
    </EntityInspectorWorkspace>
  );
}

function WorkflowSection({
  id,
  step,
  title,
  description,
  count,
  icon,
  actions,
  children,
}: {
  id: string;
  step: string;
  title: string;
  description: string;
  count?: string;
  icon: IconName;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="section-block">
      <div className="register-header">
        <div>
          <p className="eyebrow">Étape {step}</p>
          <h2>
            <Icon name={icon} size={18} />
            {title}
          </h2>
          <p>
            {description}
            {count && <span className="section-count"> · {count}</span>}
          </p>
        </div>
        <div className="register-actions">{actions}</div>
      </div>
      {children}
    </section>
  );
}

function LifecycleBadge({
  archived,
  status,
}: {
  archived: boolean;
  status: string;
}) {
  return archived ? (
    <StatusBadge tone="archived">Archivé</StatusBadge>
  ) : (
    <StatusBadge
      tone={
        status === "active"
          ? "success"
          : status === "cancelled"
            ? "danger"
            : "info"
      }
    >
      {statusLabel(status)}
    </StatusBadge>
  );
}

function Prerequisite({
  title,
  message,
  href,
  label,
}: {
  title: string;
  message: string;
  href: string;
  label: string;
}) {
  return (
    <div className="prerequisite" role="status">
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
      <a href={href} className="button-link secondary">
        {label}
      </a>
    </div>
  );
}

function ParentSelect({
  name,
  label,
  parents,
  disabled,
}: {
  name: string;
  label: string;
  parents: { id: string; parent_code: string; line_name: string | null }[];
  disabled: boolean;
}) {
  return (
    <label>
      {label}
      <select name={name} required disabled={disabled}>
        <option value="">Choisir une lignée</option>
        {parents.map((parent) => (
          <option key={parent.id} value={parent.id}>
            {parent.parent_code} · {parent.line_name || "Sans nom"}
          </option>
        ))}
      </select>
    </label>
  );
}
