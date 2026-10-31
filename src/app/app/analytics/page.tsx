import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Icon } from "@/components/icons";
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
import {
  BoxPlot,
  HistogramChart,
  TrajectoryChart,
} from "@/components/analytics-charts";
import { requireIdentity } from "@/lib/auth";
import { collectionState } from "@/lib/query-state";
import type {
  AnalyticsFilters,
  TraitIntelligenceBundle,
} from "@/lib/analytics/types";
import {
  createAnalysisRun,
  isAnalysisRunStale,
  listAnalysisRuns,
  loadEarlyProxyEvidence,
  loadFilterOptions,
  loadNumericTraitOptions,
  loadTraitIntelligence,
  type SavedAnalysisRun,
} from "./actions";

type Params = {
  program?: string;
  trait?: string;
  date_from?: string;
  date_to?: string;
  block?: string;
  location?: string;
  replicate?: string;
  archived?: string;
  proxy_source?: string;
  proxy_source_from?: string;
  proxy_source_to?: string;
  proxy_target?: string;
  proxy_target_from?: string;
  proxy_target_to?: string;
};

const formatNumber = (value: number | null | undefined, decimals = 2) =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(decimals);
const formatPercent = (value: number | null | undefined, decimals = 1) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : `${(value * 100).toFixed(decimals)} %`;

