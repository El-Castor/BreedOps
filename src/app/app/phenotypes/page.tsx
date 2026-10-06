import { ActionForm } from "@/components/action-form";
import { FormDrawer } from "@/components/form-drawer";
import { Icon, type IconName } from "@/components/icons";
import { MeasureProgress } from "@/components/measure-progress";
import {
  ActionMenu,
  Breadcrumbs,
  Card,
  DataTable,
  DecisionBadge,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgramContext,
  ProgramSwitch,
  StatusBadge,
} from "@/components/ui";
import { requireIdentity } from "@/lib/auth";
import { formatDay } from "@/lib/breeding-entity-details";
import {
  type ActiveTrait,
  type Trait,
  categoryLabels,
  directionLabels,
  formatObservation,
  formatRange,
  inputStep,
  isRanged,
  typeLabels,
} from "@/lib/phenotyping";
import { collectionState } from "@/lib/query-state";
import {
  changeModuleTrait,
  createInitialModel,
  createModule,
  createPhenotype,
  createTrait,
  setModuleActive,
  setProgramModule,
  setTraitActive,
  setTraitWeight,
  submitTraitEvaluation,
  updateTrait,
} from "./actions";

type Tab =
  | "overview"
  | "traits"
  | "modules"
  | "setup"
  | "evaluations"
  | "ranking";
const tabs: [Tab, string, IconName][] = [
  ["overview", "Vue d’ensemble", "overview"],
  ["traits", "Bibliothèque de traits", "library"],
  ["modules", "Modules", "module"],
  ["setup", "Configuration du programme", "setup"],
  ["evaluations", "Évaluations", "evaluation"],
  ["ranking", "Classement", "score"],
];

type Params = { program?: string; tab?: string; q?: string; category?: string };

