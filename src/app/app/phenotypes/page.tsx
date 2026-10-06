import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import {
  Breadcrumbs,
  Card,
  DataTable,
  DecisionBadge,
  EmptyState,
  ErrorState,
  MetricCard,
  PageHeader,
  ProgramContext,
  ProgramSwitch,
  SectionHeader,
} from "@/components/ui";
import { formatDay } from "@/lib/breeding-entity-details";
import { requireIdentity } from "@/lib/auth";
import { collectionState } from "@/lib/query-state";
import {
  createInitialModel,
  createPhenotype,
  evaluatePhenotype,
  updateCriterion,
} from "./actions";

export default async function Phenotypes({
  searchParams,
}: {
  searchParams: Promise<{ program?: string; model?: string }>;
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
        <ErrorState
          message={programsState.message}
          retryHref="/app/phenotypes"
        />
      </div>
    );
  const programs = programsState.data;
  const program =
    programs?.find((item) => item.id === params.program) ?? programs?.[0];
  const programId = program?.id;
  const [familiesResult, lotsResult, phenotypesResult, modelsResult] = programId
    ? await Promise.all([
        client
          .from("families")
          .select("id,family_code")
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("family_code"),
        client
          .from("seed_lots")
          .select("id,seed_lot_code,family_id")
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("seed_lot_code"),
        client
          .from("phenotypes")
          .select(
            "id,phenotype_code,family_id,seed_lot_id,block,replicate,location",
          )
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("phenotype_code"),
        client
          .from("selection_models")
          .select("id,name,version,maximum_score,is_active")
          .eq("program_id", programId)
          .is("deleted_at", null)
          .order("created_at"),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];
  const familiesState = collectionState(
    familiesResult,
    "Impossible de charger les familles.",
  );
  const lotsState = collectionState(
    lotsResult,
    "Impossible de charger les lots.",
  );
  const phenotypesState = collectionState(
    phenotypesResult,
    "Impossible de charger les phénotypes.",
  );
  const modelsState = collectionState(
    modelsResult,
    "Impossible de charger les modèles.",
  );
  const initialFailure = [
    familiesState,
    lotsState,
    phenotypesState,
    modelsState,
  ].find((state) => state.status === "error");
  if (initialFailure?.status === "error")
    return (
      <div className="page">
        <ErrorState
          message={initialFailure.message}
          retryHref={
            programId
              ? `/app/phenotypes?program=${programId}`
              : "/app/phenotypes"
          }
        />
      </div>
    );
  const families = familiesState.data;
  const lots = lotsState.data;
  const phenotypes = phenotypesState.data;
  const models = modelsState.data;
  const model = models.find((item) => item.id === params.model) ?? models[0];
  const criteriaState = collectionState(
    model
      ? await client
          .from("selection_criteria")
          .select(
            "id,code,name,coefficient,minimum_value,maximum_value,display_order",
          )
          .eq("selection_model_id", model.id)
          .is("deleted_at", null)
          .order("display_order")
      : { data: [], error: null },
    "Impossible de charger les critères.",
  );
  const phenotypeIds = phenotypes.map((item) => item.id);
  const evaluationsState = collectionState(
    phenotypeIds.length
      ? await client
          .from("phenotype_evaluations")
          .select(
            "id,phenotype_id,selection_model_id,evaluation_date,weighted_score,normalized_score,automatic_decision,validation_status",
          )
          .in("phenotype_id", phenotypeIds)
          .is("deleted_at", null)
          .order("weighted_score", { ascending: false })
      : { data: [], error: null },
    "Impossible de charger les évaluations.",
  );
  const laterFailure = [criteriaState, evaluationsState].find(
    (state) => state.status === "error",
  );
  if (laterFailure?.status === "error")
    return (
      <div className="page">
        <ErrorState
          message={laterFailure.message}
          retryHref={`/app/phenotypes?program=${programId}`}
        />
      </div>
    );
  const criteria = criteriaState.data;
  const evaluations = evaluationsState.data;
  const familyName = (value: string | null) =>
    families.find((item) => item.id === value)?.family_code ?? "—";
  const lotName = (value: string | null) =>
    lots.find((item) => item.id === value)?.seed_lot_code ?? "—";
  const phenotypeName = (value: string) =>
    phenotypes.find((item) => item.id === value)?.phenotype_code ?? "—";
  const modelName = (value: string) =>
    models.find((item) => item.id === value)?.name ?? "—";
  const elite = evaluations.filter(
    (item) => item.automatic_decision === "elite",
  ).length;
  const evaluatedPhenotypes = new Set(
    evaluations.map((item) => item.phenotype_id),
  ).size;
  const blockedPhenotype = !families.length || !lots.length;
  const blockedEvaluation = !phenotypes.length || !criteria?.length;
  return (
    <div className="page">
      <Breadcrumbs
        items={[{ label: "Accueil", href: "/app" }, { label: "Phénotypes" }]}
      />
      <PageHeader
        eyebrow="Sélection"
        title="Notation phénotypique"
        description="Évaluez les individus selon le modèle de sélection. Scores pondérés, normalisés et décisions sont calculés par PostgreSQL."
      />
      <ProgramContext team={team.name} program={program} />
      <ProgramSwitch
        programs={programs ?? []}
        activeId={programId}
        basePath="/app/phenotypes"
      />
      {!program ? (
        <EmptyState
          title="Aucun programme"
          message="Créez un programme avant d’enregistrer des phénotypes."
          action={{ label: "Créer un programme", href: "/app" }}
        />
      ) : (
        <>
          <section className="metrics-grid" aria-label="Synthèse phénotypique">
            <MetricCard label="Phénotypes" value={phenotypes.length} />
            <MetricCard label="Évalués" value={evaluatedPhenotypes} />
            <MetricCard label="Évaluations" value={evaluations.length} />
            <MetricCard label="Décisions Elite" value={elite} />
            <MetricCard label="Modèles" value={models.length} />
          </section>

          <section className="section-block">
            <SectionHeader
              title="Classement"
              description="Évaluations classées par score pondéré décroissant."
            />
            <Card className="flush">
              {evaluations?.length ? (
                <DataTable label="Classement des évaluations">
                  <table>
                    <thead>
                      <tr>
                        <th className="num">Rang</th>
                        <th>Phénotype</th>
                        <th>Modèle</th>
                        <th className="num">Pondéré</th>
                        <th>Normalisé</th>
                        <th>Décision</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evaluations.map((item, index) => (
                        <tr key={item.id}>
                          <td className="num">{index + 1}</td>
                          <td>
                            <strong className="code">
                              {phenotypeName(item.phenotype_id)}
                            </strong>
                          </td>
                          <td>{modelName(item.selection_model_id)}</td>
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
                          <td className="num">
                            {formatDay(item.evaluation_date)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DataTable>
              ) : (
                <EmptyState
                  title="Aucune évaluation"
                  message="Les résultats classés apparaîtront après la première notation."
                />
              )}
            </Card>
          </section>

          <section className="register-layout">
            <Card className="flush">
              <div className="card-heading">
                <h2>Registre des phénotypes</h2>
              </div>
              {phenotypes.length ? (
                <DataTable label="Registre des phénotypes">
                  <table>
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Famille</th>
                        <th>Lot</th>
                        <th>Bloc / rép.</th>
                        <th>Lieu</th>
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
                          <td className="code">{familyName(item.family_id)}</td>
                          <td className="code">{lotName(item.seed_lot_id)}</td>
                          <td className="num">
                            {item.block || "—"} / {item.replicate}
                          </td>
                          <td>{item.location || "—"}</td>
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
            {model ? (
              <ActionForm
                action={evaluatePhenotype}
                className="card form"
                actionName="evaluation"
                submitLabel="Calculer et enregistrer"
                disabled={blockedEvaluation}
              >
                <h3>Nouvelle évaluation</h3>
                <p className="form-hint">Modèle {model.name}</p>
                <input type="hidden" name="model_id" value={model.id} />
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
                <fieldset className="form-section">
                  <legend>Notes par critère</legend>
                  <div className="fields-2">
                    {criteria?.map((item) => (
                      <label key={item.id}>
                        {item.name} ×{item.coefficient}
                        <input
                          name={`score:${item.code}`}
                          type="number"
                          min={item.minimum_value}
                          max={item.maximum_value}
                          step="0.1"
                          required
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
                {blockedEvaluation && (
                  <p className="form-hint blocked">
                    Créez un phénotype et configurez un modèle avant
                    l’évaluation.
                  </p>
                )}
              </ActionForm>
            ) : (
              <Card>
                <EmptyState
                  title="Aucun modèle"
                  message="Créez le modèle initial ci-dessous pour évaluer les phénotypes."
                />
              </Card>
            )}
          </section>

          <section className="section-block">
            <SectionHeader
              eyebrow="Configuration"
              title="Phénotypes et modèle de sélection"
              description="Enregistrez de nouveaux individus et ajustez les coefficients des critères."
            />
            <div className="grid-2">
              <ActionForm
                action={createPhenotype}
                className="card form"
                actionName="phenotype"
                submitLabel="Créer le phénotype"
                disabled={blockedPhenotype}
              >
                <h3>Nouveau phénotype</h3>
                <input type="hidden" name="program_id" value={programId} />
                <p className="generated-code-hint">
                  Code individu attribué automatiquement
                </p>
                <div className="fields-2">
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
                </div>
                <div className="fields-3">
                  <label>
                    Bloc
                    <input name="block" maxLength={40} />
                  </label>
                  <label>
                    Répétition
                    <input name="replicate" type="number" min="1" required />
                  </label>
                  <label>
                    Lieu
                    <input name="location" maxLength={160} />
                  </label>
                </div>
                {blockedPhenotype && (
                  <p className="form-hint blocked">
                    Créez d’abord une famille et un lot de graines actifs.
                  </p>
                )}
              </ActionForm>
              <Card>
                <h3>Modèles et critères</h3>
                {models.length > 1 && (
                  <nav className="program-nav" aria-label="Modèles">
                    {models.map((item) => (
                      <Link
                        className={item.id === model?.id ? "active" : ""}
                        key={item.id}
                        href={`/app/phenotypes?program=${programId}&model=${item.id}`}
                      >
                        {item.name}
                      </Link>
                    ))}
                  </nav>
                )}
                {model ? (
                  <>
                    <p className="form-hint">
                      {model.name} · score maximal {model.maximum_score}
                    </p>
                    <div className="criteria-grid">
                      {criteria?.map((item) => (
                        <ActionForm
                          action={updateCriterion}
                          className="form"
                          actionName={`criterion-${item.code}`}
                          submitLabel="Modifier"
                          key={item.id}
                        >
                          <input
                            type="hidden"
                            name="criterion_id"
                            value={item.id}
                          />
                          <label>
                            {item.name}
                            <input
                              name="coefficient"
                              type="number"
                              min="0.1"
                              max="100"
                              step="0.1"
                              defaultValue={item.coefficient}
                              required
                            />
                            <small>
                              Note {item.minimum_value}–{item.maximum_value}
                            </small>
                          </label>
                        </ActionForm>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="form-hint">
                    Aucun modèle : créez le modèle initial ci-dessous.
                  </p>
                )}
                <hr />
                <ActionForm
                  action={createInitialModel}
                  className="form"
                  actionName="model"
                  submitLabel="Créer le modèle"
                >
                  <h3>Nouveau modèle initial</h3>
                  <input type="hidden" name="program_id" value={programId} />
                  <label>
                    Nom
                    <input name="name" required maxLength={160} />
                  </label>
                  <p className="form-hint">
                    Crée les six critères V1 et les règles Elite, Advance,
                    Reserve, Eliminate.
                  </p>
                </ActionForm>
              </Card>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