export default async function Analytics({
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
  if (programsState.status === "error") {
    return (
      <div className="page">
        <ErrorState
          message={programsState.message}
          retryHref="/app/analytics"
        />
      </div>
    );
  }
  const programs = programsState.data;
  const program = programs.find((p) => p.id === params.program) ?? programs[0];
  const programId = program?.id;

  const breadcrumbs = (
    <Breadcrumbs
      items={[{ label: "Accueil", href: "/app" }, { label: "Analytique" }]}
    />
  );
  const header = (
    <PageHeader
      eyebrow="Sélection"
      title="Analytique des traits"
      description="Fiabilité, trajectoires et associations phénotypiques - chaque indicateur affiche son éligibilité et son incertitude plutôt qu’une valeur sans contexte."
    />
  );

  if (!programId) {
    return (
      <div className="page">
        {breadcrumbs}
        {header}
        <EmptyState
          title="Aucun programme"
          message="Créez un programme avant d’analyser des traits."
          action={{ label: "Créer un programme", href: "/app" }}
        />
      </div>
    );
  }

  const traits = await loadNumericTraitOptions(programId);
  const traitId =
    traits.find((t) => t.traitId === params.trait)?.traitId ??
    traits[0]?.traitId;

  const basePath = "/app/analytics";
  const traitHref = (nextTraitId: string) =>
    `${basePath}?program=${programId}&trait=${nextTraitId}`;

  if (!traitId) {
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
          title="Aucun trait numérique"
          message="Ce programme ne suit encore aucun trait numérique, entier ou ordinal actif - l’analytique ne s’applique qu’à ce type de données."
        />
      </div>
    );
  }

  const includeArchived = params.archived === "1";
  const filters: AnalyticsFilters = {
    programId,
    traitId,
    dateFrom: params.date_from || null,
    dateTo: params.date_to || null,
    familyIds: null,
    seedLotIds: null,
    blocks: params.block ? [params.block] : null,
    replicates: params.replicate ? [Number(params.replicate)] : null,
    locations: params.location ? [params.location] : null,
    includeArchived,
  };

  const [loaded, filterOptions, savedRunsAll] = await Promise.all([
    loadTraitIntelligence(filters),
    loadFilterOptions(
      programId,
      traitId,
      filters.dateFrom ?? null,
      filters.dateTo ?? null,
      includeArchived,
    ),
    listAnalysisRuns(programId),
  ]);
  const savedRuns = savedRunsAll
    .filter((r) => r.traitId === traitId)
    .slice(0, 10);
  const runsWithStale = await Promise.all(
    savedRuns.map(async (run) => ({
      run,
      stale: await isAnalysisRunStale(run),
    })),
  );

  const filterParams = (extra: Record<string, string | undefined>) => {
    const all = {
      program_id: programId,
      trait_id: traitId,
      ...paramsToQuery(params),
      ...extra,
    };
    return Object.entries(all)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");
  };

  let proxyEvidence = null;
  if (
    params.proxy_source &&
    params.proxy_source_from &&
    params.proxy_source_to &&
    params.proxy_target &&
    params.proxy_target_from &&
    params.proxy_target_to
  ) {
    proxyEvidence = await loadEarlyProxyEvidence(
      filters,
      params.proxy_source,
      params.proxy_source_from,
      params.proxy_source_to,
      params.proxy_target,
      params.proxy_target_from,
      params.proxy_target_to,
    );
  }

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

      <Card>
        <h2>Contexte d’analyse</h2>
        <form
          method="get"
          className="analytics-filters"
          data-action="analytics-filters"
        >
          <input type="hidden" name="program" value={programId} />
          <label className="field">
            Trait
            <select name="trait" defaultValue={traitId}>
              {traits.map((t) => (
                <option key={t.traitId} value={t.traitId}>
                  {t.name}
                  {t.unit ? ` (${t.unit})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Du
            <input
              type="date"
              name="date_from"
              defaultValue={params.date_from ?? ""}
            />
          </label>
          <label className="field">
            Au
            <input
              type="date"
              name="date_to"
              defaultValue={params.date_to ?? ""}
            />
          </label>
          {filterOptions.blocks.length > 0 && (
            <label className="field">
              Bloc
              <select name="block" defaultValue={params.block ?? ""}>
                <option value="">Tous</option>
                {filterOptions.blocks.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          )}
          {filterOptions.locations.length > 0 && (
            <label className="field">
              Localisation
              <select name="location" defaultValue={params.location ?? ""}>
                <option value="">Toutes</option>
                {filterOptions.locations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          {filterOptions.replicates.length > 0 && (
            <label className="field">
              Répétition
              <select name="replicate" defaultValue={params.replicate ?? ""}>
                <option value="">Toutes</option>
                {filterOptions.replicates.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>
              <input
                type="checkbox"
                name="archived"
                value="1"
                defaultChecked={includeArchived}
              />{" "}
              Inclure les éléments archivés
            </span>
          </label>
          <button type="submit" className="button-link">
            Appliquer
          </button>
        </form>
      </Card>

      {!loaded ? (
        <EmptyState
          title="Trait introuvable"
          message="Ce trait n’est plus actif pour ce programme."
        />
      ) : (
        <TraitIntelligenceView
          bundle={loaded.bundle}
          traits={traits}
          filters={filters}
          filterParams={filterParams}
          programId={programId}
          savedRuns={runsWithStale}
          proxyEvidence={proxyEvidence}
          currentParams={params}
        />
      )}
    </div>
  );
}

function paramsToQuery(params: Params): Record<string, string | undefined> {
  return {
    date_from: params.date_from,
    date_to: params.date_to,
    block: params.block,
    location: params.location,
    replicate: params.replicate,
    archived: params.archived,
  };
}

function TraitIntelligenceView({
  bundle,
  traits,
  filters,
  filterParams,
  programId,
  savedRuns,
  proxyEvidence,
  currentParams,
}: {
  bundle: TraitIntelligenceBundle;
  traits: { traitId: string; code: string; name: string }[];
  filters: AnalyticsFilters;
  filterParams: (extra: Record<string, string | undefined>) => string;
  programId: string;
  savedRuns: { run: SavedAnalysisRun; stale: boolean }[];
  proxyEvidence: Awaited<ReturnType<typeof loadEarlyProxyEvidence>>;
  currentParams: Params;
}) {
  const d = bundle.descriptive;
  const exportQuery = filterParams({});

  return (
    <>
      {bundle.warnings.map((w, i) => (
        <p key={i} className={`analysis-warning ${w.level}`} role="status">
          <Icon
            name={
              w.level === "not_estimable"
                ? "warning"
                : w.level === "caution"
                  ? "warning"
                  : "info"
            }
          />
          {w.message}
        </p>
      ))}

      <Card>
        <h2>
          Qualité des données
          <span className="eyebrow"> · {bundle.traitName}</span>
        </h2>
        <dl className="stat-grid">
          <div>
            <dt>Observations</dt>
            <dd>{d.nObserved}</dd>
          </div>
          <div>
            <dt>Entités</dt>
            <dd>
              {new Set(bundle.entityTrajectories.map((e) => e.phenotypeId))
                .size || "—"}
            </dd>
          </div>
          <div>
            <dt>Manquant</dt>
            <dd>{d.nTotal > 0 ? formatPercent(d.nMissing / d.nTotal) : "—"}</dd>
          </div>
          <div>
            <dt>Valeurs potentiellement aberrantes</dt>
            <dd>{bundle.qc.outliers.length}</dd>
          </div>
        </dl>
        {bundle.truncated && (
          <p className="analysis-warning caution">
            Jeu de données tronqué au maximum autorisé pour cette analyse.
          </p>
        )}
      </Card>

      <section className="analytics-grid">
        <Card>
          <h3 className="chart-title">Distribution</h3>
          <dl className="stat-grid">
            <div>
              <dt>Moyenne</dt>
              <dd>{formatNumber(d.mean)}</dd>
            </div>
            <div>
              <dt>Médiane</dt>
              <dd>{formatNumber(d.median)}</dd>
            </div>
            <div>
              <dt>Écart-type</dt>
              <dd>{formatNumber(d.sd)}</dd>
            </div>
            <div>
              <dt>CV</dt>
              <dd>
                {d.cv.status === "ok" ? (
                  `${formatNumber(d.cv.value, 1)} %`
                ) : (
                  <StatusBadge tone="warning">N/A</StatusBadge>
                )}
              </dd>
            </div>
          </dl>
          {d.cv.status === "not_applicable" && (
            <p className="chart-description">{d.cv.reason}</p>
          )}
        </Card>
        <HistogramChart
          title="Histogramme"
          unit={bundle.unit}
          bins={bundle.qc.histogram}
        />
        {d.nObserved > 0 && (
          <BoxPlot
            min={d.min}
            q1={d.q1}
            median={d.median}
            q3={d.q3}
            max={d.max}
            unit={bundle.unit}
          />
        )}
      </section>

      <OutlierTable outliers={bundle.qc.outliers} />

      <TrajectoryChart
        title="Trajectoire longitudinale"
        unit={bundle.unit}
        population={bundle.populationTrajectory}
        entities={bundle.entityTrajectories.map((e) => ({
          phenotypeCode: e.phenotypeCode,
          points: e.points,
        }))}
        truncatedEntities={bundle.entityTrajectoriesTruncated}
      />

      <DerivedFeaturesTable
        features={bundle.derivedFeatures}
        unit={bundle.unit}
      />

      <RankStabilityTable pairs={bundle.rankStability} />

      <WithinEntityStabilityTable rows={bundle.withinEntityStability} />

      <Card>
        <h3 className="chart-title">Fiabilité (répétabilité / ICC)</h3>
        {bundle.repeatability.status === "eligible" ? (
          <div className="eligibility-panel eligible">
            <dl className="stat-grid">
              <div>
                <dt>ICC</dt>
                <dd>{formatNumber(bundle.repeatability.icc, 3)}</dd>
              </div>
              <div>
                <dt>IC 95 %</dt>
                <dd>
                  [{formatNumber(bundle.repeatability.ciLow, 3)} ;{" "}
                  {formatNumber(bundle.repeatability.ciHigh, 3)}]
                </dd>
              </div>
              <div>
                <dt>Entités</dt>
                <dd>{bundle.repeatability.nEntities}</dd>
              </div>
              <div>
                <dt>Observations</dt>
                <dd>{bundle.repeatability.nObservations}</dd>
              </div>
            </dl>
            <p className="chart-description">
              Modèle : {bundle.repeatability.model}.{" "}
              {bundle.repeatability.ciMethod}.
            </p>
          </div>
        ) : (
          <div className="eligibility-panel not-estimable">
            <h4>NON ESTIMABLE</h4>
            <ul>
              {bundle.repeatability.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="chart-title">Héritabilité</h3>
        <div className="eligibility-panel not-estimable">
          <h4>NON ESTIMABLE À PARTIR DU MODÈLE ACTUEL</h4>
          <ul>
            {bundle.heritability.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      </Card>

      <AssociationsTable associations={bundle.associations} />

      <ProxyExplorer
        traits={traits}
        filters={filters}
        currentParams={currentParams}
        evidence={proxyEvidence}
      />

      <Card>
        <h3 className="chart-title">Export</h3>
        <p className="chart-description">
          Jeu de données brut (identifiants d’entité, dates, blocs, répétitions,
          valeurs) pour une ré-analyse indépendante en R, Python, JMP ou SAS -
          jamais de secret ni de donnée d’authentification.
        </p>
        <div className="page-actions">
          <Link
            className="button-link secondary"
            href={`/app/analytics/export?${exportQuery}&format=csv`}
          >
            Exporter en CSV
          </Link>
          <Link
            className="button-link secondary"
            href={`/app/analytics/export?${exportQuery}&format=json`}
          >
            Exporter en JSON
          </Link>
        </div>
      </Card>

      <Card>
        <h3 className="chart-title">Analyses enregistrées</h3>
        <ActionForm
          action={createAnalysisRun}
          actionName="analytics-save-run"
          submitLabel="Enregistrer cette analyse"
        >
          <input type="hidden" name="program_id" value={programId} />
          <input type="hidden" name="trait_id" value={filters.traitId} />
          <input
            type="hidden"
            name="date_from"
            value={filters.dateFrom ?? ""}
          />
          <input type="hidden" name="date_to" value={filters.dateTo ?? ""} />
          <input
            type="hidden"
            name="blocks"
            value={filters.blocks?.join(",") ?? ""}
          />
          <input
            type="hidden"
            name="replicates"
            value={filters.replicates?.join(",") ?? ""}
          />
          <input
            type="hidden"
            name="locations"
            value={filters.locations?.join(",") ?? ""}
          />
          <input
            type="hidden"
            name="include_archived"
            value={filters.includeArchived ? "1" : "0"}
          />
        </ActionForm>
        {savedRuns.length === 0 ? (
          <EmptyState
            title="Aucune analyse enregistrée"
            message="Enregistrez cette analyse pour en garder une trace reproductible."
          />
        ) : (
          <DataTable label="Analyses enregistrées">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">n</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Signature</th>
                  <th scope="col">Auteur</th>
                </tr>
              </thead>
              <tbody>
                {savedRuns.map(({ run, stale }) => (
                  <tr key={run.id}>
                    <td>{new Date(run.createdAt).toLocaleString("fr-FR")}</td>
                    <td>{run.nObservations ?? "—"}</td>
                    <td>
                      <StatusBadge
                        tone={
                          run.status === "completed" ? "success" : "warning"
                        }
                      >
                        {run.status}
                      </StatusBadge>
                      {stale && <span className="stale-badge"> · PÉRIMÉE</span>}
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
    </>
  );
}

function OutlierTable({
  outliers,
}: {
  outliers: TraitIntelligenceBundle["qc"]["outliers"];
}) {
  if (outliers.length === 0) return null;
  return (
    <Card>
      <h3 className="chart-title">Valeurs potentiellement aberrantes</h3>
      <p className="chart-description">
        Détection par la règle de Tukey (Q1 − 1,5×IQR / Q3 + 1,5×IQR) -
        signalement uniquement, jamais une suppression automatique : une valeur
        extrême peut être du matériel biologique précieux.
      </p>
      <DataTable label="Valeurs potentiellement aberrantes">
        <table>
          <thead>
            <tr>
              <th scope="col">Phénotype</th>
              <th scope="col">Valeur</th>
              <th scope="col">Date</th>
              <th scope="col">Bloc</th>
              <th scope="col">Répétition</th>
            </tr>
          </thead>
          <tbody>
            {outliers.map((o) => (
              <tr key={o.evaluationId}>
                <td>{o.phenotypeCode}</td>
                <td>{o.value}</td>
                <td>{o.evaluationDate ?? "—"}</td>
                <td>{o.block ?? "—"}</td>
                <td>{o.replicate ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
    </Card>
  );
}

function DerivedFeaturesTable({
  features,
  unit,
}: {
  features: TraitIntelligenceBundle["derivedFeatures"];
  unit: string | null;
}) {
  if (features.length === 0) return null;
  return (
    <Card>
      <h3 className="chart-title">
        Variations individuelles{unit ? ` (${unit})` : ""}
      </h3>
      <DataTable label="Variations individuelles">
        <table>
          <thead>
            <tr>
              <th scope="col">Phénotype</th>
              <th scope="col">n</th>
              <th scope="col">Première valeur</th>
              <th scope="col">Dernière valeur</th>
              <th scope="col">Variation</th>
              <th scope="col">AUC</th>
              <th scope="col">Pente</th>
            </tr>
          </thead>
          <tbody>
            {features.map((f) => (
              <tr key={f.phenotypeId}>
                <td>{f.phenotypeCode}</td>
                <td>{f.nMeasurements}</td>
                <td>{formatNumber(f.firstValue)}</td>
                <td>{formatNumber(f.lastValue)}</td>
                <td>
                  {formatNumber(f.absoluteChange)}
                  {f.relativeChange != null &&
                    ` (${formatPercent(f.relativeChange)})`}
                </td>
                <td>
                  {f.auc.status === "eligible" ? formatNumber(f.auc.auc) : "NE"}
                </td>
                <td>
                  {f.slope.status === "eligible"
                    ? formatNumber(f.slope.slope, 3)
                    : "NE"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
    </Card>
  );
}

function RankStabilityTable({
  pairs,
}: {
  pairs: TraitIntelligenceBundle["rankStability"];
}) {
  if (pairs.length === 0) return null;
  return (
    <Card>
      <h3 className="chart-title">Stabilité du classement entre dates</h3>
      <p className="chart-description">
        Corrélation de rang de Spearman entre paires de dates ; jamais affichée
        en dessous du seuil minimal de paires pour rester interprétable.
      </p>
      <DataTable label="Stabilité du classement entre dates">
        <table>
          <thead>
            <tr>
              <th scope="col">Date A</th>
              <th scope="col">Date B</th>
              <th scope="col">n apparié</th>
              <th scope="col">rho</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p, i) => (
              <tr key={i}>
                <td>{p.dateA}</td>
                <td>{p.dateB}</td>
                <td>{p.pairedN}</td>
                <td>
                  {p.insufficientN ? (
                    <StatusBadge tone="warning">n insuffisant</StatusBadge>
                  ) : (
                    formatNumber(p.rho, 2)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
    </Card>
  );
}

function WithinEntityStabilityTable({
  rows,
}: {
  rows: TraitIntelligenceBundle["withinEntityStability"];
}) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <h3 className="chart-title">Stabilité intra-entité</h3>
      <p className="chart-description">
        Décrit la stabilité phénotypique mesurée pour chaque entité répétée -
        jamais une stabilité génétique.
      </p>
      <DataTable label="Stabilité intra-entité">
        <table>
          <thead>
            <tr>
              <th scope="col">Phénotype</th>
              <th scope="col">n</th>
              <th scope="col">Écart-type</th>
              <th scope="col">Étendue</th>
              <th scope="col">Pente</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.phenotypeId}>
                <td>{r.phenotypeCode}</td>
                <td>{r.n}</td>
                <td>{formatNumber(r.sd)}</td>
                <td>{formatNumber(r.range)}</td>
                <td>
                  {r.slope.status === "eligible"
                    ? formatNumber(r.slope.slope, 3)
                    : "NE"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
    </Card>
  );
}

function AssociationsTable({
  associations,
}: {
  associations: TraitIntelligenceBundle["associations"];
}) {
  if (associations.length === 0) return null;
  return (
    <>
      <Card>
        <h3 className="chart-title">Associations phénotypiques</h3>
        <p className="chart-description">
          Corrélation phénotypique mesurée sur des événements d’évaluation
          communs - jamais une corrélation génétique. Correction
          Benjamini-Hochberg appliquée sur l’ensemble des paires testées.
        </p>
        <DataTable label="Associations phénotypiques">
          <table>
            <thead>
              <tr>
                <th scope="col">Trait</th>
                <th scope="col">n apparié</th>
                <th scope="col">Pearson r</th>
                <th scope="col">p</th>
                <th scope="col">q (FDR)</th>
                <th scope="col">Spearman rho</th>
              </tr>
            </thead>
            <tbody>
              {associations.map((a) => (
                <tr key={a.traitId}>
                  <td>{a.traitName}</td>
                  <td>{a.pairedN}</td>
                  <td>{formatNumber(a.pearsonR, 2)}</td>
                  <td>
                    {a.pearsonP == null ? "—" : a.pearsonP.toExponential(2)}
                  </td>
                  <td>
                    {a.pearsonQ == null ? "—" : a.pearsonQ.toExponential(2)}
                  </td>
                  <td>{formatNumber(a.spearmanRho, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </Card>
    </>
  );
}

function ProxyExplorer({
  traits,
  filters,
  currentParams,
  evidence,
}: {
  traits: { traitId: string; code: string; name: string }[];
  filters: AnalyticsFilters;
  currentParams: Params;
  evidence: Awaited<ReturnType<typeof loadEarlyProxyEvidence>>;
}) {
  return (
    <Card>
      <h3 className="chart-title">
        Exploration de traits précoces (proxy de sélection)
      </h3>
      <form
        method="get"
        className="analytics-filters"
        data-action="proxy-explorer"
      >
        <input type="hidden" name="program" value={filters.programId} />
        <input type="hidden" name="trait" value={filters.traitId} />
        <label className="field">
          Trait précoce
          <select
            name="proxy_source"
            defaultValue={currentParams.proxy_source ?? ""}
          >
            <option value="">—</option>
            {traits.map((t) => (
              <option key={t.traitId} value={t.traitId}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Fenêtre précoce : du
          <input
            type="date"
            name="proxy_source_from"
            defaultValue={currentParams.proxy_source_from ?? ""}
          />
        </label>
        <label className="field">
          au
          <input
            type="date"
            name="proxy_source_to"
            defaultValue={currentParams.proxy_source_to ?? ""}
          />
        </label>
        <label className="field">
          Trait cible
          <select
            name="proxy_target"
            defaultValue={currentParams.proxy_target ?? ""}
          >
            <option value="">—</option>
            {traits.map((t) => (
              <option key={t.traitId} value={t.traitId}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Fenêtre cible : du
          <input
            type="date"
            name="proxy_target_from"
            defaultValue={currentParams.proxy_target_from ?? ""}
          />
        </label>
        <label className="field">
          au
          <input
            type="date"
            name="proxy_target_to"
            defaultValue={currentParams.proxy_target_to ?? ""}
          />
        </label>
        <button type="submit" className="button-link">
          Analyser
        </button>
      </form>
      {evidence && (
        <div className="proxy-evidence">
          <h4>
            {evidence.sourceTraitName} → {evidence.targetTraitName}
          </h4>
          <dl className="stat-grid">
            <div>
              <dt>Entités appariées</dt>
              <dd>{evidence.pairedN}</dd>
            </div>
            <div>
              <dt>Mesuré plus tôt</dt>
              <dd>
                {evidence.medianDaysEarlier == null
                  ? "—"
                  : `${Math.round(evidence.medianDaysEarlier)} jours`}
              </dd>
            </div>
            <div>
              <dt>Pearson r</dt>
              <dd>{formatNumber(evidence.pearsonR, 2)}</dd>
            </div>
            <div>
              <dt>Spearman rho</dt>
              <dd>{formatNumber(evidence.spearmanRho, 2)}</dd>
            </div>
            <div>
              <dt>Répétabilité (précoce)</dt>
              <dd>
                {evidence.repeatability?.status === "eligible"
                  ? formatNumber(evidence.repeatability.icc, 2)
                  : "NE"}
              </dd>
            </div>
            <div>
              <dt>Observations manquantes</dt>
              <dd>{formatPercent(evidence.missingPct)}</dd>
            </div>
          </dl>
          <p className="proxy-interpretation">
            Interprétation :{" "}
            {Math.abs(evidence.pearsonR ?? 0) >= 0.6
              ? "association phénotypique forte"
              : Math.abs(evidence.pearsonR ?? 0) >= 0.3
                ? "association phénotypique modérée"
                : "association phénotypique faible"}
            . Nécessite une validation biologique indépendante avant toute
            utilisation comme critère de sélection. Ceci n’établit pas de lien
            causal.
          </p>
        </div>
      )}
    </Card>
  );
}
