import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import {
  Breadcrumbs,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgramContext,
  ProgramSwitch,
  StatusBadge,
} from "@/components/ui";
import { EntryEnvironmentHeatmap } from "@/components/met-charts";
import { MetRunResult } from "@/components/met-run-result";
import { requireIdentity } from "@/lib/auth";
import { collectionState } from "@/lib/query-state";
import { buildMetObservationDataset, listTrialTraits } from "@/lib/met/dataset";
import { evaluateMetEligibility } from "@/lib/met/eligibility";
import { computeEnvironmentRankStability } from "@/lib/met/rank-stability";
import { computeEntryEnvironmentCellMeans } from "@/lib/met/design-summary";
import { listTrials } from "../../trials/actions";
import {
  createMetAnalysisRun,
  getLatestMetAnalysisRun,
  importMetObservations,
  listMetAnalysisRuns,
} from "../met-actions";

const modelTypeLabels: Record<string, string> = {
  met_base_v1: "Modèle mixte de base",
  met_ammi_v1: "AMMI",
  met_waasb_v1: "WAASB / WAASBY",
  met_finlay_wilkinson_v1: "Finlay-Wilkinson",
  met_gge_v1: "GGE",
};

const fmt = (value: number | null | undefined, decimals = 2) =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(decimals);

/** Shared by both the "no observations yet" empty state and the main
 * results view below - importing is exactly how the former gets out of
 * being empty, so the form must be reachable from there too, not only
 * once a dataset already exists. */
function MetImportCard({
  programId,
  trialId,
  traitId,
}: {
  programId: string;
  trialId: string;
  traitId: string;
}) {
  return (
    <Card>
      <h3 className="chart-title">Importer des observations (CSV)</h3>
      <p className="chart-description">
        Colonnes requises : <code>phenotype_code</code>, <code>entry_code</code>
        , <code>environment_code</code>, <code>value</code> ; optionnelles :{" "}
        <code>block</code>, <code>evaluation_date</code>. Les entrées et
        environnements doivent déjà exister dans cet essai (
        <Link href="/app/trials">gérer l’essai</Link>) - l’import ne crée jamais
        d’identité à partir du fichier. Réimporter le même{" "}
        <code>phenotype_code</code> met à jour sa valeur plutôt que de créer un
        doublon.
      </p>
      <ActionForm
        action={importMetObservations}
        actionName="met-import-observations"
        submitLabel="Importer"
      >
        <input type="hidden" name="program_id" value={programId} />
        <input type="hidden" name="trial_id" value={trialId} />
        <input type="hidden" name="trait_id" value={traitId} />
        <label>
          Fichier CSV
          <input type="file" name="file" accept=".csv,text/csv" required />
        </label>
      </ActionForm>
    </Card>
  );
}

