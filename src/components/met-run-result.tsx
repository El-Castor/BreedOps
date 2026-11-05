import { DataTable, StatusBadge } from "@/components/ui";
import { WaasbStabilityScatter } from "@/components/met-charts";

const fmt = (value: unknown, decimals = 2): string =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(decimals)
    : "—";

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/** Renders one saved analytics_runs.result for analysis_type=
 * 'multi_environment' (B32-B36: every result traceable to raw data,
 * uncertainty always shown). The stored shape depends on how the run
 * ended - never fabricates a table for a shape it does not recognize,
 * it falls through to a plain status message instead. */
export function MetRunResult({ result }: { result: Record<string, unknown> }) {
  // Path 1: the eligibility gate rejected the dataset before the R engine
  // ever ran (src/app/app/analytics/met-actions.ts's not-eligible branch).
  const eligibility = asRecord(result.eligibility);
  if (eligibility) {
    const reasons = Array.isArray(eligibility.reasons)
      ? (eligibility.reasons as unknown[])
      : [];
    return (
      <div>
        <p className="form-message" role="alert">
          NOT_ESTIMABLE : ce jeu de données ne permet pas d’estimer un effet
          Entrée × Environnement.
        </p>
        {reasons.length > 0 ? (
          <ul>
            {reasons.map((reason, i) => (
              <li key={i}>{String(reason)}</li>
            ))}
          </ul>
        ) : (
          <p>Raison non précisée.</p>
        )}
      </div>
    );
  }

  // Path 2: the R engine itself returned not_estimable/error (no `engine`/
  // `model` fields in that case - see met_models.R's fail()).
  if (!result.engine || !result.model) {
    return (
      <p className="form-message" role="alert">
        {typeof result.status === "string"
          ? `${result.status.toUpperCase()} : `
          : ""}
        {typeof result.message === "string"
          ? result.message
          : "Le moteur statistique n’a pas pu produire de résultat pour ce jeu de données."}
      </p>
    );
  }

  const model = asRecord(result.model) ?? {};
  const modelType = result.model_type ?? model.model_type;

  if (modelType === "met_base_v1") {
    const variance = asRecord(result.variance_components) ?? {};
    const entryPredictions = asArray(result.entry_predictions);
    return (
      <div>
        <h4>Composantes de variance</h4>
        <DataTable label="Composantes de variance">
          <table>
            <thead>
              <tr>
                <th scope="col">Terme</th>
                <th scope="col">Estimation</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["entry", "Entrée"],
                  ["entry_x_environment", "Entrée × Environnement"],
                  ["block_environment", "Bloc(Environnement)"],
                  ["residual", "Résiduelle"],
                ] as const
              ).map(([key, label]) => {
                const term = asRecord(variance[key]);
                return (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>{term ? fmt(term.estimate, 4) : "non estimable"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTable>
        <h4>Prédictions par entrée (BLUP)</h4>
        <p className="chart-description">
          n = {entryPredictions.length} - chaque valeur reste associée à son
          erreur-type.
        </p>
        <DataTable label="Prédictions par entrée">
          <table>
            <thead>
              <tr>
                <th scope="col">Entrée</th>
                <th scope="col">BLUP</th>
                <th scope="col">Erreur-type</th>
              </tr>
            </thead>
            <tbody>
              {entryPredictions.slice(0, 100).map((row, i) => (
                <tr key={i}>
                  <td>{String(row.entry_id ?? "—")}</td>
                  <td>{fmt(row.blup, 3)}</td>
                  <td>{fmt(row.se, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </div>
    );
  }

  if (modelType === "met_ammi_v1" || modelType === "met_gge_v1") {
    const pcs = asArray(result.principal_components);
    const genotypes = asArray(result.genotype_scores);
    const envs = asArray(result.environment_scores);
    return (
      <div>
        <h4>Composantes principales</h4>
        <DataTable label="Composantes principales">
          <table>
            <thead>
              <tr>
                <th scope="col">Composante</th>
                <th scope="col">Variance expliquée</th>
              </tr>
            </thead>
            <tbody>
              {pcs.map((pc, i) => (
                <tr key={i}>
                  <td>{String(pc.component ?? "—")}</td>
                  <td>{fmt(pc.variance_explained_pct, 1)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
        <h4>Scores génotype (axe 1)</h4>
        <DataTable label="Scores génotype">
          <table>
            <thead>
              <tr>
                <th scope="col">Entrée</th>
                <th scope="col">Moyenne</th>
                <th scope="col">Axe 1</th>
              </tr>
            </thead>
            <tbody>
              {genotypes.slice(0, 100).map((row, i) => {
                const axis1 = Array.isArray(row.coordinates)
                  ? row.coordinates[0]
                  : row.pc1;
                return (
                  <tr key={i}>
                    <td>{String(row.entry_id ?? "—")}</td>
                    <td>{fmt(row.mean, 2)}</td>
                    <td>{fmt(axis1, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTable>
        <h4>Scores environnement (axe 1)</h4>
        <DataTable label="Scores environnement">
          <table>
            <thead>
              <tr>
                <th scope="col">Environnement</th>
                <th scope="col">Moyenne</th>
                <th scope="col">Axe 1</th>
              </tr>
            </thead>
            <tbody>
              {envs.map((row, i) => {
                const axis1 = Array.isArray(row.coordinates)
                  ? row.coordinates[0]
                  : row.pc1;
                return (
                  <tr key={i}>
                    <td>{String(row.environment_id ?? "—")}</td>
                    <td>{fmt(row.mean, 2)}</td>
                    <td>{fmt(axis1, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTable>
      </div>
    );
  }

  if (modelType === "met_waasb_v1") {
    const entries = asArray(result.entries);
    const chartEntries = entries
      .filter(
        (e) =>
          typeof e.mean_performance === "number" && typeof e.waasb === "number",
      )
      .map((e) => ({
        entry_id: String(e.entry_id),
        mean_performance: e.mean_performance as number,
        waasb: e.waasb as number,
      }));
    return (
      <div>
        <h4>Performance vs stabilité (WAASB)</h4>
        <p className="chart-description">
          Pondération performance : {fmt(model.performance_weight, 2)} ·
          pondération stabilité : {fmt(model.stability_weight, 2)}
        </p>
        <WaasbStabilityScatter entries={chartEntries} />
        <DataTable label="WAASBY par entrée">
          <table>
            <thead>
              <tr>
                <th scope="col">Entrée</th>
                <th scope="col">Performance moyenne</th>
                <th scope="col">WAASB</th>
                <th scope="col">WAASBY</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 100).map((row, i) => (
                <tr key={i}>
                  <td>{String(row.entry_id ?? "—")}</td>
                  <td>{fmt(row.mean_performance, 2)}</td>
                  <td>{fmt(row.waasb, 2)}</td>
                  <td>{fmt(row.waasby, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </div>
    );
  }

  if (modelType === "met_finlay_wilkinson_v1") {
    const entries = asArray(result.entries);
    return (
      <div>
        <h4>Régression conjointe (Finlay-Wilkinson)</h4>
        <p className="chart-description">
          Pente de 1 = réactivité moyenne à l’indice environnemental ; une pente
          &gt; 1 indique une entrée plus réactive (potentiel plus élevé mais
          plus sensible), une pente &lt; 1 une entrée plus stable mais moins
          réactive.
        </p>
        <DataTable label="Régression conjointe par entrée">
          <table>
            <thead>
              <tr>
                <th scope="col">Entrée</th>
                <th scope="col">Pente</th>
                <th scope="col">p (pente = 1)</th>
                <th scope="col">Variance de déviation</th>
                <th scope="col">R²</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 100).map((row, i) => (
                <tr key={i}>
                  <td>{String(row.entry_id ?? "—")}</td>
                  <td>{fmt(row.slope, 3)}</td>
                  <td>{fmt(row.slope_p_value, 3)}</td>
                  <td>{fmt(row.deviation_variance, 4)}</td>
                  <td>{fmt(row.r_squared, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </div>
    );
  }

  return (
    <p>
      <StatusBadge tone="warning">Type de modèle non reconnu</StatusBadge>
    </p>
  );
}
