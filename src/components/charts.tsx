"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, EmptyState } from "@/components/ui";

export type DistributionItem = {
  label: string;
  value: number;
  /** One of the app's existing semantic CSS tokens (teal/botanical/warning/danger/info/archived). */
  tone?: string;
};

/** A horizontal bar chart for a real, server-computed categorical count —
 * never used with fabricated or placeholder data. Colors reuse the app's
 * existing semantic CSS custom properties (so bars already match the tone
 * of the matching status badge elsewhere, and follow dark/light mode
 * automatically) rather than a separate chart palette. Always paired with a
 * visible textual list of the same label/value pairs underneath — PROMPT.md
 * §11 requires an accessible tabular or textual alternative, not a
 * hover-only tooltip. */
export function DistributionChart({
  title,
  description,
  items,
  emptyMessage,
}: {
  title: string;
  description?: string;
  items: DistributionItem[];
  emptyMessage: string;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <Card>
      <h3 className="chart-title">{title}</h3>
      {description && <p className="chart-description">{description}</p>}
      {total > 0 ? (
        <>
          <div
            className="chart-area"
            role="img"
            aria-label={`${title} : ${items
              .filter((item) => item.value > 0)
              .map((item) => `${item.label} ${item.value}`)
              .join(", ")}`}
          >
            <ResponsiveContainer
              width="100%"
              height={Math.max(140, items.length * 36)}
            >
              <BarChart
                data={items}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} hide />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={130}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip formatter={(value) => [String(value), "Nombre"]} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22}>
                  {items.map((item, index) => (
                    <Cell
                      key={index}
                      fill={item.tone ? `var(--${item.tone})` : "var(--teal)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="chart-legend">
            {items.map((item) => (
              <li key={item.label}>
                <span
                  className="chart-legend-swatch"
                  style={{
                    background: item.tone
                      ? `var(--${item.tone})`
                      : "var(--teal)",
                  }}
                  aria-hidden="true"
                />
                {item.label} <strong>{item.value}</strong>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState title="Aucune donnée" message={emptyMessage} />
      )}
    </Card>
  );
}
