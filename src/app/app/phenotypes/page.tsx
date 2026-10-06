import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import {
  Breadcrumbs,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgramContext,
  StatusBadge,
} from "@/components/ui";
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
      .select("id,code,name")
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
  return (
    <div className="page">
      <Breadcrumbs
        items={[{ label: "Accueil", href: "/app" }, { label: "Phénotypes" }]}
      />
      <PageHeader
        eyebrow="Sélection"
        title="Notation phénotypique"
        description="Configurez le modèle, évaluez les individus et comparez les décisions calculées par PostgreSQL."
      />
      <ProgramContext team={team.name} program={program} />
      <nav className="program-nav">
        {programs?.map((item) => (
          <Link
            className={item.id === programId ? "active" : ""}
            key={item.id}
            href={`/app/phenotypes?program=${item.id}`}
          >
            {item.code}
          </Link>
        ))}
      </nav>
      {!program ? (
        <EmptyState
          title="Aucun programme"
          message="Créez un programme avant d’enregistrer des phénotypes."
          action={{ label: "Créer un programme", href: "/app" }}
        />
      ) : (
        <>
          <section className="grid-2">
            <ActionForm
              action={createInitialModel}
              className="card form"
              actionName="model"
              submitLabel="Créer le modèle"
            >
              <h2>Nouveau modèle initial</h2>
              <input type="hidden" name="program_id" value={programId} />
              <label>
                Nom
                <input name="name" required maxLength={160} />
              </label>
              <p>
                <small>
                  Crée en base les six critères V1 et les règles Elite, Advance,
                  Reserve, Eliminate.
                </small>
              </p>
            </ActionForm>
            <ActionForm
              action={createPhenotype}
              className="card form"
              actionName="phenotype"
              submitLabel="Créer le phénotype"
              disabled={!families.length || !lots.length}
            >
              <h2>Nouveau phénotype</h2>
              <input type="hidden" name="program_id" value={programId} />
              <p className="generated-code-hint">
                Le code individu sera attribué automatiquement à
                l’enregistrement.
              </p>
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
                  <input name="replicate" type="number" min="1" required />
                </label>
                <label>
                  Lieu
                  <input name="location" maxLength={160} />
                </label>
              </div>
              {(!families.length || !lots.length) && (
                <p className="form-hint">
                  Créez d’abord une famille et un lot de graines.
                </p>
              )}
            </ActionForm>
          </section>
          <section className="card">
            <h2>Modèles et critères</h2>
            <nav className="program-nav">
              {models.map((item) => (
                <Link
                  className={item.id === model?.id ? "active" : ""}
                  key={item.id}
                  href={`/app/phenotypes?program=${programId}&model=${item.id}`}
                >
                  {item.name} · max {item.maximum_score}
                </Link>
              ))}
            </nav>
            {model && (
              <div className="criteria-grid">
                {criteria?.map((item) => (
                  <ActionForm
                    action={updateCriterion}
                    className="form"
                    actionName={`criterion-${item.code}`}
                    submitLabel="Modifier"
                    key={item.id}
                  >
                    <input type="hidden" name="criterion_id" value={item.id} />
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
                    </label>
                    <small>
                      Note {item.minimum_value}–{item.maximum_value}
                    </small>
                  </ActionForm>
                ))}
              </div>
            )}
          </section>
          <section className="card table-wrap">
            <h2>Registre des phénotypes</h2>
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Famille</th>
                  <th>Lot</th>
                  <th>Bloc</th>
                  <th>Lieu</th>
                </tr>
              </thead>
              <tbody>
                {phenotypes.map((item) => (
                  <tr key={item.id}>
                    <td>{item.phenotype_code}</td>
                    <td>{familyName(item.family_id)}</td>
                    <td>{lotName(item.seed_lot_id)}</td>
                    <td>
                      {item.block || "—"} / {item.replicate}
                    </td>
                    <td>{item.location || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!phenotypes.length && (
              <EmptyState
                title="Aucun phénotype"
                message="Créez un phénotype lié à une famille et un lot."
              />
            )}
          </section>
          {model && (
            <section className="card">
              <h2>Nouvelle évaluation — {model.name}</h2>
              <ActionForm
                action={evaluatePhenotype}
                className="form"
                actionName="evaluation"
                submitLabel="Calculer et enregistrer"
                disabled={!phenotypes.length || !criteria?.length}
              >
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
                <input type="hidden" name="model_id" value={model.id} />
                <label>
                  Date
                  <input type="date" name="evaluation_date" required />
                </label>
                <div className="criteria-grid">
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
                {(!phenotypes.length || !criteria?.length) && (
                  <p className="form-hint">
                    Créez un phénotype et configurez un modèle avant
                    l’évaluation.
                  </p>
                )}
              </ActionForm>
            </section>
          )}
          <section className="card table-wrap">
            <h2>Classement</h2>
            <table>
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Phénotype</th>
                  <th>Modèle</th>
                  <th>Pondéré</th>
                  <th>Normalisé</th>
                  <th>Décision</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {evaluations?.map((item, index) => (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td>{phenotypeName(item.phenotype_id)}</td>
                    <td>{modelName(item.selection_model_id)}</td>
                    <td>{item.weighted_score}</td>
                    <td>{item.normalized_score} %</td>
                    <td>
                      <StatusBadge
                        tone={
                          item.automatic_decision === "elite"
                            ? "success"
                            : "neutral"
                        }
                      >
                        {item.automatic_decision}
                      </StatusBadge>
                    </td>
                    <td>{item.evaluation_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!evaluations?.length && (
              <EmptyState
                title="Aucune évaluation"
                message="Les résultats classés apparaîtront après la première notation."
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
