"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Card, EmptyState } from "@/components/ui";

const formatNumber = (value: number, decimals = 2) =>
  Number.isFinite(value) ? value.toFixed(decimals) : "—";

/** Histogram over pre-binned data (no dual axes, units shown in the
 * title). Always paired with a visible textual table (task §36: "accessible
 * text equivalent"). */
export function HistogramChart({
  title,
  unit,
  bins,
}: {
  title: string;
  unit: string | null;
  bins: { binStart: number; binEnd: number; count: number }[];
}) {
  const total = bins.reduce((sum, b) => sum + b.count, 0);
  const data = bins.map((bin, index) => ({
    label: `${formatNumber(bin.binStart, 1)}–${formatNumber(bin.binEnd, 1)}`,
    count: bin.count,
    key: index,
  }));
  return (
    <Card>
      <h3 className="chart-title">
        {title}
        {unit ? ` (${unit})` : ""}
      </h3>
      <p className="chart-description">n = {total}</p>
      {total > 0 ? (
        <>
          <div
            className="chart-area"
            role="img"
            aria-label={`Histogramme : ${data.map((d) => `${d.label} : ${d.count}`).join(", ")}`}
          >
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={data}
                margin={{ top: 4, right: 16, bottom: 24, left: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  angle={-30}
                  textAnchor="end"
                  height={50}
                />
                <YAxis allowDecimals={false} width={36} />
                <Tooltip
                  formatter={(value) => [String(value), "Observations"]}
                />
                <Bar
                  dataKey="count"
                  fill="var(--teal)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="chart-data-table">
            <caption>Valeurs de l’histogramme</caption>
            <thead>
              <tr>
                <th scope="col">Intervalle</th>
                <th scope="col">Observations</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.key}>
                  <td>{d.label}</td>
                  <td>{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <EmptyState
          title="Aucune donnée"
          message="Aucune observation numérique pour ce filtre."
        />
      )}
    </Card>
  );
}

/** A dependency-free box-and-whisker: Q1/median/Q3 as a filled box, min/max
 * as whiskers, drawn as plain SVG (Recharts has no native boxplot). The
 * same five numbers are already shown in the descriptive-statistics table
 * elsewhere on the page, which doubles as this chart's text equivalent. */
export function BoxPlot({
  min,
  q1,
  median,
  q3,
  max,
  unit,
}: {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  unit: string | null;
}) {
  const width = 320;
  const height = 70;
  const pad = 16;
  const scale = (v: number) =>
    pad + ((v - min) / (max - min || 1)) * (width - 2 * pad);
  const label = `Minimum ${formatNumber(min)}, premier quartile ${formatNumber(q1)}, médiane ${formatNumber(
    median,
  )}, troisième quartile ${formatNumber(q3)}, maximum ${formatNumber(max)}${unit ? ` ${unit}` : ""}`;
  return (
    <Card>
      <h3 className="chart-title">Distribution (boîte à moustaches)</h3>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={label}
        className="boxplot-svg"
      >
        <line
          x1={scale(min)}
          x2={scale(q1)}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--border)"
          strokeWidth={2}
        />
        <line
          x1={scale(q3)}
          x2={scale(max)}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--border)"
          strokeWidth={2}
        />
        <line
          x1={scale(min)}
          x2={scale(min)}
          y1={height / 2 - 10}
          y2={height / 2 + 10}
          stroke="var(--border)"
          strokeWidth={2}
        />
        <line
          x1={scale(max)}
          x2={scale(max)}
          y1={height / 2 - 10}
          y2={height / 2 + 10}
          stroke="var(--border)"
          strokeWidth={2}
        />
        <rect
          x={scale(q1)}
          y={height / 2 - 18}
          width={Math.max(2, scale(q3) - scale(q1))}
          height={36}
          fill="var(--teal-soft)"
          stroke="var(--teal)"
          strokeWidth={2}
        />
        <line
          x1={scale(median)}
          x2={scale(median)}
          y1={height / 2 - 18}
          y2={height / 2 + 18}
          stroke="var(--teal)"
          strokeWidth={3}
        />
      </svg>
      <p className="chart-description">{label}</p>
    </Card>
  );
}

