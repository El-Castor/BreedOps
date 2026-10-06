"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type BreedingEntityDetail,
  useEntityInspector,
} from "@/components/entity-inspector";

export type PedigreeNode = {
  id: string;
  kind: "parent" | "cross" | "family" | "lot";
  code: string;
  name?: string | null;
  generation?: number | null;
  entity: BreedingEntityDetail;
};

export type PedigreeEdge = { from: string; to: string };

const colors = {
  parent: "#1f766e",
  cross: "#975a16",
  family: "#5b5aa5",
  lot: "#5f6f52",
};

export function PedigreeGraph({
  nodes,
  edges,
  initialSelectedId,
}: {
  nodes: PedigreeNode[];
  edges: PedigreeEdge[];
  initialSelectedId?: string | null;
}) {
  const { open } = useEntityInspector();
  const [selected, setSelected] = useState<string | null>(
    initialSelectedId ?? null,
  );
  // A pedigree link from the inspector (?entity=kind:id) reopens that record.
  useEffect(() => {
    const entity = nodes.find((node) => node.id === initialSelectedId)?.entity;
    if (entity) open(entity);
  }, [initialSelectedId, nodes, open]);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 30, y: 35 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const positions = useMemo(() => {
    const columns = ["parent", "cross", "family", "lot"] as const;
    return new Map(
      columns.flatMap((kind, column) =>
        nodes
          .filter((node) => node.kind === kind)
          .map(
            (node, row) =>
              [node.id, { x: column * 260 + 30, y: row * 105 + 35 }] as const,
          ),
      ),
    );
  }, [nodes]);
  const related = useMemo(() => {
    if (!selected) return new Set<string>();
    const found = new Set([selected]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) {
        if (found.has(edge.from) || found.has(edge.to)) {
          if (!found.has(edge.from) || !found.has(edge.to)) changed = true;
          found.add(edge.from);
          found.add(edge.to);
        }
      }
    }
    return found;
  }, [edges, selected]);
  const height = Math.max(
    420,
    ...(["parent", "cross", "family", "lot"] as const).map(
      (kind) => nodes.filter((node) => node.kind === kind).length * 105 + 80,
    ),
  );
  const center = (id: string) => {
    const position = positions.get(id);
    if (!position) return;
    setSelected(id);
    const entity = nodes.find((node) => node.id === id)?.entity;
    if (entity) open(entity);
    setOffset({ x: 430 - position.x * scale, y: 220 - position.y * scale });
  };
  return (
    <div className="pedigree-layout">
      <section
        className="pedigree-stage"
        aria-label="Graphe de pedigree interactif"
      >
        <div className="graph-toolbar" aria-label="Contrôles du graphe">
          <button
            type="button"
            onClick={() => setScale((v) => Math.min(2, v + 0.15))}
          >
            Zoom +
          </button>
          <button
            type="button"
            onClick={() => setScale((v) => Math.max(0.45, v - 0.15))}
          >
            Zoom −
          </button>
          <button
            type="button"
            onClick={() => {
              setScale(1);
              setOffset({ x: 30, y: 35 });
            }}
          >
            Ajuster la vue
          </button>
        </div>
        <svg
          role="img"
          aria-label="Relations entre parents, croisements, familles et lots"
          viewBox={`0 0 1080 ${height}`}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget)
              setDrag({
                x: event.clientX - offset.x,
                y: event.clientY - offset.y,
              });
          }}
          onPointerMove={(event) => {
            if (drag)
              setOffset({
                x: event.clientX - drag.x,
                y: event.clientY - drag.y,
              });
          }}
          onPointerUp={() => setDrag(null)}
          onPointerLeave={() => setDrag(null)}
        >
          <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
            {edges.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (!from || !to) return null;
              const muted =
                selected && !(related.has(edge.from) && related.has(edge.to));
              return (
                <path
                  key={`${edge.from}-${edge.to}`}
                  d={`M ${from.x + 170} ${from.y + 28} C ${from.x + 215} ${from.y + 28}, ${to.x - 45} ${to.y + 28}, ${to.x} ${to.y + 28}`}
                  className={muted ? "graph-edge muted" : "graph-edge"}
                />
              );
            })}
            {nodes.map((node) => {
              const position = positions.get(node.id)!;
              const muted = selected && !related.has(node.id);
              return (
                <g
                  key={node.id}
                  className={`graph-node ${selected === node.id ? "selected" : ""} ${muted ? "muted" : ""}`}
                  transform={`translate(${position.x} ${position.y})`}
                  onClick={() => center(node.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.kind} ${node.code}`}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      // Without this the key's default activation lands on
                      // the inspector close button that just received focus.
                      event.preventDefault();
                      center(node.id);
                    }
                  }}
                >
                  <rect
                    width="170"
                    height="58"
                    rx="10"
                    fill={colors[node.kind]}
                  />
                  <text x="12" y="23">
                    {node.code}
                  </text>
                  <text className="node-kind" x="12" y="43">
                    {node.kind}
                    {node.generation != null ? ` · G${node.generation}` : ""}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </section>
    </div>
  );
}
