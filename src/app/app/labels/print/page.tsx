import { Breadcrumbs, Card, EmptyState, PageHeader } from "@/components/ui";
import { PrintLabelButton } from "@/components/print-label-button";
import { QrLabel } from "@/components/qr-label";
import { requireIdentity } from "@/lib/auth";
import { resolveQrEntity } from "@/lib/qr/entities";
import { buildLookupUrl } from "@/lib/qr/payload";
import { renderQrSvg } from "@/lib/qr/svg";

const MAX_LABELS = 100;

function parseItems(raw: string | undefined): { type: string; id: string }[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const items: { type: string; id: string }[] = [];
  for (const entry of raw.split(",")) {
    if (items.length >= MAX_LABELS) break;
    const separator = entry.indexOf(":");
    if (separator < 1) continue;
    const type = entry.slice(0, separator);
    const id = entry.slice(separator + 1);
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type, id });
  }
  return items;
}

// Multi-label print sheet (requirement: select several rows from an
// existing registry, print them together). Each requested (type, id) pair
// is resolved independently through the caller's own RLS-scoped client -
// exactly like the single-entity lookup page - so a malformed, unsupported,
// or inaccessible entry is simply dropped from the sheet rather than
// breaking the whole print job or leaking anything about it.
export default async function LabelsPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ items?: string }>;
}) {
  const { client } = await requireIdentity();
  const params = await searchParams;
  const requested = parseItems(params.items);
  const origin = process.env.APP_ORIGIN || "http://localhost:3107";
  const labels = (
    await Promise.all(
      requested.map(async ({ type, id }) => {
        const entity = await resolveQrEntity(client, type, id);
        if (!entity) return null;
        const svg = await renderQrSvg(
          buildLookupUrl(origin, entity.type, entity.id),
        );
        return { entity, svg };
      }),
    )
  ).filter((value): value is NonNullable<typeof value> => value !== null);

  return (
    <div className="page">
      <Breadcrumbs
        items={[{ label: "Accueil", href: "/app" }, { label: "Étiquettes" }]}
      />
      <PageHeader
        eyebrow="Impression"
        title="Étiquettes à imprimer"
        description={`${labels.length} étiquette${labels.length > 1 ? "s" : ""} prête${labels.length > 1 ? "s" : ""}.`}
        actions={labels.length > 0 ? <PrintLabelButton /> : undefined}
      />
      {labels.length === 0 ? (
        <EmptyState
          title="Aucune étiquette"
          message="Sélectionnez au moins une ligne dans un registre avant d’imprimer."
        />
      ) : (
        <Card className="print-area label-sheet">
          {labels.map(({ entity, svg }) => (
            <QrLabel
              key={`${entity.type}:${entity.id}`}
              type={entity.type}
              svg={svg}
              code={entity.code}
              title={entity.title}
              subtitle={entity.subtitle}
            />
          ))}
        </Card>
      )}
    </div>
  );
}
