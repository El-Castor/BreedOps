"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
const formatNumber = (value: number, decimals = 2) =>
  Number.isFinite(value) ? value.toFixed(decimals) : "—";

/** Entry x Environment mean-performance heatmap (B34). Always paired with
 * the underlying numeric table right below it (task §36: an accessible
 * text equivalent for any visualization, same convention as the V2-04
 * chart components in src/components/analytics-charts.tsx) - the heatmap
 * itself carries `role="img"` with a full text description rather than
 * being the only way to read the values. Color intensity is relative to
 * THIS dataset's own min/max, never a fixed absolute scale: cell color
 * alone is never the only way to read a value (every cell prints its
 * number), and the caption says so explicitly. */
export function EntryEnvironmentHeatmap({
  entries,
  environments,
  valueByCell,
}: {
  entries: { id: string; label: string }[];
  environments: { id: string; code: string }[];
  /** Keyed by `${entryId}||${environmentId}`; a missing key means no
   * observation for that cell - rendered as an explicit empty cell, never
   * a fabricated 0. */
  valueByCell: Map<string, number>;
}) {
  const values = [...valueByCell.values()];
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const range = max - min;

  if (entries.length === 0 || environments.length === 0) return null;

  const describedValues = entries.flatMap((entry) =>
    environments.map((env) => {
      const v = valueByCell.get(`${entry.id}||${env.id}`);
      return `${entry.label} × ${env.code} : ${v == null ? "aucune observation" : formatNumber(v)}`;
    }),
  );

  return (
    <div>
      <p className="chart-description">
        Intensité de couleur relative au minimum/maximum observés dans ce jeu de
        données (min {formatNumber(min)}, max {formatNumber(max)}) - chaque
        cellule affiche aussi sa valeur numérique.
      </p>
      <div
        role="img"
        aria-label={`Carte de chaleur entrée × environnement : ${describedValues.join(", ")}`}
        style={{ overflowX: "auto" }}
      >
        <table className="met-heatmap">
          <thead>
            <tr>
              <th scope="col"></th>
              {environments.map((env) => (
                <th scope="col" key={env.id}>
                  {env.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <th scope="row">{entry.label}</th>
                {environments.map((env) => {
                  const value = valueByCell.get(`${entry.id}||${env.id}`);
                  const pct =
                    value == null || range === 0
                      ? 0
                      : Math.round(((value - min) / range) * 100);
                  return (
                    <td
                      key={env.id}
                      style={
                        value == null
                          ? undefined
                          : {
                              backgroundColor: `color-mix(in srgb, var(--teal) ${pct}%, var(--surface))`,
                            }
                      }
                    >
                      {value == null ? "—" : formatNumber(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Performance (x) vs stability (y, WAASB - lower is more stable) scatter
 * for one met_waasb_v1 result: the direct visual evidence for broad vs
 * specific adaptation (B31) - an entry in the bottom-right quadrant
 * (high performance, low WAASB) is both high-performing and stable across
 * environments. */
export function WaasbStabilityScatter({
  entries,
}: {
  entries: {
    entry_id: string;
    mean_performance: number;
    waasb: number;
  }[];
}) {
  if (entries.length === 0) return null;
  const data = entries.map((e) => ({
    x: e.mean_performance,
    y: e.waasb,
    label: e.entry_id,
  }));
  return (
    <div
      className="chart-area"
      role="img"
      aria-label={`Performance moyenne vs WAASB par entrée : ${entries
        .map(
          (e) =>
            `${e.entry_id} : performance ${formatNumber(e.mean_performance)}, WAASB ${formatNumber(e.waasb)}`,
        )
        .join(", ")}`}
    >
      <ResponsiveContainer width="100%" height={240}>
        <ScatterChart margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="x"
            name="Performance moyenne"
            width={44}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="WAASB (plus bas = plus stable)"
            width={44}
          />
          <ZAxis range={[40, 40]} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={data} fill="var(--teal)" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