export default async function Phenotypes({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const { client, team } = await requireIdentity();
  const params = await searchParams;
  const tab: Tab = tabs.some(([key]) => key === params.tab)
    ? (params.tab as Tab)
    : "overview";
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
        <ErrorState
          message={programsState.message}
          retryHref="/app/phenotypes"
        />
      </div>
    );
  const programs = programsState.data;
  const program =
    programs.find((item) => item.id === params.program) ?? programs[0];
  const programId = program?.id;
  const empty = { data: [], error: null };
  const results = await Promise.all([
    client
      .from("phenotype_traits")
      .select(
        "id,code,name,description,category,data_type,unit,minimum_value,maximum_value,decimal_places,allowed_values,direction,target_value,protocol,is_active",
      )
      .order("name"),
    client
      .from("phenotyping_modules")
      .select("id,name,description,is_active")
      .order("name"),
    client
      .from("phenotyping_module_traits")
      .select("module_id,trait_id,display_order")
      .order("display_order"),
    client
      .from("program_phenotyping_modules")
      .select("program_id,module_id,is_active,display_order"),
    programId
      ? client.rpc("program_active_traits", { target_program_id: programId })
      : Promise.resolve(empty),
    programId
      ? client
          .from("selection_models")
          .select("id,name,maximum_score,is_active,created_at")
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("created_at")
      : Promise.resolve(empty),
    programId
      ? client
          .from("families")
          .select("id,family_code")
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("family_code")
      : Promise.resolve(empty),
    programId
      ? client
          .from("seed_lots")
          .select("id,seed_lot_code,family_id")
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("seed_lot_code")
      : Promise.resolve(empty),
    programId
      ? client
          .from("phenotypes")
          .select(
            "id,phenotype_code,family_id,seed_lot_id,block,replicate,location",
          )
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("phenotype_code")
      : Promise.resolve(empty),
  ]);
  const labels = [
    "Impossible de charger la bibliothèque de traits.",
    "Impossible de charger les modules.",
    "Impossible de charger la composition des modules.",
    "Impossible de charger la configuration des programmes.",
    "Impossible de charger les traits du programme.",
    "Impossible de charger les modèles de sélection.",
    "Impossible de charger les familles.",
    "Impossible de charger les lots.",
    "Impossible de charger les phénotypes.",
  ];
  const states = results.map((result, index) =>
    collectionState(result, labels[index]),
  );
  const failed = states.find((state) => state.status === "error");
  if (failed?.status === "error")
    return (
      <div className="page">
        <ErrorState
          message={failed.message}
          retryHref={
            programId
              ? `/app/phenotypes?program=${programId}`
              : "/app/phenotypes"
          }
        />
      </div>
    );
  const traits = states[0].data as Trait[];
  const modules = states[1].data as {
    id: string;
    name: string;
    description: string | null;
    is_active: boolean;
  }[];
  const moduleTraits = states[2].data as {
    module_id: string;
    trait_id: string;
    display_order: number;
  }[];
  const programModules = states[3].data as {
    program_id: string;
    module_id: string;
    is_active: boolean;
  }[];
  const activeTraits = states[4].data as ActiveTrait[];
  const models = states[5].data as {
    id: string;
    name: string;
    maximum_score: number;
    is_active: boolean;
  }[];
  const families = states[6].data as { id: string; family_code: string }[];
  const lots = states[7].data as {
    id: string;
    seed_lot_code: string;
    family_id: string | null;
  }[];
  const phenotypes = states[8].data as {
    id: string;
    phenotype_code: string;
    family_id: string | null;
    seed_lot_id: string | null;
    block: string | null;
    replicate: number | null;
    location: string | null;
  }[];
  const evaluationsState = collectionState(
    phenotypes.length
      ? await client
          .from("phenotype_evaluations")
          .select(
            "id,phenotype_id,selection_model_id,evaluation_date,weighted_score,normalized_score,automatic_decision,created_at",
          )
          .in(
            "phenotype_id",
            phenotypes.map((item) => item.id),
          )
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
      : empty,
    "Impossible de charger les évaluations.",
  );
  if (evaluationsState.status === "error")
    return (
      <div className="page">
        <ErrorState
          message={evaluationsState.message}
          retryHref={`/app/phenotypes?program=${programId}`}
        />
      </div>
    );
  const evaluations = evaluationsState.data as {
    id: string;
    phenotype_id: string;
    selection_model_id: string | null;
    evaluation_date: string | null;
    weighted_score: number | null;
    normalized_score: number | null;
    automatic_decision: string | null;
  }[];
  const latestEvaluationIds = evaluations.slice(0, 8).map((item) => item.id);
  const valuesState = collectionState(
    latestEvaluationIds.length
      ? await client
          .from("phenotype_trait_values")
          .select(
            "phenotype_evaluation_id,trait_id,numeric_value,text_value,boolean_value,date_value",
          )
          .in("phenotype_evaluation_id", latestEvaluationIds)
      : empty,
    "Impossible de charger les mesures.",
  );
  if (valuesState.status === "error")
    return (
      <div className="page">
        <ErrorState
          message={valuesState.message}
          retryHref={`/app/phenotypes?program=${programId}`}
        />
      </div>
    );
  const values = valuesState.data as {
    phenotype_evaluation_id: string;
    trait_id: string;
    numeric_value: number | null;
    text_value: string | null;
    boolean_value: boolean | null;
    date_value: string | null;
  }[];

  const model = models.find((item) => item.is_active) ?? models[0];
  const traitById = new Map(traits.map((trait) => [trait.id, trait]));
  const phenotypeName = (value: string) =>
    phenotypes.find((item) => item.id === value)?.phenotype_code ?? "—";
  const familyName = (value: string | null) =>
    families.find((item) => item.id === value)?.family_code ?? "—";
  const lotName = (value: string | null) =>
    lots.find((item) => item.id === value)?.seed_lot_code ?? "—";
  const programName = (value: string) =>
    programs.find((item) => item.id === value)?.code ?? "—";
  const modulesOfTrait = (traitId: string) =>
    moduleTraits
      .filter((item) => item.trait_id === traitId)
      .map((item) => modules.find((module) => module.id === item.module_id))
      .filter((module): module is (typeof modules)[number] => Boolean(module));
  const programsOfModule = (moduleId: string) =>
    programModules.filter(
      (item) => item.module_id === moduleId && item.is_active,
    );
  const traitsOfModule = (moduleId: string) =>
    moduleTraits
      .filter((item) => item.module_id === moduleId)
      .sort((a, b) => a.display_order - b.display_order)
      .map((item) => traitById.get(item.trait_id))
      .filter((trait): trait is Trait => Boolean(trait));
  const scored = evaluations
    .filter((item) => item.automatic_decision)
    .sort(
      (a, b) =>
        Number(b.normalized_score ?? 0) - Number(a.normalized_score ?? 0),
    );
  const activeModuleIds = new Set(
    programModules
      .filter((item) => item.program_id === programId && item.is_active)
      .map((item) => item.module_id),
  );
  const weighted = activeTraits.filter((trait) => trait.coefficient != null);
  const tabHref = (key: Tab, extra = "") =>
    `/app/phenotypes?${programId ? `program=${programId}&` : ""}tab=${key}${extra}`;
  const tabCounts: Partial<Record<Tab, number>> = {
    traits: traits.filter((trait) => trait.is_active).length,
    modules: modules.filter((module) => module.is_active).length,
    setup: activeTraits.length,
    evaluations: evaluations.length,
    ranking: scored.length,
  };
  const query = params.q?.trim().toLowerCase() ?? "";
  const shownTraits = traits.filter(
    (trait) =>
      (!query ||
        trait.name.toLowerCase().includes(query) ||
        trait.code.includes(query)) &&
      (!params.category || trait.category === params.category),
  );
  const groupedActive = activeTraits.reduce<
    { module: string; traits: ActiveTrait[] }[]
  >((groups, trait) => {
    const group = groups.find((item) => item.module === trait.module_name);
    if (group) group.traits.push(trait);
    else groups.push({ module: trait.module_name, traits: [trait] });
    return groups;
  }, []);

  return (
    <div className="page">
      <Breadcrumbs
        items={[{ label: "Accueil", href: "/app" }, { label: "Phénotypes" }]}
      />
      <PageHeader
        eyebrow="Sélection"
        title="Phénotypage configurable"
        description="Bibliothèque de traits de l’équipe, modules réutilisables et formulaires de mesure générés pour chaque programme. Scores et décisions sont calculés par PostgreSQL."
      />
      <ProgramContext team={team.name} program={program} />
      <ProgramSwitch
        programs={programs}
        activeId={programId}
        basePath="/app/phenotypes"
      />
      {/* Document navigation keeps tab changes reliable (agend TD-003). */}
      <nav className="tabs" aria-label="Sections du phénotypage">
        {tabs.map(([key, label, icon]) => (
          <a
            key={key}
            href={tabHref(key)}
            aria-current={tab === key ? "page" : undefined}
          >
            <Icon name={icon} />
            {label}
            {tabCounts[key] != null && (
              <span className="tab-count">{tabCounts[key]}</span>
            )}
          </a>
        ))}
      </nav>

      {tab === "overview" && (
        <>
          <section className="kpi-grid" aria-label="Synthèse du phénotypage">
            <Kpi
              label="Modules actifs"
              value={activeModuleIds.size}
              icon="module"
              hint="pour ce programme"
              href={tabHref("setup")}
            />
            <Kpi
              label="Traits suivis"
              value={activeTraits.length}
              icon="trait"
              hint={`${weighted.length} pondéré(s) dans le score`}
              href={tabHref("setup")}
            />
            <Kpi
              label="Phénotypes évalués"
              value={new Set(evaluations.map((item) => item.phenotype_id)).size}
              icon="evaluation"
              hint={`${phenotypes.length} enregistré(s)`}
              href={tabHref("evaluations")}
            />
            <Kpi
              label="Évaluations classées"
              value={scored.length}
              icon="score"
              hint={`${scored.filter((item) => item.automatic_decision === "elite").length} Elite`}
              href={tabHref("ranking")}
            />
          </section>
          <section className="dashboard-columns">
            <Card>
              <h2 className="icon-heading">
                <Icon name="score" size={18} />
                Meilleurs individus
              </h2>
              {scored.length ? (
                <RankingTable
                  rows={scored.slice(0, 5)}
                  phenotypeName={phenotypeName}
                />
              ) : (
                <p className="inspector-note">
                  Aucune évaluation classée. Les évaluations sont classées
                  lorsque tous les traits pondérés du modèle sont mesurés.
                </p>
              )}
            </Card>
            <div className="grid-stack">
              <Card>
                <h2 className="icon-heading">
                  <Icon name="module" size={18} />
                  Modules du programme
                </h2>
                {activeModuleIds.size ? (
                  <ul className="task-list">
                    {modules
                      .filter((module) => activeModuleIds.has(module.id))
                      .map((module) => (
                        <li key={module.id}>
                          <Icon name="module" />
                          <span>{module.name}</span>
                          <span className="chip">
                            {traitsOfModule(module.id).length} traits
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="inspector-note">
                    Aucun module actif. Configurez le phénotypage du programme.
                  </p>
                )}
              </Card>
              <Card>
                <h2 className="icon-heading">
                  <Icon name="history" size={18} />
                  Dernières évaluations
                </h2>
                {evaluations.length ? (
                  <ul className="task-list">
                    {evaluations.slice(0, 5).map((item) => (
                      <li key={item.id}>
                        <span className="num muted">
                          {formatDay(item.evaluation_date)}
                        </span>
                        <strong className="code">
                          {phenotypeName(item.phenotype_id)}
                        </strong>
                        {item.automatic_decision ? (
                          <DecisionBadge decision={item.automatic_decision} />
                        ) : (
                          <StatusBadge tone="info">Observation</StatusBadge>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="inspector-note">
                    Aucune évaluation enregistrée.
                  </p>
                )}
              </Card>
            </div>
          </section>
        </>
      )}

      {tab === "traits" && (
        <section className="section-block">
          <div className="register-header">
            <div>
              <h2>
                <Icon name="library" size={18} />
                Bibliothèque de traits
              </h2>
              <p>
                Traits partagés par l’équipe {team.name}. Un trait archivé n’est
                plus proposé mais ses observations sont conservées.
              </p>
            </div>
            <div className="register-actions">
              <FormDrawer
                label="Nouveau trait"
                title="Nouveau trait"
                description="Définissez une mesure réutilisable : type, unité, bornes et protocole."
              >
                <ActionForm
                  action={createTrait}
                  actionName="trait"
                  className="form"
                  submitLabel="Créer le trait"
                >
                  <TraitFields />
                </ActionForm>
              </FormDrawer>
            </div>
          </div>
          <div className="register-toolbar">
            <form method="get" role="search">
              <input type="hidden" name="program" value={programId ?? ""} />
              <input type="hidden" name="tab" value="traits" />
              <label className="sr-only" htmlFor="trait-search">
                Rechercher un trait
              </label>
              <input
                id="trait-search"
                type="search"
                name="q"
                defaultValue={params.q}
                placeholder="Nom ou code du trait"
              />
              <label className="sr-only" htmlFor="trait-category">
                Catégorie
              </label>
              <select
                id="trait-category"
                name="category"
                defaultValue={params.category ?? ""}
              >
                <option value="">Toutes les catégories</option>
                {Object.entries(categoryLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <button className="secondary">
                <Icon name="filter" />
                Filtrer
              </button>
            </form>
          </div>
          <Card className="flush">
            {shownTraits.length ? (
              <DataTable label="Bibliothèque de traits">
                <table>
                  <thead>
                    <tr>
                      <th>Trait</th>
                      <th>Catégorie</th>
                      <th>Type</th>
                      <th>Plage / valeurs</th>
                      <th>Direction</th>
                      <th>Modules</th>
                      <th>État</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownTraits.map((trait) => (
                      <tr
                        key={trait.id}
                        className={trait.is_active ? "" : "archived-row"}
                      >
                        <td>
                          <strong>{trait.name}</strong>
                          <span className="secondary-line code">
                            {trait.code}
                          </span>
                        </td>
                        <td>{categoryLabels[trait.category]}</td>
                        <td>
                          <span className="chip type">
                            {typeLabels[trait.data_type]}
                          </span>
                        </td>
                        <td className="num">{formatRange(trait)}</td>
                        <td>{directionLabels[trait.direction]}</td>
                        <td className="num">
                          {modulesOfTrait(trait.id).length}
                        </td>
                        <td>
                          {trait.is_active ? (
                            <StatusBadge tone="success">Actif</StatusBadge>
                          ) : (
                            <StatusBadge tone="archived">Archivé</StatusBadge>
                          )}
                        </td>
                        <td className="cell-actions">
                          <div className="register-actions">
                            <FormDrawer
                              label="Détails"
                              icon="inspect"
                              variant="secondary"
                              title={trait.name}
                              description={`${categoryLabels[trait.category]} · ${typeLabels[trait.data_type]}`}
                            >
                              <TraitDetails
                                trait={trait}
                                modules={modulesOfTrait(trait.id).map(
                                  (module) => module.name,
                                )}
                                programs={[
                                  ...new Set(
                                    modulesOfTrait(trait.id).flatMap((module) =>
                                      programsOfModule(module.id).map((item) =>
                                        programName(item.program_id),
                                      ),
                                    ),
                                  ),
                                ]}
                              />
                              <ActionForm
                                action={updateTrait}
                                actionName={`trait-edit-${trait.id}`}
                                className="form"
                                submitLabel="Enregistrer le trait"
                                resetOnSuccess={false}
                              >
                                <h3>Modifier</h3>
                                <input
                                  type="hidden"
                                  name="id"
                                  value={trait.id}
                                />
                                <TraitFields trait={trait} />
                              </ActionForm>
                            </FormDrawer>
                            <ActionMenu label={`Actions pour ${trait.name}`}>
                              <ActionForm
                                action={setTraitActive}
                                actionName={`trait-active-${trait.id}`}
                                className="entity-lifecycle-form"
                                submitLabel={
                                  trait.is_active ? "Archiver" : "Restaurer"
                                }
                                revealOnFlash={false}
                              >
                                <input
                                  type="hidden"
                                  name="id"
                                  value={trait.id}
                                />
                                <input
                                  type="hidden"
                                  name="active"
                                  value={trait.is_active ? "false" : "true"}
                                />
                              </ActionForm>
                            </ActionMenu>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataTable>
            ) : (
              <EmptyState
                title="Aucun trait"
                message={
                  query || params.category
                    ? "Aucun trait ne correspond au filtre."
                    : "Créez le premier trait de la bibliothèque."
                }
              />
            )}
          </Card>
        </section>
      )}

      {tab === "modules" && (
        <section className="section-block">
          <div className="register-header">
            <div>
              <h2>
                <Icon name="module" size={18} />
                Modules de phénotypage
              </h2>
              <p>
                Un module regroupe des traits ordonnés (floraison, rendement,
                qualité…). Les programmes activent les modules qu’ils suivent.
              </p>
            </div>
            <div className="register-actions">
              <FormDrawer
                label="Nouveau module"
                title="Nouveau module"
                description="Nommez le module et choisissez ses traits ; l’ordre suit la sélection."
              >
                <ActionForm
                  action={createModule}
                  actionName="module"
                  className="form"
                  submitLabel="Créer le module"
                >
                  <label>
                    Nom du module
                    <input name="name" required maxLength={120} />
                  </label>
                  <label>
                    Description
                    <textarea name="description" maxLength={1000} rows={2} />
                  </label>
                  <fieldset className="form-section">
                    <legend>Traits</legend>
                    <div className="checklist">
                      {traits
                        .filter((trait) => trait.is_active)
                        .map((trait) => (
                          <label key={trait.id}>
                            <input
                              type="checkbox"
                              name="trait_id"
                              value={trait.id}
                            />
                            {trait.name}
                            <span className="chip type">
                              {typeLabels[trait.data_type]}
                            </span>
                          </label>
                        ))}
                    </div>
                  </fieldset>
                </ActionForm>
              </FormDrawer>
            </div>
          </div>
          {modules.length ? (
            <div className="module-grid">
              {modules.map((module) => {
                const members = traitsOfModule(module.id);
                const available = traits.filter(
                  (trait) =>
                    trait.is_active &&
                    !members.some((member) => member.id === trait.id),
                );
                return (
                  <Card
                    key={module.id}
                    className={`module-card${module.is_active ? "" : " inactive"}`}
                  >
                    <header>
                      <div>
                        <h3>
                          <Icon name="module" />
                          {module.name}
                        </h3>
                        <p>
                          {module.description ?? "Sans description"} ·{" "}
                          {programsOfModule(module.id)
                            .map((item) => programName(item.program_id))
                            .join(", ") || "aucun programme"}
                        </p>
                      </div>
                      <div className="register-actions">
                        {!module.is_active && (
                          <StatusBadge tone="archived">Archivé</StatusBadge>
                        )}
                        <ActionMenu label={`Actions pour ${module.name}`}>
                          <ActionForm
                            action={setModuleActive}
                            actionName={`module-active-${module.id}`}
                            className="entity-lifecycle-form"
                            submitLabel={
                              module.is_active ? "Archiver" : "Restaurer"
                            }
                            revealOnFlash={false}
                          >
                            <input type="hidden" name="id" value={module.id} />
                            <input
                              type="hidden"
                              name="active"
                              value={module.is_active ? "false" : "true"}
                            />
                          </ActionForm>
                        </ActionMenu>
                      </div>
                    </header>
                    {members.length ? (
                      <ol className="trait-order">
                        {members.map((trait, index) => (
                          <li key={trait.id}>
                            <span className="trait-name">
                              <strong>{trait.name}</strong>
                              <small>
                                {trait.code} · {typeLabels[trait.data_type]}
                                {trait.unit ? ` · ${trait.unit}` : ""}
                              </small>
                            </span>
                            <span className="mini-actions">
                              <ModuleTraitButton
                                moduleId={module.id}
                                traitId={trait.id}
                                operation="up"
                                disabled={index === 0}
                              />
                              <ModuleTraitButton
                                moduleId={module.id}
                                traitId={trait.id}
                                operation="down"
                                disabled={index === members.length - 1}
                              />
                              <ModuleTraitButton
                                moduleId={module.id}
                                traitId={trait.id}
                                operation="remove"
                              />
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="inspector-note">
                        Aucun trait dans ce module.
                      </p>
                    )}
                    {available.length > 0 && (
                      <ActionForm
                        action={changeModuleTrait}
                        actionName={`module-add-${module.id}`}
                        className="inline-form"
                        submitLabel="Ajouter"
                      >
                        <input
                          type="hidden"
                          name="module_id"
                          value={module.id}
                        />
                        <input type="hidden" name="operation" value="add" />
                        <label>
                          <span className="sr-only">
                            Ajouter un trait à {module.name}
                          </span>
                          <select name="trait_id" required>
                            <option value="">Ajouter un trait…</option>
                            {available.map((trait) => (
                              <option key={trait.id} value={trait.id}>
                                {trait.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </ActionForm>
                    )}
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <EmptyState
                title="Aucun module"
                message="Créez un module pour regrouper les traits mesurés ensemble."
              />
            </Card>
          )}
        </section>
      )}

      {tab === "setup" &&
        (!program ? (
          <NoProgram />
        ) : (
          <section className="section-block">
            <div className="register-header">
              <div>
                <h2>
                  <Icon name="setup" size={18} />
                  Configurer le phénotypage · {program.code}
                </h2>
                <p>
                  Activez les modules suivis par ce programme. Seuls leurs
                  traits apparaissent dans les formulaires d’évaluation.
                </p>
              </div>
            </div>
            <div className="module-grid">
              {modules
                .filter(
                  (module) =>
                    module.is_active || activeModuleIds.has(module.id),
                )
                .map((module) => {
                  const active = activeModuleIds.has(module.id);
                  return (
                    <Card
                      key={module.id}
                      className={`module-card${active ? "" : " inactive"}`}
                    >
                      <header>
                        <div>
                          <h3>
                            <Icon name="module" />
                            {module.name}
                          </h3>
                          <p>
                            {traitsOfModule(module.id)
                              .map((trait) => trait.name)
                              .join(" · ") || "Aucun trait"}
                          </p>
                        </div>
                        <ActionForm
                          action={setProgramModule}
                          actionName={`program-module-${module.id}`}
                          className="inline-action"
                          submitLabel={active ? "Désactiver" : "Activer"}
                          revealOnFlash={false}
                        >
                          <input
                            type="hidden"
                            name="program_id"
                            value={program.id}
                          />
                          <input
                            type="hidden"
                            name="module_id"
                            value={module.id}
                          />
                          <input
                            type="hidden"
                            name="active"
                            value={active ? "false" : "true"}
                          />
                        </ActionForm>
                      </header>
                      <StatusBadge tone={active ? "success" : "neutral"}>
                        {active ? "Suivi par le programme" : "Non suivi"}
                      </StatusBadge>
                    </Card>
                  );
                })}
            </div>

            <Card className="flush">
              <div className="card-heading">
                <h2 className="icon-heading">
                  <Icon name="score" size={18} />
                  Traits suivis et pondération
                </h2>
                <p className="form-hint">
                  {model
                    ? `Modèle « ${model.name} » · score maximal ${model.maximum_score}. Un trait sans poids reste observé sans entrer dans le score.`
                    : "Aucun modèle de sélection : les évaluations sont enregistrées comme observations, sans classement."}
                </p>
              </div>
              {activeTraits.length ? (
                <DataTable label="Traits suivis">
                  <table>
                    <thead>
                      <tr>
                        <th>Trait</th>
                        <th>Module</th>
                        <th>Type</th>
                        <th>Plage</th>
                        <th>Direction</th>
                        <th>Poids dans le score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeTraits.map((trait) => (
                        <tr key={trait.trait_id}>
                          <td>
                            <strong>{trait.name}</strong>
                            <span className="secondary-line code">
                              {trait.code}
                            </span>
                          </td>
                          <td>{trait.module_name}</td>
                          <td>
                            <span className="chip type">
                              {typeLabels[trait.data_type]}
                            </span>
                          </td>
                          <td className="num">{formatRange(trait)}</td>
                          <td>{directionLabels[trait.direction]}</td>
                          <td>
                            {model &&
                            isRanged(trait.data_type) &&
                            trait.minimum_value != null &&
                            trait.maximum_value != null ? (
                              <ActionForm
                                action={setTraitWeight}
                                actionName={`weight-${trait.code}`}
                                className="inline-action"
                                submitLabel="Appliquer"
                                resetOnSuccess={false}
                                revealOnFlash={false}
                              >
                                <input
                                  type="hidden"
                                  name="program_id"
                                  value={program.id}
                                />
                                <input
                                  type="hidden"
                                  name="trait_id"
                                  value={trait.trait_id}
                                />
                                <label
                                  className="sr-only"
                                  htmlFor={`weight-${trait.code}`}
                                >
                                  Poids de {trait.name}
                                </label>
                                <input
                                  id={`weight-${trait.code}`}
                                  name="coefficient"
                                  type="number"
                                  min="0.1"
                                  max="100"
                                  step="0.1"
                                  placeholder="Non pondéré"
                                  defaultValue={trait.coefficient ?? ""}
                                  className="weight-input"
                                />
                              </ActionForm>
                            ) : (
                              <span className="muted">Observation</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DataTable>
              ) : (
                <EmptyState
                  title="Aucun trait suivi"
                  message="Activez au moins un module pour générer le formulaire d’évaluation."
                />
              )}
            </Card>
            <Card>
              <div className="register-header">
                <div>
                  <h2>
                    <Icon name="score" size={18} />
                    Modèle de sélection
                  </h2>
                  <p>
                    {model
                      ? `« ${model.name} » est actif. Les poids ci-dessus modifient ses critères ; les règles Elite, Advance, Reserve et Eliminate restent celles du modèle.`
                      : "Créez le modèle initial pour classer les évaluations : six critères V1 liés à la bibliothèque et règles Elite, Advance, Reserve, Eliminate."}
                  </p>
                </div>
                <FormDrawer
                  label={model ? "Nouveau modèle initial" : "Créer le modèle"}
                  title="Modèle de sélection initial"
                  description="Crée les six critères V1 (module « Sélection V1 ») et les règles de décision."
                  icon="score"
                  variant={model ? "secondary" : "primary"}
                >
                  <ActionForm
                    action={createInitialModel}
                    className="form"
                    actionName="model"
                    submitLabel="Créer le modèle"
                  >
                    <input type="hidden" name="program_id" value={program.id} />
                    <label>
                      Nom
                      <input name="name" required maxLength={160} />
                    </label>
                  </ActionForm>
                </FormDrawer>
              </div>
            </Card>
          </section>
        ))}

      {tab === "evaluations" &&
        (!program ? (
          <NoProgram />
        ) : (
          <section className="evaluation-layout">
            <div className="grid-stack">
              <Card>
                <h2 className="icon-heading">
                  <Icon name="evaluation" size={18} />
                  Nouvelle évaluation
                </h2>
                {activeTraits.length && phenotypes.length ? (
                  <ActionForm
                    action={submitTraitEvaluation}
                    className="form"
                    actionName="evaluation"
                    submitLabel="Enregistrer l’évaluation"
                  >
                    <input type="hidden" name="program_id" value={program.id} />
                    <div className="fields-2">
                      <label>
                        Phénotype
                        <select name="phenotype_id" required>
                          <option value="">Choisir</option>
                          {phenotypes.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.phenotype_code}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Date
                        <input type="date" name="evaluation_date" required />
                      </label>
                    </div>
                    <MeasureProgress total={activeTraits.length} />
                    {groupedActive.map((group) => (
                      <fieldset className="measure-group" key={group.module}>
                        <legend>
                          <Icon name="module" size={14} />
                          {group.module}
                        </legend>
                        {group.traits.map((trait) => (
                          <MeasureRow key={trait.trait_id} trait={trait} />
                        ))}
                      </fieldset>
                    ))}
                    <label>
                      Notes
                      <textarea name="notes" maxLength={1000} rows={2} />
                    </label>
                    <p className="form-hint">
                      {weighted.length
                        ? `L’évaluation est classée si les ${weighted.length} traits pondérés sont mesurés ; sinon elle reste une observation.`
                        : "Aucun trait pondéré : l’évaluation est enregistrée comme observation."}
                    </p>
                  </ActionForm>
                ) : (
                  <EmptyState
                    title="Évaluation indisponible"
                    message={
                      activeTraits.length
                        ? "Créez d’abord un phénotype."
                        : "Activez au moins un module dans la configuration du programme."
                    }
                  />
                )}
              </Card>
            </div>
            <div className="grid-stack">
              <Card className="flush">
                <div className="card-heading register-header">
                  <h2>
                    <Icon name="plant" size={18} />
                    Phénotypes
                  </h2>
                  <FormDrawer
                    label="Nouveau phénotype"
                    title="Nouveau phénotype"
                    description="Le code individu est attribué automatiquement."
                    disabled={!families.length || !lots.length}
                    disabledReason="Une famille et un lot actifs sont nécessaires"
                  >
                    <ActionForm
                      action={createPhenotype}
                      className="form"
                      actionName="phenotype"
                      submitLabel="Créer le phénotype"
                    >
                      <input
                        type="hidden"
                        name="program_id"
                        value={program.id}
                      />
                      <label>
                        Famille
                        <select name="family_id" required>
                          <option value="">Choisir</option>
                          {families.map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.family_code}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Lot
                        <select name="seed_lot_id" required>
                          <option value="">Choisir</option>
                          {lots.map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.seed_lot_code}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="fields-3">
                        <label>
                          Bloc
                          <input name="block" maxLength={40} />
                        </label>
                        <label>
                          Répétition
                          <input
                            name="replicate"
                            type="number"
                            min="1"
                            required
                          />
                        </label>
                        <label>
                          Lieu
                          <input name="location" maxLength={160} />
                        </label>
                      </div>
                    </ActionForm>
                  </FormDrawer>
                </div>
                {phenotypes.length ? (
                  <DataTable label="Registre des phénotypes">
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Famille</th>
                          <th>Lot</th>
                          <th className="num">Éval.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {phenotypes.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <strong className="code">
                                {item.phenotype_code}
                              </strong>
                            </td>
                            <td className="code">
                              {familyName(item.family_id)}
                            </td>
                            <td className="code">
                              {lotName(item.seed_lot_id)}
                            </td>
                            <td className="num">
                              {
                                evaluations.filter(
                                  (evaluation) =>
                                    evaluation.phenotype_id === item.id,
                                ).length
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </DataTable>
                ) : (
                  <EmptyState
                    title="Aucun phénotype"
                    message="Créez un phénotype lié à une famille et un lot."
                  />
                )}
              </Card>
              <Card>
                <h2 className="icon-heading">
                  <Icon name="history" size={18} />
                  Mesures récentes
                </h2>
                {latestEvaluationIds.length ? (
                  <ul className="task-list">
                    {evaluations.slice(0, 8).map((evaluation) => (
                      <li key={evaluation.id} className="measure-history">
                        <span className="num muted">
                          {formatDay(evaluation.evaluation_date)}
                        </span>
                        <span>
                          <strong className="code">
                            {phenotypeName(evaluation.phenotype_id)}
                          </strong>
                          <span className="secondary-line">
                            {values
                              .filter(
                                (value) =>
                                  value.phenotype_evaluation_id ===
                                  evaluation.id,
                              )
                              .map((value) => {
                                const trait = traitById.get(value.trait_id);
                                return `${trait?.name ?? "?"} ${formatObservation(value, trait?.unit ?? null)}`;
                              })
                              .join(" · ") || "Scores historiques"}
                          </span>
                        </span>
                        {evaluation.automatic_decision ? (
                          <DecisionBadge
                            decision={evaluation.automatic_decision}
                          />
                        ) : (
                          <StatusBadge tone="info">Observation</StatusBadge>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="inspector-note">Aucune mesure enregistrée.</p>
                )}
              </Card>
            </div>
          </section>
        ))}

      {tab === "ranking" && (
        <section className="section-block">
          <div className="register-header">
            <div>
              <h2>
                <Icon name="score" size={18} />
                Classement
              </h2>
              <p>
                Évaluations classées par score normalisé décroissant ; les
                observations sans score complet n’apparaissent pas ici.
              </p>
            </div>
          </div>
          <Card className="flush">
            {scored.length ? (
              <RankingTable rows={scored} phenotypeName={phenotypeName} />
            ) : (
              <EmptyState
                title="Aucune évaluation classée"
                message="Mesurez tous les traits pondérés d’un phénotype pour obtenir un score et une décision."
              />
            )}
          </Card>
        </section>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  hint,
  href,
}: {
  label: string;
  value: number;
  icon: IconName;
  hint: string;
  href: string;
}) {
  return (
    <a className="kpi" href={href}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-icon">
        <Icon name={icon} size={18} />
      </span>
      <strong className="kpi-value">{value}</strong>
      <span className="kpi-hint">{hint}</span>
    </a>
  );
}

function NoProgram() {
  return (
    <EmptyState
      title="Aucun programme"
      message="Créez un programme avant de configurer le phénotypage."
      action={{ label: "Créer un programme", href: "/app" }}
    />
  );
}

function RankingTable({
  rows,
  phenotypeName,
}: {
  rows: {
    id: string;
    phenotype_id: string;
    evaluation_date: string | null;
    weighted_score: number | null;
    normalized_score: number | null;
    automatic_decision: string | null;
  }[];
  phenotypeName: (id: string) => string;
}) {
  return (
    <DataTable label="Classement des évaluations">
      <table>
        <thead>
          <tr>
            <th className="num">Rang</th>
            <th>Phénotype</th>
            <th className="num">Pondéré</th>
            <th>Normalisé</th>
            <th>Décision</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={item.id}>
              <td className="num">{index + 1}</td>
              <td>
                <strong className="code">
                  {phenotypeName(item.phenotype_id)}
                </strong>
              </td>
              <td className="num">{item.weighted_score}</td>
              <td className="num">
                {item.normalized_score} %
                <span className="score-bar" aria-hidden="true">
                  <span
                    style={{
                      width: `${Math.min(100, Number(item.normalized_score) || 0)}%`,
                    }}
                  />
                </span>
              </td>
              <td>
                <DecisionBadge decision={item.automatic_decision} />
              </td>
              <td className="num">{formatDay(item.evaluation_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTable>
  );
}

function ModuleTraitButton({
  moduleId,
  traitId,
  operation,
  disabled = false,
}: {
  moduleId: string;
  traitId: string;
  operation: "up" | "down" | "remove";
  disabled?: boolean;
}) {
  const labels = { up: "Monter", down: "Descendre", remove: "Retirer" };
  return (
    <ActionForm
      action={changeModuleTrait}
      actionName={`module-${operation}-${moduleId}-${traitId}`}
      className="mini-form"
      submitLabel={labels[operation]}
      submitContent={
        <Icon name={operation === "remove" ? "remove" : operation} size={14} />
      }
      disabled={disabled}
      revealOnFlash={false}
    >
      <input type="hidden" name="module_id" value={moduleId} />
      <input type="hidden" name="trait_id" value={traitId} />
      <input type="hidden" name="operation" value={operation} />
    </ActionForm>
  );
}

function TraitDetails({
  trait,
  modules,
  programs,
}: {
  trait: Trait;
  modules: string[];
  programs: string[];
}) {
  const fields: [string, string][] = [
    ["Code", trait.code],
    ["Catégorie", categoryLabels[trait.category]],
    ["Type", typeLabels[trait.data_type]],
    ["Unité", trait.unit ?? "—"],
    ["Plage / valeurs", formatRange(trait)],
    [
      "Précision",
      trait.decimal_places == null
        ? "—"
        : `${trait.decimal_places} décimale(s)`,
    ],
    ["Direction", directionLabels[trait.direction]],
    [
      "Valeur cible",
      trait.target_value == null ? "—" : String(trait.target_value),
    ],
    ["Modules", modules.join(", ") || "Aucun"],
    ["Programmes", programs.join(", ") || "Aucun"],
  ];
  return (
    <section className="trait-details">
      <dl className="detail-list">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {trait.description && (
        <p className="inspector-prose">{trait.description}</p>
      )}
      {trait.protocol && (
        <>
          <h3 className="icon-heading">
            <Icon name="measure" size={14} />
            Protocole de mesure
          </h3>
          <p className="inspector-prose">{trait.protocol}</p>
        </>
      )}
    </section>
  );
}

function TraitFields({ trait }: { trait?: Trait }) {
  return (
    <>
      <div className="fields-2">
        <label>
          Nom
          <input
            name="name"
            required
            maxLength={160}
            defaultValue={trait?.name}
          />
        </label>
        <label>
          Code
          <input
            name="code"
            required
            maxLength={60}
            pattern="[a-z0-9][a-z0-9_]*"
            placeholder="plant_height"
            defaultValue={trait?.code}
          />
        </label>
      </div>
      <div className="fields-2">
        <label>
          Catégorie
          <select name="category" defaultValue={trait?.category ?? "other"}>
            {Object.entries(categoryLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type de donnée
          <select name="data_type" defaultValue={trait?.data_type ?? "numeric"}>
            {Object.entries(typeLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="form-section">
        <legend>Mesure (numérique, entier, ordinal)</legend>
        <div className="fields-3">
          <label>
            Minimum
            <input
              name="minimum_value"
              type="number"
              step="any"
              defaultValue={trait?.minimum_value ?? ""}
            />
          </label>
          <label>
            Maximum
            <input
              name="maximum_value"
              type="number"
              step="any"
              defaultValue={trait?.maximum_value ?? ""}
            />
          </label>
          <label>
            Unité
            <input
              name="unit"
              maxLength={30}
              placeholder="cm, j, %"
              defaultValue={trait?.unit ?? ""}
            />
          </label>
        </div>
        <div className="fields-2">
          <label>
            Décimales
            <input
              name="decimal_places"
              type="number"
              min="0"
              max="6"
              defaultValue={trait?.decimal_places ?? ""}
            />
          </label>
          <label>
            Direction de sélection
            <select
              name="direction"
              defaultValue={trait?.direction ?? "neutral"}
            >
              {Object.entries(directionLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Valeur cible
          <input
            name="target_value"
            type="number"
            step="any"
            defaultValue={trait?.target_value ?? ""}
          />
        </label>
      </fieldset>
      <fieldset className="form-section">
        <legend>Catégoriel</legend>
        <label>
          Valeurs autorisées
          <textarea
            name="allowed_values"
            rows={2}
            maxLength={1000}
            placeholder="Une valeur par ligne ou séparées par des virgules"
            defaultValue={trait?.allowed_values?.join("\n") ?? ""}
          />
        </label>
      </fieldset>
      <fieldset className="form-section">
        <legend>Documentation</legend>
        <label>
          Description
          <textarea
            name="description"
            rows={2}
            maxLength={1000}
            defaultValue={trait?.description ?? ""}
          />
        </label>
        <label>
          Protocole de mesure
          <textarea
            name="protocol"
            rows={3}
            maxLength={2000}
            defaultValue={trait?.protocol ?? ""}
          />
        </label>
      </fieldset>
    </>
  );
}

// One measurement row: input rendered from the trait data type, bounds,
// precision and unit. PostgreSQL re-validates every value on submit.
function MeasureRow({ trait }: { trait: ActiveTrait }) {
  const id = `measure-${trait.code}`;
  const name = `trait:${trait.code}`;
  const range = formatRange(trait);
  let control;
  if (trait.data_type === "categorical")
    control = (
      <select id={id} name={name} defaultValue="">
        <option value="">—</option>
        {(trait.allowed_values ?? []).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    );
  else if (trait.data_type === "boolean")
    control = (
      <select id={id} name={name} defaultValue="">
        <option value="">—</option>
        <option value="true">Oui</option>
        <option value="false">Non</option>
      </select>
    );
  else if (
    trait.data_type === "ordinal" &&
    trait.minimum_value != null &&
    trait.maximum_value != null &&
    trait.maximum_value - trait.minimum_value <= 20
  )
    control = (
      <select id={id} name={name} defaultValue="">
        <option value="">—</option>
        {Array.from(
          { length: trait.maximum_value - trait.minimum_value + 1 },
          (_, index) => Number(trait.minimum_value) + index,
        ).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    );
  else if (trait.data_type === "date")
    control = <input id={id} name={name} type="date" />;
  else if (trait.data_type === "text")
    control = <input id={id} name={name} maxLength={1000} />;
  else
    control = (
      <input
        id={id}
        name={name}
        type="number"
        inputMode="decimal"
        min={trait.minimum_value ?? undefined}
        max={trait.maximum_value ?? undefined}
        step={inputStep(trait)}
      />
    );
  return (
    <div className="measure-row">
      <label htmlFor={id}>
        {trait.name}
        <span className="measure-meta">
          <span className="chip type">{typeLabels[trait.data_type]}</span>
          {range !== "—" && <span className="chip">{range}</span>}
          {trait.coefficient != null && (
            <span className="chip weight">×{trait.coefficient}</span>
          )}
        </span>
      </label>
      <span className="measure-input">
        {control}
        {trait.unit && <span className="unit">{trait.unit}</span>}
      </span>
    </div>
  );
}
