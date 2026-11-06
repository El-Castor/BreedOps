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
import { requireIdentity } from "@/lib/auth";
import { collectionState } from "@/lib/query-state";
import { listTrialTraits } from "@/lib/met/dataset";
import { listTrials } from "../../trials/actions";
import {
  addBreedingDecisionScenarioTrait,
  archiveBreedingDecisionScenario,
  createBreedingDecisionRun,
  createBreedingDecisionScenario,
  getLatestBreedingDecisionRun,
  listBreedingDecisionRuns,
  listBreedingDecisionScenarios,
  listBreedingDecisionScenarioTraits,
  listCompletedMetRunsForTrial,
  removeBreedingDecisionScenarioTrait,
} from "../breeding-decision-actions";

const directionLabels: Record<string, string> = {
  higher_is_better: "Hausse souhaitée",
  lower_is_better: "Baisse souhaitée",
  target_value: "Valeur cible",
};

const sourceTypeLabels: Record<string, string> = {
  RAW_PHENOTYPIC: "Observation brute",
  PHENOTYPIC_MEAN: "Moyenne phénotypique",
  MET_ENTRY_PREDICTION: "Prédiction d’entrée (met_base_v1)",
  WAASBY_STABILITY_PERFORMANCE: "Performance/stabilité WAASBY",
};

const methodLabels: Record<string, string> = {
  selection_mgidi_v1: "MGIDI",
  selection_mtsi_v1: "MTSI",
};

const fmt = (value: unknown, decimals = 3): string =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(decimals)
    : "—";

