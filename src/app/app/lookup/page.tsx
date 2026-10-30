import Link from "next/link";
import { Breadcrumbs, Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireIdentity } from "@/lib/auth";
import { resolveQrEntity, resolveQrEntityByCode } from "@/lib/qr/entities";
import { QR_ENTITY_TYPE_LABELS } from "@/lib/qr/labels";

// The one canonical QR scan destination for every BreedOps entity (see
// agend.md V2-01). Scanning a QR never grants access by itself: this page
// sits under /app/* like every other route, so an unauthenticated scan is
// redirected through the normal login first (src/middleware.ts preserves
// ?type=&id= via the "next" parameter - src/lib/safe-next-path.ts). Once
// authenticated, the entity is resolved through the caller's own
// RLS-scoped client (requireIdentity().client) - the exact same
// authorization path every other page in this app uses, never re-derived
// or weakened here. An entity type/id that is malformed, unsupported, or
// simply not accessible to this caller all produce the identical "not
// found" message below - never a distinguishing error - so this page
// cannot be used to enumerate what exists in another team's or program's
// data.
export default async function LookupPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; id?: string; code?: string }>;
}) {
  const { client } = await requireIdentity();
  const params = await searchParams;
  const hasTypeAndId = Boolean(params.type && params.id);
  const attemptedLookup = hasTypeAndId || Boolean(params.code);
  const entity = hasTypeAndId
    ? await resolveQrEntity(client, params.type, params.id)
    : params.code
      ? await resolveQrEntityByCode(client, params.code)
      : null;

  return (
    <div className="page">
      <Breadcrumbs
        items={[{ label: "Accueil", href: "/app" }, { label: "Recherche" }]}
      />
      <PageHeader
        eyebrow="Identification rapide"
        title="Rechercher une entité"
        description="Destination d’un code QR scanné, ou recherche manuelle par code métier."
      />
      {entity && (
        <Card>
          <p className="eyebrow">{QR_ENTITY_TYPE_LABELS[entity.type]}</p>
          <h2>{entity.code ?? entity.title}</h2>
          {entity.code && entity.title !== entity.code && <p>{entity.title}</p>}
          {entity.subtitle && <p>{entity.subtitle}</p>}
          <p>
            {entity.archived ? (
              <StatusBadge tone="archived">Archivé</StatusBadge>
            ) : entity.status ? (
              <StatusBadge tone="neutral">{entity.status}</StatusBadge>
            ) : null}
          </p>
          <Link className="button-link" href={entity.registryHref}>
            Voir dans le registre
          </Link>
        </Card>
      )}
      {!entity && attemptedLookup && (
        <Card>
          <p role="alert">
            Aucune entité correspondante n’a été trouvée, ou vous n’y avez pas
            accès.
          </p>
        </Card>
      )}
      <Card>
        <h2>Recherche manuelle</h2>
        <p>
          Si le code QR est endommagé ou illisible, saisissez le code métier
          affiché sur l’étiquette (lignée, croisement, famille ou lot de
          graines).
        </p>
        <form method="get" className="form inline-form">
          <label className="sr-only" htmlFor="lookup-code">
            Code métier
          </label>
          <input
            id="lookup-code"
            name="code"
            required
            maxLength={120}
            defaultValue={params.code ?? ""}
            placeholder="Ex. NAD-P-0001"
          />
          <button type="submit">Rechercher</button>
        </form>
      </Card>
    </div>
  );
}