export type TrajectoryEntity = {
  phenotypeCode: string;
  points: { date: string; value: number }[];
};
export type TrajectoryPopulationPoint = {
  date: string;
  n: number;
  mean: number;
  median: number;
  q1: number;
  q3: number;
};

/** Population summary band (q1-q3) + median line, with optionally
 * highlighted individual entity lines on top - never hundreds of raw lines
 * at once (task §15: avoid an unreadable "spaghetti plot"); the caller
 * already caps `entities`. */
export function TrajectoryChart({
  title,
  unit,
  population,
  entities,
  truncatedEntities,
}: {
  title: string;
  unit: string | null;
  population: TrajectoryPopulationPoint[];
  entities: TrajectoryEntity[];
  truncatedEntities: boolean;
}) {
  if (population.length === 0) {
    return (
      <Card>
        <h3 className="chart-title">{title}</h3>
        <EmptyState
          title="Aucune donnée"
          message="Aucune date d’évaluation exploitable pour ce filtre."
        />
      </Card>
    );
  }
  const dates = population.map((p) => p.date);
  const merged = population.map((p) => {
    const row: Record<string, number | string> = {
      date: p.date,
      median: p.median,
      band: p.q3 - p.q1,
      q1: p.q1,
    };
    for (const entity of entities) {
      const match = entity.points.find((pt) => pt.date === p.date);
      if (match) row[entity.phenotypeCode] = match.value;
    }
    return row;
  });
  const colors = ["#2f6f62", "#8a6d3b", "#3a6ea5", "#9b4f6c", "#6b8e23"];
  return (
    <Card>
      <h3 className="chart-title">
        {title}
        {unit ? ` (${unit})` : ""}
      </h3>
      <p className="chart-description">
        {population.length} dates d’observation · n par date :{" "}
        {population.map((p) => p.n).join(", ")}
        {truncatedEntities &&
          " · trajectoires individuelles limitées pour rester lisibles"}
      </p>
      <div
        className="chart-area"
        role="img"
        aria-label={`Trajectoire de population : médiane par date ${dates
          .map((d, i) => `${d} : ${formatNumber(population[i].median)}`)
          .join(", ")}`}
      >
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart
            data={merged}
            margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis width={44} />
            <Tooltip />
            <Area
              dataKey="q1"
              stackId="band"
              stroke="none"
              fill="transparent"
            />
            <Area
              dataKey="band"
              stackId="band"
              stroke="none"
              fill="var(--teal-soft)"
              fillOpacity={0.5}
            />
            <Line
              dataKey="median"
              stroke="var(--teal)"
              strokeWidth={3}
              dot={{ r: 3 }}
              name="Médiane population"
            />
            {entities.map((entity, index) => (
              <Line
                key={entity.phenotypeCode}
                dataKey={entity.phenotypeCode}
                stroke={colors[index % colors.length]}
                strokeWidth={1.5}
                strokeOpacity={0.6}
                dot={false}
                connectNulls
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <table className="chart-data-table">
        <caption>Résumé de population par date</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">n</th>
            <th scope="col">Médiane</th>
            <th scope="col">Q1</th>
            <th scope="col">Q3</th>
          </tr>
        </thead>
        <tbody>
          {population.map((p) => (
            <tr key={p.date}>
              <td>{p.date}</td>
              <td>{p.n}</td>
              <td>{formatNumber(p.median)}</td>
              <td>{formatNumber(p.q1)}</td>
              <td>{formatNumber(p.q3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** A single scatter plot for one trait pair, with units and sample size in
 * the visible description (task §36). */
export function AssociationScatter({
  xLabel,
  yLabel,
  points,
}: {
  xLabel: string;
  yLabel: string;
  points: { x: number; y: number }[];
}) {
  if (points.length === 0) return null;
  return (
    <Card>
      <h3 className="chart-title">
        {xLabel} vs {yLabel}
      </h3>
      <p className="chart-description">n = {points.length}</p>
      <div
        className="chart-area"
        role="img"
        aria-label={`Nuage de points ${xLabel} contre ${yLabel}, ${points.length} paires`}
      >
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" dataKey="x" name={xLabel} width={44} />
            <YAxis type="number" dataKey="y" name={yLabel} width={44} />
            <ZAxis range={[40, 40]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={points} fill="var(--teal)" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