export default async function MultiEnvironmentAnalytics({
  searchParams,
}: {
  searchParams: Promise<{ program?: string; trial?: string; trait?: string }>;
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
  if (programsState.status === "error") {
    return (
      <div className="page">
        <ErrorState
          message={programsState.message}
          retryHref="/app/analytics/multi-environment"
        />
      </div>
    );
  }
  const programs = programsState.data;
  const program = programs.find((p) => p.id === params.program) ?? programs[0];
  const programId = program?.id;

  const breadcrumbs = (
    <Breadcrumbs
      items={[
        { label: "Accueil", href: "/app" },
        { label: "Analytique", href: "/app/analytics" },
        { label: "Multi-environnement" },
      ]}
    />
  );
  const header = (
    <PageHeader
      eyebrow="Stabilité G×E"
      title="Analyse multi-environnement"
      description="Diagnostic de conception, puis modèle statistique - chaque résultat reste traçable jusqu’aux observations brutes, et un jeu de données insuffisant retourne NOT_ESTIMABLE plutôt qu’un chiffre fabriqué."
    />
  );

  if (!programId) {
    return (
      <div className="page">
        {breadcrumbs}
        {header}
        <EmptyState
          title="Aucun programme"
          message="Créez un programme avant d’analyser un essai multi-environnement."
          action={{ label: "Créer un programme", href: "/app" }}
        />
      </div>
    );
  }

  const basePath = "/app/analytics/multi-environment";
  const trials = await listTrials(programId);
  const trial = trials.find((t) => t.id === params.trial) ?? trials[0];

  if (!trial) {
    return (
      <div className="page">
        {breadcrumbs}
        {header}
        <ProgramContext team={team.name} program={program} />
        <ProgramSwitch
          programs={programs}
          activeId={programId}
          basePath={basePath}
        />
        <EmptyState
          title="Aucun essai multi-environnement"
          message="Définissez un essai, ses environnements et ses entrées avant de lancer une analyse."
          action={{
            label: "Définir un essai",
            href: `/app/trials?program=${programId}`,
          }}
        />
      </div>
    );
  }

  const traits = await listTrialTraits(client, programId);
  const traitId =
    traits.find((t) => t.traitId === params.trait)?.traitId ??
    traits[0]?.traitId;

  if (!traitId) {
    return (
      <div className="page">
        {breadcrumbs}
        {header}
        <ProgramContext team={team.name} program={program} />
        <EmptyState
          title="Aucun trait numérique"
          message="Ce programme ne suit encore aucun trait numérique, entier ou ordinal actif - l’analyse multi-environnement ne s’applique qu’à ce type de données."
        />
      </div>
    );
  }

  const trialQuery = (overrides: Record<string, string>) => {
    const all: Record<string, string> = {
      program: programId,
      trial: trial.id,
      trait: traitId,
      ...overrides,
    };
    return Object.entries(all)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
  };

  const dataset = await buildMetObservationDataset(client, {
    trialId: trial.id,
    traitId,
    includeArchived: false,
  });

  if (dataset.tooLarge) {
    return (
      <div className="page">
        {breadcrumbs}
        {header}
        <ProgramContext team={team.name} program={program} />
        <ErrorState message="Le jeu de données de cet essai dépasse la taille d’analyse prise en charge." />
      </div>
    );
  }

  if (dataset.rows.length === 0) {
    return (
      <div className="page">
        {breadcrumbs}
        {header}
        <ProgramContext team={team.name} program={program} />
        <EmptyState
          title="Aucune observation liée à cet essai"
          message="Aucun phénotype n’est encore lié à cet essai/trait. Liez des phénotypes existants à des entrées et environnements (B41) ou importez-en de nouvelles ci-dessous."
          action={{
            label: "Gérer l’essai",
            href: `/app/trials?program=${programId}&trial=${trial.id}`,
          }}
        />
        <MetImportCard
          programId={programId}
          trialId={trial.id}
          traitId={traitId}
        />
      </div>
    );
  }

  const eligibility = evaluateMetEligibility(dataset.rows);
  const rankPairs = computeEnvironmentRankStability(dataset.rows);
  const cellMeans = computeEntryEnvironmentCellMeans(dataset.rows);

  const entryById = new Map<string, string>();
  const environmentById = new Map<string, string>();
  for (const row of dataset.rows) {
    entryById.set(row.entryId, row.entryLabel);
    environmentById.set(row.environmentId, row.environmentCode);
  }
  const heatmapEntries = [...entryById.entries()].map(([id, label]) => ({
    id,
    label,
  }));
  const heatmapEnvironments = [...environmentById.entries()].map(
    ([id, code]) => ({ id, code }),
  );

  const [latestRun, savedRuns] = await Promise.all([
    getLatestMetAnalysisRun(programId, trial.id),
    listMetAnalysisRuns(programId, trial.id),
  ]);

  return (
    <div className="page">
      {breadcrumbs}
      {header}
      <ProgramContext team={team.name} program={program} />
      <ProgramSwitch
        programs={programs}
        activeId={programId}
        basePath={basePath}
      />

      <div className="chip-nav" aria-label="Changer d’essai">
        {trials.map((t) => (
          <Link
            key={t.id}
            className={t.id === trial.id ? "active" : ""}
            href={`${basePath}?${trialQuery({ trial: t.id })}`}
          >
            {t.code}
          </Link>
        ))}
      </div>
      <div className="chip-nav" aria-label="Changer de trait">
        {traits.map((t) => (
          <Link
            key={t.traitId}
            className={t.traitId === traitId ? "active" : ""}
            href={`${basePath}?${trialQuery({ trait: t.traitId })}`}
          >
            {t.name}
          </Link>
        ))}
      </div>

      <Card>
        <h3 className="chart-title">Diagnostic de conception</h3>
        <dl className="stat-grid">
          <div>
            <dt>Entrées</dt>
            <dd>{eligibility.design.entryCount}</dd>
          </div>
          <div>
            <dt>Environnements</dt>
            <dd>{eligibility.design.environmentCount}</dd>
          </div>
          <div>
            <dt>Entrées partagées (≥2 environnements)</dt>
            <dd>{eligibility.design.sharedEntryCount}</dd>
          </div>
          <div>
            <dt>Observations</dt>
            <dd>{dataset.rows.length}</dd>
          </div>
        </dl>
        {eligibility.eligible ? (
          <StatusBadge tone="success">
            Éligible pour une analyse Entrée × Environnement
          </StatusBadge>
        ) : (
          <div>
            <StatusBadge tone="danger">NOT_ESTIMABLE</StatusBadge>
            <ul>
              {eligibility.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
        {eligibility.warnings.length > 0 && (
          <ul>
            {eligibility.warnings.map((warning, i) => (
              <li key={i}>
                <StatusBadge tone="warning">Avertissement</StatusBadge>{" "}
                {warning}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="chart-title">Carte de chaleur Entrée × Environnement</h3>
        <EntryEnvironmentHeatmap
          entries={heatmapEntries}
          environments={heatmapEnvironments}
          valueByCell={cellMeans}
        />
      </Card>

      {rankPairs.length > 0 && (
        <Card>
          <h3 className="chart-title">
            Stabilité du classement entre environnements
          </h3>
          <p className="chart-description">
            Un changement de l’entrée la plus performante entre deux
            environnements indique un véritable croisement (« crossover »), pas
            seulement un effet d’échelle.
          </p>
          <DataTable label="Stabilité du classement par paire d’environnements">
            <table>
              <thead>
                <tr>
                  <th scope="col">Environnement A</th>
                  <th scope="col">Environnement B</th>
                  <th scope="col">n commun</th>
                  <th scope="col">ρ (Spearman)</th>
                  <th scope="col">Entrée la plus performante change</th>
                </tr>
              </thead>
              <tbody>
                {rankPairs.map((pair, i) => (
                  <tr key={i}>
                    <td>
                      {environmentById.get(pair.environmentIdA) ??
                        pair.environmentIdA}
                    </td>
                    <td>
                      {environmentById.get(pair.environmentIdB) ??
                        pair.environmentIdB}
                    </td>
                    <td>{pair.pairedN}</td>
                    <td>
                      {pair.insufficientN ? "n insuffisant" : fmt(pair.rho, 3)}
                    </td>
                    <td>
                      {pair.topEntryChanged ? (
                        <StatusBadge tone="warning">
                          Oui ({entryById.get(pair.topEntryA) ?? pair.topEntryA}{" "}
                          → {entryById.get(pair.topEntryB) ?? pair.topEntryB})
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="success">Non</StatusBadge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        </Card>
      )}

      <MetImportCard
        programId={programId}
        trialId={trial.id}
        traitId={traitId}
      />

      <Card>
        <h3 className="chart-title">Lancer une analyse</h3>
        {!eligibility.eligible && (
          <p className="chart-description">
            Ce jeu de données n’est pas éligible ; l’analyse sera enregistrée
            avec le statut NOT_ESTIMABLE et les raisons détaillées, sans appeler
            le moteur statistique.
          </p>
        )}
        <ActionForm
          action={createMetAnalysisRun}
          actionName="met-run-analysis"
          submitLabel="Lancer et enregistrer"
        >
          <input type="hidden" name="program_id" value={programId} />
          <input type="hidden" name="trial_id" value={trial.id} />
          <input type="hidden" name="trait_id" value={traitId} />
          <label>
            Modèle
            <select name="model_type" defaultValue="met_base_v1">
              {Object.entries(modelTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Pondération performance (WAASB uniquement, 0 à 1)
            <input
              type="number"
              name="performance_weight"
              min={0}
              max={1}
              step={0.1}
              defaultValue={0.5}
            />
          </label>
        </ActionForm>
      </Card>

      {latestRun && (
        <Card>
          <h3 className="chart-title">
            Résultat le plus récent —{" "}
            {modelTypeLabels[latestRun.specification.modelType] ??
              latestRun.specification.modelType}
          </h3>
          <p className="chart-description">
            {new Date(latestRun.createdAt).toLocaleString("fr-FR")} · n ={" "}
            {latestRun.nObservations ?? "—"} · signature{" "}
            <code>{latestRun.datasetFingerprint.slice(0, 12)}…</code>
          </p>
          {latestRun.result ? (
            <MetRunResult result={latestRun.result} />
          ) : (
            <p>Résultat indisponible.</p>
          )}
        </Card>
      )}

      <Card>
        <h3 className="chart-title">Historique des analyses</h3>
        {savedRuns.length === 0 ? (
          <EmptyState
            title="Aucune analyse enregistrée"
            message="Lancez une analyse pour en garder une trace reproductible."
          />
        ) : (
          <DataTable label="Analyses enregistrées">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Modèle</th>
                  <th scope="col">n</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Signature</th>
                  <th scope="col">Auteur</th>
                </tr>
              </thead>
              <tbody>
                {savedRuns.map((run) => (
                  <tr key={run.id}>
                    <td>{new Date(run.createdAt).toLocaleString("fr-FR")}</td>
                    <td>
                      {modelTypeLabels[run.specification.modelType] ??
                        run.specification.modelType}
                    </td>
                    <td>{run.nObservations ?? "—"}</td>
                    <td>
                      <StatusBadge
                        tone={
                          run.status === "completed" ? "success" : "warning"
                        }
                      >
                        {run.status}
                      </StatusBadge>
                    </td>
                    <td>
                      <code>{run.datasetFingerprint.slice(0, 12)}…</code>
                    </td>
                    <td>{run.createdByName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        )}
      </Card>

      <Card>
        <h3 className="chart-title">Observations brutes</h3>
        <p className="chart-description">
          Chaque résultat ci-dessus reste traçable jusqu’à ces observations (les
          200 premières sont affichées).
        </p>
        <div className="page-actions">
          <Link
            className="button-link secondary"
            href={`${basePath}/export?${trialQuery({})}&format=csv`}
          >
            Exporter en CSV
          </Link>
          <Link
            className="button-link secondary"
            href={`${basePath}/export?${trialQuery({})}&format=json`}
          >
            Exporter en JSON
          </Link>
        </div>
        <DataTable label="Observations brutes">
          <table>
            <thead>
              <tr>
                <th scope="col">Entrée</th>
                <th scope="col">Environnement</th>
                <th scope="col">Bloc</th>
                <th scope="col">Date</th>
                <th scope="col">Valeur</th>
              </tr>
            </thead>
            <tbody>
              {dataset.rows.slice(0, 200).map((row) => (
                <tr key={row.traitValueId}>
                  <td>{row.entryLabel}</td>
                  <td>{row.environmentCode}</td>
                  <td>{row.block ?? "—"}</td>
                  <td>{row.evaluationDate ?? "—"}</td>
                  <td>{fmt(row.numericValue, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </Card>
    </div>
  );
}
