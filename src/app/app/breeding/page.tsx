import Link from "next/link";
import { ActionForm } from "@/components/action-form";
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
  StatusBadge,
} from "@/components/ui";
import { requireIdentity } from "@/lib/auth";
import {
  buildBreedingEntityDetails,
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
  updateCross,
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
            "id,parent_code,line_name,generation,origin,description,status,notes,created_at,updated_at,deleted_at",
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
      ])
    : [empty, empty, empty, empty];
  const states = [
    collectionState(
      results[0],
      "Impossible de charger les lignées parentales.",
    ),
    collectionState(results[1], "Impossible de charger les croisements."),
    collectionState(results[2], "Impossible de charger les familles."),
    collectionState(results[3], "Impossible de charger les lots de graines."),
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
  const parents = allParentRecords.filter((item) => !item.deleted_at);
  const allCrosses = allCrossRecords.filter((item) => !item.deleted_at);
  const families = allFamilyRecords.filter((item) => !item.deleted_at);
  const lots = allLotRecords.filter((item) => !item.deleted_at);
  const showArchived = params.archived === "1";
  const parentRows = showArchived ? allParentRecords : parents;
  const familyRows = showArchived ? allFamilyRecords : families;
  const lotRows = showArchived ? allLotRecords : lots;
  const crossRowsBase = showArchived ? allCrossRecords : allCrosses;
  const crosses = params.q?.trim()
    ? crossRowsBase.filter((cross) =>
        cross.cross_code.toLowerCase().includes(params.q!.trim().toLowerCase()),
      )
    : crossRowsBase;
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
  const entityDetails = buildBreedingEntityDetails({
    program: selected,
    parents: allParentRecords,
    crosses: allCrossRecords,
    families: allFamilyRecords,
    lots: allLotRecords,
    germinationTests: tests,
    phenotypes,
    evaluations: evaluationsState.data as BreedingDetailSource["evaluations"],
  });
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
  const steps = [
    ["Parents", parents.length, "#parents"],
    ["Croisements", allCrosses.length, "#crosses"],
    ["Familles", families.length, "#families"],
    ["Lots", lots.length, "#lots"],
    ["Germination", tests.length, "#germination"],
    ["Phénotypage", null, `/app/phenotypes?program=${programId ?? ""}`],
  ] as const;

  return (
    <EntityInspectorWorkspace>
      <div className="page">
        <Breadcrumbs
          items={[{ label: "Accueil", href: "/app" }, { label: "Programme" }]}
        />
        <PageHeader
          eyebrow="Flux d’élevage"
          title="Programme et matériel végétal"
          description="Avancez de la lignée parentale jusqu’au phénotypage. Chaque étape rend la suivante disponible."
          actions={
            programId ? (
              <div className="page-actions">
                <Link
                  className="button-link secondary"
                  href={`/app/pedigree?program=${programId}`}
                >
                  Voir le pedigree
                </Link>
                {/* A document navigation is used deliberately: the client
                    router silently aborted query-only navigation on this page. */}
                <a
                  className="button-link secondary"
                  href={`/app/breeding?program=${programId}${showArchived ? "" : "&archived=1"}`}
                >
                  {showArchived
                    ? "Masquer les archives"
                    : "Afficher les archives"}
                </a>
              </div>
            ) : undefined
          }
        />
        <ProgramContext team={team.name} program={selected} />
        <Card className="program-picker">
          <div>
            <h2>Programme actif</h2>
            <p>Les registres sont limités au programme sélectionné.</p>
          </div>
          <nav className="chip-nav" aria-label="Changer de programme">
            {programs.map((program) => (
              <Link
                key={program.id}
                className={program.id === programId ? "active" : ""}
                href={`/app/breeding?program=${program.id}`}
              >
                {program.code}
              </Link>
            ))}
          </nav>
        </Card>
        {!selected ? (
          <Card>
            <EmptyState
              title="Aucun programme"
              message="Créez un programme avant d’ajouter du matériel végétal."
            />
            <ActionForm action={createProgram} actionName="program">
              <h2>Créer le premier programme</h2>
              <label>
                Code requis
                <input name="code" required maxLength={80} />
              </label>
              <label>
                Nom requis
                <input name="name" required maxLength={160} />
              </label>
              <label>
                Espèce requise
                <input name="species" required maxLength={160} />
              </label>
              <label>
                Campagne
                <input name="campaign" maxLength={40} />
              </label>
            </ActionForm>
          </Card>
        ) : (
          <>
            <nav
              className="workflow-steps"
              aria-label="Progression du workflow"
            >
              {steps.map(([label, count, href], index) => (
                <Link
                  href={href}
                  key={label}
                  className={count ? "complete" : "pending"}
                >
                  <span>{index + 1}</span>
                  <strong>{label}</strong>
                  <small>
                    {count == null
                      ? "Étape suivante"
                      : `${count} élément${count > 1 ? "s" : ""}`}
                  </small>
                </Link>
              ))}
            </nav>

            <WorkflowSection
              id="parents"
              step="1"
              title="Lignées parentales"
              description="Deux lignées distinctes sont nécessaires pour créer un croisement."
            >
              <div className="grid-2">
                <ActionForm
                  action={createParentLine}
                  actionName="parent"
                  className="card form"
                >
                  <h3>Ajouter une lignée</h3>
                  <input type="hidden" name="program_id" value={programId} />
                  <p className="generated-code-hint">
                    Le code sera attribué automatiquement à l’enregistrement.
                  </p>
                  <label>
                    Nom de lignée requis
                    <input name="line_name" required maxLength={160} />
                  </label>
                  <label>
                    Génération
                    <input name="generation" type="number" min="0" />
                  </label>
                </ActionForm>
                <Card>
                  {parentRows.length ? (
                    <DataTable label="Lignées parentales">
                      <table>
                        <thead>
                          <tr>
                            <th>Code</th>
                            <th>Nom</th>
                            <th>Génération</th>
                            <th>État</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parentRows.map((parent) => (
                            <EntityTableRow
                              key={parent.id}
                              entity={detailFor("parent", parent.id)}
                            >
                              <td>
                                <strong>{parent.parent_code}</strong>
                              </td>
                              <td>{parent.line_name}</td>
                              <td>{parent.generation ?? "—"}</td>
                              <td>
                                <StatusBadge
                                  tone={
                                    parent.deleted_at ? "warning" : "success"
                                  }
                                >
                                  {parent.deleted_at
                                    ? "archivé"
                                    : parent.status}
                                </StatusBadge>
                              </td>
                            </EntityTableRow>
                          ))}
                        </tbody>
                      </table>
                    </DataTable>
                  ) : (
                    <EmptyState
                      title="Aucun parent disponible"
                      message="Ajoutez au moins deux lignées parentales avant de créer un croisement."
                      action={{
                        label: "Ajouter une lignée parentale",
                        href: "#parents",
                      }}
                    />
                  )}
                </Card>
              </div>
            </WorkflowSection>

            <WorkflowSection
              id="crosses"
              step="2"
              title="Croisements"
              description="Associez deux parents. Le croisement apparaîtra immédiatement pour créer une famille."
            >
              {parents.length < 2 && (
                <Prerequisite
                  title="Croisement indisponible"
                  message={`${parents.length === 0 ? "Aucun parent disponible" : "Une seule lignée est disponible"}. Ajoutez au moins deux lignées distinctes.`}
                  href="#parents"
                  label="Ajouter une lignée parentale"
                />
              )}
              <div className="grid-2">
                <ActionForm
                  action={createCross}
                  actionName="cross"
                  className="card form"
                  disabled={parents.length < 2}
                  submitLabel="Créer le croisement"
                >
                  <h3>Créer un croisement</h3>
                  <input type="hidden" name="program_id" value={programId} />
                  <p className="generated-code-hint">
                    Le code sera attribué automatiquement à l’enregistrement.
                  </p>
                  <ParentSelect
                    name="female_parent_id"
                    label="Parent femelle requis"
                    parents={parents}
                    disabled={parents.length < 2}
                  />
                  <ParentSelect
                    name="male_parent_id"
                    label="Parent mâle requis"
                    parents={parents}
                    disabled={parents.length < 2}
                  />
                  <label>
                    Date de pollinisation requise
                    <input
                      name="pollination_date"
                      type="date"
                      required
                      disabled={parents.length < 2}
                    />
                  </label>
                  <div className="fields-3">
                    <label>
                      Unités pollinisées
                      <input name="pollinated_units" type="number" min="0" />
                    </label>
                    <label>
                      Unités établies
                      <input name="established_units" type="number" min="0" />
                    </label>
                    <label>
                      Graines
                      <input name="total_seeds" type="number" min="0" />
                    </label>
                  </div>
                  {parents.length < 2 && (
                    <p className="form-hint">
                      Disponible après création de deux parents.
                    </p>
                  )}
                </ActionForm>
                <Card>
                  <form className="search">
                    <input name="program" type="hidden" value={programId} />
                    <label>
                      Rechercher par code
                      <input name="q" defaultValue={params.q} />
                    </label>
                    <button>Rechercher</button>
                  </form>
                  {crosses.length ? (
                    <DataTable label="Croisements">
                      <table>
                        <thead>
                          <tr>
                            <th>Code</th>
                            <th>Parents</th>
                            <th>Date</th>
                            <th>État</th>
                            <th>Modifier</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {crosses.map((cross) => (
                            <EntityTableRow
                              key={cross.id}
                              entity={detailFor("cross", cross.id)}
                            >
                              <td>
                                <strong>{cross.cross_code}</strong>
                              </td>
                              <td>
                                {parentName(cross.female_parent_id)} ×{" "}
                                {parentName(cross.male_parent_id)}
                              </td>
                              <td>{cross.pollination_date}</td>
                              <td>
                                <StatusBadge
                                  tone={
                                    cross.deleted_at ? "warning" : "neutral"
                                  }
                                >
                                  {cross.deleted_at ? "archivé" : cross.status}
                                </StatusBadge>
                              </td>
                              <td>
                                <ActionForm
                                  action={updateCross}
                                  actionName="cross-update"
                                  className="inline-action"
                                  submitLabel="Mettre à jour"
                                >
                                  <input
                                    type="hidden"
                                    name="id"
                                    value={cross.id}
                                  />
                                  <label>
                                    <span className="sr-only">
                                      État du croisement {cross.cross_code}
                                    </span>
                                    <select
                                      name="status"
                                      defaultValue={cross.status}
                                    >
                                      <option value="planned">Planifié</option>
                                      <option value="active">Actif</option>
                                      <option value="completed">Terminé</option>
                                      <option value="cancelled">Annulé</option>
                                    </select>
                                  </label>
                                  <label>
                                    <span className="sr-only">
                                      Notes du croisement {cross.cross_code}
                                    </span>
                                    <input
                                      name="notes"
                                      maxLength={1000}
                                      placeholder="Notes"
                                    />
                                  </label>
                                </ActionForm>
                              </td>
                            </EntityTableRow>
                          ))}
                        </tbody>
                      </table>
                    </DataTable>
                  ) : (
                    <EmptyState
                      title="Aucun croisement"
                      message="Créez un croisement à partir de deux lignées parentales."
                      action={{
                        label: "Créer un croisement",
                        href: "#crosses",
                      }}
                    />
                  )}
                </Card>
              </div>
            </WorkflowSection>

            <WorkflowSection
              id="families"
              step="3"
              title="Familles"
              description="Une famille conserve le lien avec son croisement d’origine."
            >
              {!allCrosses.length && (
                <Prerequisite
                  title="Aucun croisement disponible"
                  message="Créez d’abord un croisement pour enregistrer une famille."
                  href="#crosses"
                  label="Créer un croisement"
                />
              )}
              <div className="grid-2">
                <ActionForm
                  action={createFamily}
                  actionName="family"
                  className="card form"
                  disabled={!allCrosses.length}
                  submitLabel="Créer la famille"
                >
                  <h3>Créer une famille</h3>
                  <input type="hidden" name="program_id" value={programId} />
                  <label>
                    Croisement requis
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
                  <p className="generated-code-hint">
                    Le code sera attribué automatiquement à l’enregistrement.
                  </p>
                  <label>
                    Génération
                    <input
                      name="generation"
                      type="number"
                      min="0"
                      disabled={!allCrosses.length}
                    />
                  </label>
                  {!allCrosses.length && (
                    <p className="form-hint">
                      Sélectionnez d’abord un croisement.
                    </p>
                  )}
                </ActionForm>
                <Card>
                  {familyRows.length ? (
                    <DataTable label="Familles">
                      <table>
                        <thead>
                          <tr>
                            <th>Famille</th>
                            <th>Croisement</th>
                            <th>Génération</th>
                            <th>État</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {familyRows.map((family) => (
                            <EntityTableRow
                              key={family.id}
                              entity={detailFor("family", family.id)}
                            >
                              <td>
                                <strong>{family.family_code}</strong>
                              </td>
                              <td>{crossName(family.cross_id)}</td>
                              <td>{family.generation ?? "—"}</td>
                              <td>
                                <StatusBadge
                                  tone={
                                    family.deleted_at ? "warning" : "success"
                                  }
                                >
                                  {family.deleted_at
                                    ? "archivé"
                                    : family.status}
                                </StatusBadge>
                              </td>
                            </EntityTableRow>
                          ))}
                        </tbody>
                      </table>
                    </DataTable>
                  ) : (
                    <EmptyState
                      title="Aucune famille"
                      message="Les familles créées depuis un croisement apparaîtront ici."
                    />
                  )}
                </Card>
              </div>
            </WorkflowSection>

            <WorkflowSection
              id="lots"
              step="4"
              title="Lots de graines"
              description="Le lot relie le matériel récolté, sa famille et son croisement."
            >
              {!families.length && (
                <Prerequisite
                  title="Aucune famille disponible"
                  message="Un lot doit appartenir à une famille. Créez d’abord la famille issue du croisement."
                  href="#families"
                  label="Créer une famille"
                />
              )}
              <div className="grid-2">
                <ActionForm
                  action={createSeedLot}
                  actionName="seed-lot"
                  className="card form"
                  disabled={!families.length}
                  submitLabel="Créer le lot"
                >
                  <h3>Créer un lot</h3>
                  <input type="hidden" name="program_id" value={programId} />
                  <label>
                    Croisement requis
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
                    Famille requise
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
                  <p className="generated-code-hint">
                    Le code sera attribué automatiquement à l’enregistrement.
                  </p>
                  <label>
                    Date de récolte requise
                    <input
                      name="harvest_date"
                      type="date"
                      required
                      disabled={!families.length}
                    />
                  </label>
                  <label>
                    Quantité en graines requise
                    <input
                      name="total_quantity"
                      type="number"
                      min="0"
                      step="1"
                      required
                      disabled={!families.length}
                    />
                  </label>
                  <label>
                    Emplacement
                    <input
                      name="storage_location"
                      maxLength={160}
                      disabled={!families.length}
                    />
                  </label>
                  {!families.length && (
                    <p className="form-hint">Créez d’abord une famille.</p>
                  )}
                </ActionForm>
                <Card>
                  {lotRows.length ? (
                    <DataTable label="Lots de graines">
                      <table>
                        <thead>
                          <tr>
                            <th>Lot</th>
                            <th>Famille</th>
                            <th>Croisement</th>
                            <th>Quantité</th>
                            <th>État</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lotRows.map((lot) => (
                            <EntityTableRow
                              key={lot.id}
                              entity={detailFor("lot", lot.id)}
                            >
                              <td>
                                <strong>{lot.seed_lot_code}</strong>
                              </td>
                              <td>{familyName(lot.family_id)}</td>
                              <td>{crossName(lot.cross_id)}</td>
                              <td>
                                {lot.total_quantity} {lot.quantity_unit}
                              </td>
                              <td>
                                <StatusBadge
                                  tone={lot.deleted_at ? "warning" : "success"}
                                >
                                  {lot.deleted_at ? "archivé" : lot.status}
                                </StatusBadge>
                              </td>
                            </EntityTableRow>
                          ))}
                        </tbody>
                      </table>
                    </DataTable>
                  ) : (
                    <EmptyState
                      title="Aucun lot"
                      message="Les lots créés depuis une famille apparaîtront ici."
                    />
                  )}
                </Card>
              </div>
            </WorkflowSection>

            <WorkflowSection
              id="germination"
              step="5"
              title="Germination"
              description="Le taux est calculé et conservé par PostgreSQL."
            >
              {!lots.length && (
                <Prerequisite
                  title="Aucun lot disponible"
                  message="Créez un lot de graines avant d’enregistrer un test."
                  href="#lots"
                  label="Créer un lot"
                />
              )}
              <div className="grid-2">
                <ActionForm
                  action={createGerminationTest}
                  actionName="germination"
                  className="card form"
                  disabled={!lots.length}
                  submitLabel="Enregistrer le test"
                >
                  <h3>Enregistrer un test</h3>
                  <label>
                    Lot requis
                    <select name="seed_lot_id" required disabled={!lots.length}>
                      <option value="">Choisir</option>
                      {lots.map((lot) => (
                        <option key={lot.id} value={lot.id}>
                          {lot.seed_lot_code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Date requise
                    <input
                      name="test_date"
                      type="date"
                      required
                      disabled={!lots.length}
                    />
                  </label>
                  <label>
                    Jour d’évaluation requis
                    <input
                      name="evaluation_day"
                      type="number"
                      min="0"
                      required
                      disabled={!lots.length}
                    />
                  </label>
                  <label>
                    Graines testées requises
                    <input
                      name="seeds_tested"
                      type="number"
                      min="1"
                      required
                      disabled={!lots.length}
                    />
                  </label>
                  <label>
                    Graines germées requises
                    <input
                      name="seeds_germinated"
                      type="number"
                      min="0"
                      required
                      disabled={!lots.length}
                    />
                  </label>
                  <label>
                    Méthode requise
                    <input
                      name="method"
                      required
                      maxLength={160}
                      disabled={!lots.length}
                    />
                  </label>
                </ActionForm>
                <Card>
                  {tests.length ? (
                    <DataTable label="Tests de germination">
                      <table>
                        <thead>
                          <tr>
                            <th>Lot</th>
                            <th>Date</th>
                            <th>Résultat</th>
                            <th>Méthode</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tests.map((test) => (
                            <tr key={test.id}>
                              <td>{lotName(test.seed_lot_id)}</td>
                              <td>{test.test_date}</td>
                              <td>
                                <strong>
                                  {Number(test.germination_rate).toFixed(2)} %
                                </strong>
                                <br />
                                <small>
                                  {test.seeds_germinated}/{test.seeds_tested} à
                                  J{test.evaluation_day}
                                </small>
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
              </div>
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
  children,
}: {
  id: string;
  step: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="section-block">
      <div className="section-title">
        <div>
          <p className="eyebrow">Étape {step}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
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
        <strong>{title}</strong>
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