export default async function BreedingDecisionAnalytics({
  searchParams,
}: {
  searchParams: Promise<{
    program?: string;
    trial?: string;
    scenario?: string;
  }>;
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
          retryHref="/app/analytics/breeding-decision"
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
        { label: "Décision d’amélioration" },
      ]}
    />
  );
  const header = (
    <PageHeader
      eyebrow="Décision & progrès génétique"
      title="Décision d’amélioration"
      description="Classement analytique multi-traits des candidats, séparé explicitement de l’inférence génétique - une décision de sélection n’est jamais automatiquement une valeur génétique. Alternative analytique au score opérationnel existant (/app/phenotypes), jamais un remplacement."
    />
  );

  if (!programId) {
    return (
      <div className="page">
        {breadcrumbs}
        {header}
        <EmptyState
          title="Aucun programme"
          message="Créez un programme avant de configurer une décision d’amélioration."
          action={{ label: "Créer un programme", href: "/app" }}
        />
      </div>
    );
  }

  const basePath = "/app/analytics/breeding-decision";
  const trials = await listTrials(programId);
  const trial = trials.find((t) => t.id === params.trial) ?? trials[0];

  if (!trial) {
    return (
      <div className="page">
        {breadcrumbs}
        {header}
        <ProgramContext team={team.name} program={program} />
        <EmptyState
          title="Aucun essai multi-environnement"
          message="Définissez un essai et ses entrées (trial_entries) avant de configurer un scénario de décision - les candidats V2-06 sont toujours des trial_entries (V2-05)."
          action={{
            label: "Définir un essai",
            href: `/app/trials?program=${programId}`,
          }}
        />
      </div>
    );
  }

  const trialQuery = (overrides: Record<string, string>) => {
    const all: Record<string, string> = {
      program: programId,
      trial: trial.id,
      ...overrides,
    };
    return Object.entries(all)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
  };

  const [traits, scenarios, metBaseRuns, metWaasbRuns] = await Promise.all([
    listTrialTraits(client, programId),
    listBreedingDecisionScenarios(programId, trial.id),
    listCompletedMetRunsForTrial(trial.id, "met_base_v1"),
    listCompletedMetRunsForTrial(trial.id, "met_waasb_v1"),
  ]);

  const scenario =
    scenarios.find((s) => s.id === params.scenario) ?? scenarios[0];

  const [scenarioTraits, savedRuns, latestRun] = scenario
    ? await Promise.all([
        listBreedingDecisionScenarioTraits(scenario.id),
        listBreedingDecisionRuns(programId, trial.id),
        getLatestBreedingDecisionRun(programId, trial.id),
      ])
    : [[], [], null];

  const traitNameById = new Map(traits.map((t) => [t.traitId, t.name]));

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

      <Card>
        <h3 className="chart-title">1. Scénarios</h3>
        <p className="chart-description">
          Un scénario est une configuration réutilisable : candidats (toujours
          les trial_entries de cet essai), traits sélectionnés, proportion de
          sélection. L’exécution d’une analyse produit une preuve immuable
          (analytics_runs), jamais le scénario lui-même.
        </p>
        {scenarios.length > 0 && (
          <div className="chip-nav" aria-label="Changer de scénario">
            {scenarios.map((s) => (
              <Link
                key={s.id}
                className={s.id === scenario?.id ? "active" : ""}
                href={`${basePath}?${trialQuery({ scenario: s.id })}`}
              >
                {s.name}
              </Link>
            ))}
          </div>
        )}
        <ActionForm
          action={createBreedingDecisionScenario}
          actionName="create-breeding-decision-scenario"
          submitLabel="Créer le scénario"
        >
          <input type="hidden" name="program_id" value={programId} />
          <input type="hidden" name="trial_id" value={trial.id} />
          <label>
            Nom du scénario
            <input type="text" name="name" required maxLength={200} />
          </label>
          <label>
            Description (optionnelle)
            <textarea name="description" maxLength={2000} />
          </label>
          <label>
            Éligibilité des candidats
            <select name="candidate_eligibility" defaultValue="all">
              <option value="all">Tous les candidats</option>
              <option value="exclude_operationally_eliminated">
                Exclure les candidats éliminés opérationnellement
              </option>
            </select>
          </label>
          <label>
            Proportion de sélection (%)
            <input
              type="number"
              name="selection_proportion"
              min={1}
              max={100}
              step={1}
              defaultValue={20}
              required
            />
          </label>
        </ActionForm>
      </Card>

      {!scenario ? (
        <EmptyState
          title="Aucun scénario"
          message="Créez un scénario ci-dessus pour commencer."
        />
      ) : (
        <>
          <Card>
            <h3 className="chart-title">
              2. Traits du scénario « {scenario.name} »
            </h3>
            <p className="chart-description">
              Chaque trait a une direction de sélection explicite et une
              provenance précise - jamais une valeur « générique » ni appelée
              valeur génétique par défaut.
            </p>
            <DataTable label="Traits sélectionnés">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Trait</th>
                    <th scope="col">Direction</th>
                    <th scope="col">Cible</th>
                    <th scope="col">Poids</th>
                    <th scope="col">Poids économique</th>
                    <th scope="col">Source</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {scenarioTraits.map((t) => (
                    <tr key={t.id}>
                      <td>{t.traitName}</td>
                      <td>{directionLabels[t.direction] ?? t.direction}</td>
                      <td>{t.targetValue ?? "—"}</td>
                      <td>{t.weight ?? "—"}</td>
                      <td>{t.economicWeight ?? "—"}</td>
                      <td>{sourceTypeLabels[t.sourceType] ?? t.sourceType}</td>
                      <td>
                        <ActionForm
                          action={removeBreedingDecisionScenarioTrait}
                          actionName={`remove-scenario-trait-${t.id}`}
                          submitLabel="Retirer"
                        >
                          <input
                            type="hidden"
                            name="scenario_trait_id"
                            value={t.id}
                          />
                        </ActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>

            <ActionForm
              action={addBreedingDecisionScenarioTrait}
              actionName="add-breeding-decision-scenario-trait"
              submitLabel="Ajouter le trait"
            >
              <input type="hidden" name="scenario_id" value={scenario.id} />
              <label>
                Trait
                <select name="trait_id" required>
                  {traits.map((t) => (
                    <option key={t.traitId} value={t.traitId}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Direction de sélection
                <select name="direction" defaultValue="higher_is_better">
                  <option value="higher_is_better">Hausse souhaitée</option>
                  <option value="lower_is_better">Baisse souhaitée</option>
                  <option value="target_value">Valeur cible</option>
                </select>
              </label>
              <label>
                Valeur cible (si « valeur cible »)
                <input type="number" name="target_value" step="any" />
              </label>
              <label>
                Poids (optionnel, visible)
                <input type="number" name="weight" min={0} step="any" />
              </label>
              <label>
                Poids économique (optionnel, requis pour Smith-Hazel - non
                disponible dans cette version)
                <input type="number" name="economic_weight" step="any" />
              </label>
              <label>
                Source de la valeur
                <select name="source_type" defaultValue="RAW_PHENOTYPIC">
                  <option value="RAW_PHENOTYPIC">Observation brute</option>
                  <option value="PHENOTYPIC_MEAN">Moyenne phénotypique</option>
                  <option value="MET_ENTRY_PREDICTION">
                    Prédiction d’entrée (met_base_v1)
                  </option>
                  <option value="WAASBY_STABILITY_PERFORMANCE">
                    Performance/stabilité WAASBY (met_waasb_v1)
                  </option>
                </select>
              </label>
              <label>
                Analyse source (si prédiction/WAASBY)
                <select name="source_run_id">
                  <option value="">—</option>
                  {metBaseRuns.map((r) => (
                    <option key={r.id} value={r.id}>
                      met_base_v1 · {traitNameById.get(r.traitId) ?? r.traitId}{" "}
                      · {new Date(r.createdAt).toLocaleDateString("fr-FR")}
                    </option>
                  ))}
                  {metWaasbRuns.map((r) => (
                    <option key={r.id} value={r.id}>
                      met_waasb_v1 · {traitNameById.get(r.traitId) ?? r.traitId}{" "}
                      · {new Date(r.createdAt).toLocaleDateString("fr-FR")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Occasion de mesure (date, pour observation brute/moyenne)
                <input type="date" name="evaluation_date" />
              </label>
            </ActionForm>
          </Card>

          <Card>
            <h3 className="chart-title">3. Lancer une analyse</h3>
            <p className="chart-description">
              MGIDI compare les candidats sur l’ensemble des traits sélectionnés
              (valeurs ponctuelles). MTSI exige que chaque trait provienne d’une
              analyse WAASBY réussie pour cet essai, avec une pondération
              performance/stabilité harmonisée.
            </p>
            <ActionForm
              action={createBreedingDecisionRun}
              actionName="create-breeding-decision-run"
              submitLabel="Lancer et enregistrer"
            >
              <input type="hidden" name="program_id" value={programId} />
              <input type="hidden" name="scenario_id" value={scenario.id} />
              <label>
                Méthode
                <select name="method" defaultValue="selection_mgidi_v1">
                  <option value="selection_mgidi_v1">MGIDI</option>
                  <option value="selection_mtsi_v1">MTSI</option>
                </select>
              </label>
            </ActionForm>
          </Card>

          {latestRun && (
            <>
              <BreedingDecisionResultCard run={latestRun} />
              <Card>
                <h3 className="chart-title">Exporter la dernière analyse</h3>
                <p className="chart-description">
                  Configuration du scénario, classement candidats × traits,
                  différentiels de sélection et panneau de validité génétique.
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
              </Card>
            </>
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
                      <th scope="col">Méthode</th>
                      <th scope="col">n</th>
                      <th scope="col">Statut</th>
                      <th scope="col">Signature</th>
                      <th scope="col">Auteur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedRuns.map((run) => (
                      <tr key={run.id}>
                        <td>
                          {new Date(run.createdAt).toLocaleString("fr-FR")}
                        </td>
                        <td>
                          {methodLabels[run.specification.method as string] ??
                            String(run.specification.method)}
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
            <h3 className="chart-title">Comparer / supprimer</h3>
            <ActionForm
              action={archiveBreedingDecisionScenario}
              actionName={`archive-scenario-${scenario.id}`}
              submitLabel="Archiver ce scénario"
            >
              <input type="hidden" name="scenario_id" value={scenario.id} />
            </ActionForm>
          </Card>
        </>
      )}
    </div>
  );
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function BreedingDecisionResultCard({
  run,
}: {
  run: {
    result: Record<string, unknown> | null;
    createdAt: string;
    nObservations: number | null;
    datasetFingerprint: string;
  };
}) {
  const result = run.result;
  if (!result) {
    return (
      <Card>
        <h3 className="chart-title">Résultat le plus récent</h3>
        <p>Résultat indisponible.</p>
      </Card>
    );
  }
  const eligibility = asRecord(result.eligibility);
  if (eligibility) {
    const reasons = Array.isArray(eligibility.reasons)
      ? eligibility.reasons
      : [];
    return (
      <Card>
        <h3 className="chart-title">Résultat le plus récent</h3>
        <p className="form-message" role="alert">
          NOT_ESTIMABLE : ce scénario ne permet pas de produire un classement
          analytique.
        </p>
        <ul>
          {reasons.map((reason, i) => (
            <li key={i}>{String(reason)}</li>
          ))}
        </ul>
      </Card>
    );
  }

  const method = (result.method as string) ?? "";
  const candidates = asArray(result.candidates).sort(
    (a, b) => (a.rank as number) - (b.rank as number),
  );
  const scoreKey = method === "selection_mtsi_v1" ? "mtsi" : "mgidi";
  const selectionDifferentials = asArray(result.selection_differentials);
  const panel = asRecord(result.genetic_validity_panel);
  const coverage = asRecord(result.coverage);
  const factorContributions = asArray(result.factor_contributions);

  const contributionsByCandidate = new Map<string, Record<string, unknown>[]>();
  for (const c of factorContributions) {
    const id = String(c.candidate_id);
    const list = contributionsByCandidate.get(id) ?? [];
    list.push(c);
    contributionsByCandidate.set(id, list);
  }

  return (
    <Card>
      <h3 className="chart-title">
        Résultat le plus récent — {methodLabels[method] ?? method}
      </h3>
      <p className="chart-description">
        {new Date(run.createdAt).toLocaleString("fr-FR")} · n ={" "}
        {run.nObservations ?? "—"} · signature{" "}
        <code>{run.datasetFingerprint.slice(0, 12)}…</code>
        {coverage && (
          <>
            {" "}
            · couverture {String(coverage.completeCandidateCount)}/
            {String(coverage.candidateCount)} candidats
          </>
        )}
      </p>

      <h4>Classement</h4>
      <DataTable label="Classement des candidats">
        <table>
          <thead>
            <tr>
              <th scope="col">Rang</th>
              <th scope="col">Candidat</th>
              <th scope="col">Indice</th>
              <th scope="col">Sélectionné</th>
            </tr>
          </thead>
          <tbody>
            {candidates.slice(0, 200).map((c, i) => (
              <tr key={i}>
                <td>{String(c.rank)}</td>
                <td>{String(c.candidate_id)}</td>
                <td>{fmt(c[scoreKey])}</td>
                <td>
                  {c.selected ? (
                    <StatusBadge tone="success">
                      Sélectionné par {methodLabels[method] ?? method}
                    </StatusBadge>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>

      <h4>Différentiel de sélection par trait</h4>
      <p className="chart-description">
        Ceci n’est pas un gain génétique - voir le panneau de validité génétique
        ci-dessous.
      </p>
      <DataTable label="Différentiel de sélection">
        <table>
          <thead>
            <tr>
              <th scope="col">Trait</th>
              <th scope="col">Moyenne population</th>
              <th scope="col">Moyenne sélectionnée</th>
              <th scope="col">Différentiel</th>
              <th scope="col">Direction atteinte</th>
            </tr>
          </thead>
          <tbody>
            {selectionDifferentials.map((d, i) => (
              <tr key={i}>
                <td>{String(d.traitCode)}</td>
                <td>{fmt(d.populationMean, 2)}</td>
                <td>{fmt(d.selectedMean, 2)}</td>
                <td>{fmt(d.absoluteDifferential, 2)}</td>
                <td>
                  {d.directionAchieved === null ? (
                    "—"
                  ) : d.directionAchieved ? (
                    <StatusBadge tone="success">Oui</StatusBadge>
                  ) : (
                    <StatusBadge tone="warning">Non</StatusBadge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>

      {panel && (
        <>
          <h4>Panneau de validité génétique</h4>
          <DataTable label="Validité génétique">
            <table>
              <thead>
                <tr>
                  <th scope="col">Métrique</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Raison</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(panel).map(([key, value]) => {
                  const entry = value as {
                    status: string;
                    reason: string | null;
                  };
                  return (
                    <tr key={key}>
                      <td>{key}</td>
                      <td>
                        <StatusBadge
                          tone={
                            entry.status === "AVAILABLE" ? "success" : "neutral"
                          }
                        >
                          {entry.status}
                        </StatusBadge>
                      </td>
                      <td>{entry.reason ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataTable>
        </>
      )}
    </Card>
  );
}
