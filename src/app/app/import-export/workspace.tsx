"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Card,
  DataTable,
  EmptyState,
  PageNotice,
  SectionHeader,
  StatusBadge,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  ENTITY_SPECS,
  IMPORT_ENTITY_ORDER,
  type EntityKey,
} from "@/lib/import-export/entities";
import {
  suggestMapping,
  type ColumnMapping,
} from "@/lib/import-export/mapping";
import { writeCsv } from "@/lib/import-export/csv";
import {
  applyImportAction,
  parseWorkbookAction,
  previewImportAction,
  type ParsedSheet,
} from "./actions";
import type { RowPreview } from "@/lib/import-export/preview";

type Step = "select" | "map" | "preview" | "report";

function downloadText(filename: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportExportWorkspace({
  programId,
  organizationId,
}: {
  programId: string | null;
  organizationId: string;
}) {
  const [entity, setEntity] = useState<EntityKey>("parent_lines");
  const [step, setStep] = useState<Step>("select");
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [preview, setPreview] = useState<{
    rows: RowPreview[];
    summary: {
      total: number;
      valid: number;
      warning: number;
      error: number;
      create: number;
      update: number;
      skip: number;
    };
  } | null>(null);
  const [report, setReport] = useState<{
    created: number;
    updated: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const spec = ENTITY_SPECS[entity];
  const scopeId = spec.scope === "organization" ? organizationId : programId;
  const allFields = useMemo(
    () => [
      ...spec.fields,
      ...spec.references.map((r) => ({
        key: r.key,
        label: r.label,
        type: "text" as const,
        requiredOnCreate: r.requiredOnCreate,
        immutable: true,
      })),
    ],
    [spec],
  );

  const sheet = sheets?.[sheetIndex] ?? null;

  function reset(nextEntity: EntityKey) {
    setEntity(nextEntity);
    setStep("select");
    setSheets(null);
    setMapping({});
    setPreview(null);
    setReport(null);
    setError(null);
  }

  function handleFile(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await parseWorkbookAction(formData);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setSheets(result.sheets);
      setSheetIndex(0);
      setMapping(suggestMapping(result.sheets[0].headers, allFields));
      setStep("map");
    });
  }

  function runPreview() {
    if (!scopeId || !sheet) return;
    setError(null);
    startTransition(async () => {
      const result = await previewImportAction({
        entity,
        scopeId,
        mapping,
        dataRows: sheet.dataRows,
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setPreview(result);
      setStep("preview");
    });
  }

  function runApply() {
    if (!scopeId || !preview) return;
    const rows = preview.rows
      .filter((r) => r.operation === "create" || r.operation === "update")
      .map((r) => r.payload);
    setError(null);
    startTransition(async () => {
      const result = await applyImportAction({ entity, scopeId, rows });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setReport({ created: result.created, updated: result.updated });
      setStep("report");
    });
  }

  function downloadErrorReport() {
    if (!preview) return;
    const errorRows = preview.rows.filter((r) => r.status === "error");
    const csv = writeCsv([
      ["Ligne", "Code", "Erreurs"],
      ...errorRows.map((r) => [
        r.rowIndex,
        r.code ?? "",
        r.messages.join(" | "),
      ]),
    ]);
    downloadText(
      `breedops-${entity}-erreurs.csv`,
      csv,
      "text/csv;charset=utf-8",
    );
  }

  const canApply =
    step === "preview" &&
    preview !== null &&
    preview.summary.error === 0 &&
    (preview.summary.create > 0 || preview.summary.update > 0);

  return (
    <>
      <Card>
        <SectionHeader
          eyebrow="1. Importer"
          title="Choisir une entité et un fichier"
          description={`Formats acceptés : .csv, .xlsx (max ${10} Mo). Référence d'idempotence : ${spec.businessCodeLabel}.`}
        />
        <div className="chip-nav" role="group" aria-label="Entité à importer">
          {IMPORT_ENTITY_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              className={key === entity ? "active" : ""}
              onClick={() => reset(key)}
              disabled={isPending}
            >
              {ENTITY_SPECS[key].label}
            </button>
          ))}
        </div>
        {spec.scope === "program" && !programId && (
          <PageNotice tone="error">
            Sélectionnez un programme avant d&apos;importer.
          </PageNotice>
        )}
        <form
          action={handleFile}
          className="form"
          onSubmit={(event) => {
            if (
              !(
                event.currentTarget.elements.namedItem(
                  "file",
                ) as HTMLInputElement
              )?.files?.length
            ) {
              event.preventDefault();
              setError("Choisissez un fichier.");
            }
          }}
        >
          <label>
            Fichier
            <input
              type="file"
              name="file"
              accept=".csv,.xlsx"
              required
              disabled={isPending}
            />
          </label>
          <button
            type="submit"
            disabled={isPending || (spec.scope === "program" && !programId)}
          >
            {isPending && step === "select" ? "Lecture…" : "Charger"}
          </button>
        </form>
        {error && <PageNotice tone="error">{error}</PageNotice>}
      </Card>

      {sheets && sheet && (
        <Card>
          <SectionHeader
            eyebrow="2-4. Association des colonnes"
            title="Associer les colonnes du fichier aux champs BreedOps"
          />
          {sheets.length > 1 && (
            <label>
              Feuille
              <select
                value={sheetIndex}
                onChange={(event) => {
                  const index = Number(event.target.value);
                  setSheetIndex(index);
                  setMapping(suggestMapping(sheets[index].headers, allFields));
                  setPreview(null);
                  setStep("map");
                }}
              >
                {sheets.map((s, index) => (
                  <option key={s.name} value={index}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <DataTable label="Association des colonnes">
            <table>
              <thead>
                <tr>
                  <th>Champ BreedOps</th>
                  <th>Colonne source</th>
                </tr>
              </thead>
              <tbody>
                {allFields.map((field) => (
                  <tr key={field.key}>
                    <td>
                      {field.label}
                      {field.requiredOnCreate && (
                        <span aria-hidden="true"> *</span>
                      )}
                    </td>
                    <td>
                      <select
                        value={mapping[field.key] ?? ""}
                        onChange={(event) =>
                          setMapping((previous) => ({
                            ...previous,
                            [field.key]:
                              event.target.value === ""
                                ? null
                                : Number(event.target.value),
                          }))
                        }
                      >
                        <option value="">— Non mappé —</option>
                        {sheet.headers.map((header, index) => (
                          <option key={`${header}-${index}`} value={index}>
                            {header || `Colonne ${index + 1}`}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
          <button type="button" onClick={runPreview} disabled={isPending}>
            {isPending && step === "map" ? "Analyse…" : "Prévisualiser"}
          </button>
          {error && <PageNotice tone="error">{error}</PageNotice>}
        </Card>
      )}

      {step !== "select" && step !== "map" && preview && (
        <Card>
          <SectionHeader
            eyebrow="5-7. Prévisualisation et validation"
            title="Résultat de la prévisualisation"
          />
          <div className="metrics-row">
            {(
              [
                ["Total", preview.summary.total],
                ["Valides", preview.summary.valid],
                ["Avertissements", preview.summary.warning],
                ["Erreurs", preview.summary.error],
                ["Créations", preview.summary.create],
                ["Mises à jour", preview.summary.update],
              ] as const
            ).map(([label, value]) => (
              <article className="metric" key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          <DataTable label="Lignes prévisualisées">
            <table>
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th>Code</th>
                  <th>Opération</th>
                  <th>État</th>
                  <th>Messages</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowIndex}>
                    <td className="code">{row.rowIndex}</td>
                    <td className="code">{row.code ?? "—"}</td>
                    <td>{row.operation ?? "—"}</td>
                    <td>
                      <StatusBadge
                        tone={
                          row.status === "error"
                            ? "danger"
                            : row.status === "warning"
                              ? "warning"
                              : "success"
                        }
                      >
                        {row.status}
                      </StatusBadge>
                    </td>
                    <td>{row.messages.join(" | ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
          <div className="page-actions">
            <button
              type="button"
              className="secondary"
              onClick={downloadErrorReport}
              disabled={preview.summary.error === 0}
            >
              <Icon name="download" size={14} /> Télécharger le rapport
              d&apos;erreurs
            </button>
            <button
              type="button"
              onClick={runApply}
              disabled={!canApply || isPending}
            >
              {isPending && step === "preview" ? "Import…" : "Importer"}
            </button>
          </div>
          {error && <PageNotice tone="error">{error}</PageNotice>}
        </Card>
      )}

      {step === "report" && report && (
        <Card>
          <SectionHeader eyebrow="9. Rapport final" title="Import terminé" />
          <PageNotice tone="success">
            {report.created} ligne(s) créée(s), {report.updated} ligne(s)
            mise(s) à jour.
          </PageNotice>
          <button
            type="button"
            className="secondary"
            onClick={() => reset(entity)}
          >
            Nouvel import
          </button>
        </Card>
      )}

      <Card>
        <SectionHeader eyebrow="Export" title="Exporter un registre" />
        <div
          className="table-wrap"
          role="region"
          aria-label="Exports disponibles"
        >
          <table>
            <thead>
              <tr>
                <th>Registre</th>
                <th>CSV</th>
                <th>Excel</th>
              </tr>
            </thead>
            <tbody>
              {IMPORT_ENTITY_ORDER.map((key) => {
                const exportSpec = ENTITY_SPECS[key];
                const exportScopeId =
                  exportSpec.scope === "organization"
                    ? organizationId
                    : programId;
                if (!exportScopeId) return null;
                const query = new URLSearchParams({
                  entity: key,
                  ...(exportSpec.scope === "program"
                    ? { program: exportScopeId }
                    : {}),
                });
                return (
                  <tr key={key}>
                    <td>{exportSpec.label}</td>
                    <td>
                      <a
                        className="button-link secondary"
                        href={`/app/import-export/export?${query.toString()}&format=csv`}
                      >
                        Télécharger
                      </a>
                    </td>
                    <td>
                      <a
                        className="button-link secondary"
                        href={`/app/import-export/export?${query.toString()}&format=xlsx`}
                      >
                        Télécharger
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <SectionHeader
          eyebrow="Sauvegarde fonctionnelle"
          title="Exporter une sauvegarde portable du programme"
          description="Un classeur Excel complet (identifiants métier stables, horodatage, version de format) — pas une sauvegarde PostgreSQL. Les fichiers média ne sont pas inclus ; leurs métadonnées le sont."
        />
        {programId ? (
          <a
            className="button-link"
            href={`/app/import-export/backup?program=${programId}`}
          >
            Télécharger la sauvegarde (.xlsx)
          </a>
        ) : (
          <EmptyState
            title="Aucun programme"
            message="Sélectionnez un programme pour générer une sauvegarde."
          />
        )}
      </Card>
    </>
  );
}
