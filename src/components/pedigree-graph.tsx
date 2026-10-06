"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type BreedingEntityDetail,
  useEntityInspector,
} from "@/components/entity-inspector";
import { Icon } from "@/components/icons";

export type PedigreeNode = {
  id: string;
  kind: "parent" | "cross" | "family" | "lot";
  code: string;
  name?: string | null;
  generation?: number | null;
  archived?: boolean;
  entity: BreedingEntityDetail;
};

export type PedigreeEdge = { from: string; to: string };

const kinds = ["parent", "cross", "family", "lot"] as const;
const kindLabels = {
  parent: "Lignée",
  cross: "Croisement",
  family: "Famille",
  lot: "Lot",
} as const;
const columnLabels = {
  parent: "LIGNÉES PARENTALES",
  cross: "CROISEMENTS",
  family: "FAMILLES",
  lot: "LOTS DE GRAINES",
} as const;
const NODE_W = 176;
const NODE_H = 52;
const COL_W = 260;
const ROW_H = 96;
const TOP = 36;

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

// Kind icons (plant, merge, lineage group, seed package) keep node types
// distinguishable without relying on colour alone.
function NodeGlyph({ kind }: { kind: PedigreeNode["kind"] }) {
  return (
    <Icon
      name={kind}
      className="node-icon"
      x={NODE_W - 26}
      y={8}
      width={16}
      height={16}
    />
  );
}

export function PedigreeGraph({
  nodes,
  edges,
  initialSelectedId,
}: {
  nodes: PedigreeNode[];
  edges: PedigreeEdge[];
  initialSelectedId?: string | null;
}) {
  const { open, register } = useEntityInspector();
  useEffect(() => {
    for (const node of nodes) register(node.entity);
  }, [nodes, register]);
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
    return new Map(
      kinds.flatMap((kind, column) =>
        nodes
          .filter((node) => node.kind === kind)
          .map(
            (node, row) =>
              [
                node.id,
                { x: column * COL_W + 30, y: row * ROW_H + TOP },
              ] as const,
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
    ...kinds.map(
      (kind) =>
        nodes.filter((node) => node.kind === kind).length * ROW_H + TOP + 40,
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
      <div className="pedigree-legend" aria-label="Légende du pedigree">
        {kinds.map((kind) => (
          <span key={kind} className={`kind-badge ${kind}`}>
            {kindLabels[kind]}
          </span>
        ))}
        <span className="status-badge archived">Archivé</span>
        <span>
          Sélectionnez un nœud pour ouvrir sa fiche et suivre sa lignée.
        </span>
      </div>
      <section
        className="pedigree-stage"
        aria-label="Graphe de pedigree interactif"
      >
        <div className="graph-toolbar" aria-label="Contrôles du graphe">
          <button
            type="button"
            aria-label="Zoom +"
            data-tooltip="Zoom +"
            onClick={() => setScale((v) => Math.min(2, v + 0.15))}
          >
            <Icon name="zoomIn" />
          </button>
          <button
            type="button"
            aria-label="Zoom −"
            data-tooltip="Zoom −"
            onClick={() => setScale((v) => Math.max(0.45, v - 0.15))}
          >
            <Icon name="zoomOut" />
          </button>
          <button
            type="button"
            onClick={() => {
              setScale(1);
              setOffset({ x: 30, y: 35 });
            }}
          >
            <Icon name="fit" />
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
            {kinds.map((kind, column) => (
              <text
                key={kind}
                className="graph-column-label"
                x={column * COL_W + 30}
                y={TOP - 14}
              >
                {columnLabels[kind]}
              </text>
            ))}
            {edges.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (!from || !to) return null;
              const linked = related.has(edge.from) && related.has(edge.to);
              const state = !selected ? "" : linked ? " active" : " muted";
              const mid = NODE_H / 2;
              return (
                <path
                  key={`${edge.from}-${edge.to}`}
                  d={`M ${from.x + NODE_W} ${from.y + mid} C ${from.x + NODE_W + 42} ${from.y + mid}, ${to.x - 42} ${to.y + mid}, ${to.x} ${to.y + mid}`}
                  className={`graph-edge${state}`}
                />
              );
            })}
            {nodes.map((node) => {
              const position = positions.get(node.id)!;
              const muted = selected && !related.has(node.id);
              return (
                <g
                  key={node.id}
                  className={`graph-node ${node.kind}${selected === node.id ? " selected" : ""}${muted ? " muted" : ""}${node.archived ? " archived" : ""}`}
                  transform={`translate(${position.x} ${position.y})`}
                  onClick={() => center(node.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.kind} ${node.code}${node.archived ? " (archivé)" : ""}`}
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
                    className="node-body"
                    width={NODE_W}
                    height={NODE_H}
                    rx="6"
                  />
                  <rect
                    className="node-accent"
                    width="4"
                    height={NODE_H}
                    rx="2"
                  />
                  <NodeGlyph kind={node.kind} />
                  <text x="14" y="22">
                    {node.code}
                  </text>
                  <text className="node-kind" x="14" y="40">
                    {kindLabels[node.kind]}
                    {node.generation != null ? ` · G${node.generation}` : ""}
                    {node.archived ? " · archivé" : ""}
                    {node.name ? ` · ${truncate(node.name, 12)}` : ""}
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
