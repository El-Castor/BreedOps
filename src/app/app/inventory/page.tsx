import { ActionForm } from "@/components/action-form";
import {
  Breadcrumbs,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  MetricCard,
  PageHeader,
  SectionHeader,
  StatusBadge,
} from "@/components/ui";
import { formatDay } from "@/lib/breeding-entity-details";

const alertLabels: Record<
  string,
  { label: string; tone: "danger" | "warning" | "info" }
> = {
  expired: { label: "Périmé", tone: "danger" },
  urgent: { label: "Péremption < 30 j", tone: "danger" },
  plan: { label: "Péremption < 90 j", tone: "warning" },
  order: { label: "Sous le seuil", tone: "warning" },
};
const movementLabels: Record<string, string> = {
  receipt: "Réception",
  consumption: "Consommation",
  return: "Retour",
  positive_adjustment: "Ajustement +",
  negative_adjustment: "Ajustement −",
  destruction: "Destruction",
};
import { requireIdentity } from "@/lib/auth";
import { collectionState } from "@/lib/query-state";
import {
  createInventoryItem,
  createInventoryLot,
  recordInventoryMovement,
} from "./actions";

export default async function Inventory({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { client, team } = await requireIdentity();
  const query = (await searchParams).q?.trim() ?? "";
  const itemsState = collectionState(
    await client
      .from("inventory_items")
      .select(
        "id,category,name,cas_number,supplier_reference,default_unit,minimum_stock",
      )
      .eq("organization_id", team.id)
      .is("deleted_at", null)
      .order("name"),
    "Impossible de charger les articles d’inventaire.",
  );
  if (itemsState.status === "error")
    return (
      <div className="page">
        <ErrorState message={itemsState.message} retryHref="/app/inventory" />
      </div>
    );
  const items = itemsState.data;
  const itemIds = items.map((item) => item.id);
  const lotsState = collectionState(
    itemIds.length
      ? await client
          .from("inventory_lots")
          .select(
            "id,inventory_item_id,batch_number,received_at,expiration_date,current_quantity,storage_location,status",
          )
          .in("inventory_item_id", itemIds)
          .is("deleted_at", null)
          .order("expiration_date")
      : { data: [], error: null },
    "Impossible de charger les lots d’inventaire.",
  );
  if (lotsState.status === "error")
    return (
      <div className="page">
        <ErrorState message={lotsState.message} retryHref="/app/inventory" />
      </div>
    );
  const lots = lotsState.data;
  const needle = query.toLocaleLowerCase();
  const displayLots = query
    ? lots?.filter((lot) => {
        const item = items?.find((value) => value.id === lot.inventory_item_id);
        return [
          item?.name,
          item?.cas_number,
          item?.supplier_reference,
          lot.batch_number,
          lot.storage_location,
        ].some((value) => value?.toLocaleLowerCase().includes(needle));
      })
    : lots;
  const displayLotIds = displayLots?.map((lot) => lot.id) ?? [];
  const [movementsResult, statusesResult] = await Promise.all([
    displayLotIds.length
      ? client
          .from("inventory_movements")
          .select(
            "id,inventory_lot_id,movement_type,quantity,unit,movement_date,reason,created_at",
          )
          .in("inventory_lot_id", displayLotIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    displayLotIds.length
      ? client
          .from("inventory_lot_status")
          .select("inventory_lot_id,days_before_expiration,alert_level")
          .in("inventory_lot_id", displayLotIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const movementsState = collectionState(
    movementsResult,
    "Impossible de charger les mouvements.",
  );
  const statusesState = collectionState(
    statusesResult,
    "Impossible de charger les alertes de stock.",
  );
  const failed = [movementsState, statusesState].find(
    (state) => state.status === "error",
  );
  if (failed?.status === "error")
    return (
      <div className="page">
        <ErrorState message={failed.message} retryHref="/app/inventory" />
      </div>
    );
  const movements = movementsState.data;
  const statuses = statusesState.data;
  const itemName = (id: string) =>
    items?.find((item) => item.id === id)?.name ?? "—";
  const lotName = (id: string) =>
    lots?.find((lot) => lot.id === id)?.batch_number ?? "—";
  const alertFor = (id: string) =>
    statuses?.find((status) => status.inventory_lot_id === id);

  const alertCount = (statuses ?? []).filter((item) => item.alert_level).length;
  return (
    <div className="page">
      <Breadcrumbs
        items={[{ label: "Accueil", href: "/app" }, { label: "Inventaire" }]}
      />
      <PageHeader
        eyebrow={`Laboratoire · ${team.name}`}
        title="Inventaire et mouvements"
        description="Articles, lots, stocks et mouvements dans un registre transactionnel. Les quantités sont recalculées par PostgreSQL."
      />
      <section className="metrics-grid" aria-label="Synthèse de l’inventaire">
        <MetricCard label="Articles" value={items.length} />
        <MetricCard label="Lots actifs" value={lots.length} />
        <MetricCard
          label="Alertes"
          value={alertCount}
          attention={alertCount > 0}
        />
        <MetricCard label="Mouvements affichés" value={movements.length} />
      </section>

      <section className="section-block">
        <SectionHeader
          title="Lots et alertes"
          description="Stock courant, péremption et seuil minimal par lot."
          aside={
            <form method="get" className="inline-form" role="search">
              <label className="sr-only" htmlFor="inventory-search">
                Rechercher un lot
              </label>
              <input
                id="inventory-search"
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Article, CAS, référence"
              />
              <button className="secondary">Rechercher</button>
            </form>
          }
        />
        <Card className="flush">
          {displayLots?.length ? (
            <DataTable label="Lots et alertes">
              <table>
                <thead>
                  <tr>
                    <th>Article</th>
                    <th>Lot</th>
                    <th className="num">Stock</th>
                    <th>Péremption</th>
                    <th>Alerte</th>
                    <th>Emplacement</th>
                  </tr>
                </thead>
                <tbody>
                  {displayLots.map((lot) => {
                    const item = items?.find(
                      (value) => value.id === lot.inventory_item_id,
                    );
                    const alert = alertFor(lot.id);
                    const level = alert?.alert_level
                      ? alertLabels[alert.alert_level]
                      : null;
                    return (
                      <tr key={lot.id}>
                        <td>{item?.name}</td>
                        <td className="code">{lot.batch_number}</td>
                        <td className="num">
                          {lot.current_quantity} {item?.default_unit}
                        </td>
                        <td className="num">
                          {formatDay(lot.expiration_date)}
                          {alert?.days_before_expiration != null && (
                            <span className="secondary-line">
                              {alert.days_before_expiration} j
                            </span>
                          )}
                        </td>
                        <td>
                          {level ? (
                            <StatusBadge tone={level.tone}>
                              {level.label}
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone="success">Conforme</StatusBadge>
                          )}
                        </td>
                        <td>{lot.storage_location ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataTable>
          ) : (
            <EmptyState
              title="Aucun lot"
              message={
                query
                  ? `Aucun résultat pour « ${query} ».`
                  : "Créez un article puis réceptionnez son premier lot."
              }
            />
          )}
        </Card>
      </section>

      <section className="register-layout">
        <Card className="flush">
          <div className="card-heading">
            <h2>Historique des mouvements</h2>
          </div>
          {movements?.length ? (
            <DataTable label="Historique des mouvements">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Lot</th>
                    <th>Type</th>
                    <th className="num">Quantité</th>
                    <th>Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((movement) => (
                    <tr key={movement.id}>
                      <td className="num">
                        {formatDay(movement.movement_date)}
                      </td>
                      <td className="code">
                        {lotName(movement.inventory_lot_id)}
                      </td>
                      <td>
                        {movementLabels[movement.movement_type] ??
                          movement.movement_type}
                      </td>
                      <td className="num">
                        {movement.quantity} {movement.unit}
                      </td>
                      <td>{movement.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          ) : (
            <EmptyState
              title="Aucun mouvement"
              message="Les réceptions, consommations et ajustements apparaîtront ici."
            />
          )}
        </Card>
        <ActionForm
          action={recordInventoryMovement}
          className="card form"
          actionName="inventory-movement"
          submitLabel="Enregistrer le mouvement"
          disabled={!lots?.length}
        >
          <h3>Mouvement traçable</h3>
          <label>
            Lot
            <select name="inventory_lot_id" required>
              <option value="">Choisir</option>
              {lots?.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {itemName(lot.inventory_item_id)} · {lot.batch_number}
                </option>
              ))}
            </select>
          </label>
          <div className="fields-2">
            <label>
              Type
              <select name="movement_type" required>
                <option value="consumption">Consommation</option>
                <option value="receipt">Réception complémentaire</option>
                <option value="return">Retour</option>
                <option value="positive_adjustment">Ajustement positif</option>
                <option value="negative_adjustment">Ajustement négatif</option>
                <option value="destruction">Destruction</option>
              </select>
            </label>
            <label>
              Quantité
              <input
                name="quantity"
                type="number"
                min="0.01"
                step="0.01"
                required
              />
            </label>
          </div>
          <label>
            Date
            <input name="movement_date" type="date" required />
          </label>
          <label>
            Motif (obligatoire pour ajustement)
            <input name="reason" maxLength={300} />
          </label>
          <label>
            Notes
            <input name="notes" maxLength={500} />
          </label>
          {!lots?.length && (
            <p className="form-hint blocked">Réceptionnez d’abord un lot.</p>
          )}
        </ActionForm>
      </section>

      <section className="section-block">
        <SectionHeader
          eyebrow="Référentiel"
          title="Articles et réceptions"
          description="Déclarez un article puis réceptionnez ses lots."
        />
        <div className="grid-2">
          <ActionForm
            action={createInventoryItem}
            className="card form"
            actionName="inventory-item"
            submitLabel="Créer l’article"
          >
            <h3>Nouvel article</h3>
            <input type="hidden" name="organization_id" value={team.id} />
            <label>
              Nom
              <input name="name" required maxLength={160} />
            </label>
            <div className="fields-3">
              <label>
                Catégorie
                <input name="category" required maxLength={80} />
              </label>
              <label>
                Unité
                <input
                  name="default_unit"
                  required
                  maxLength={30}
                  defaultValue="units"
                />
              </label>
              <label>
                Stock minimal
                <input
                  name="minimum_stock"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                />
              </label>
            </div>
            <fieldset className="form-section">
              <legend>Références</legend>
              <div className="fields-2">
                <label>
                  CAS
                  <input name="cas_number" maxLength={80} />
                </label>
                <label>
                  Référence fournisseur
                  <input name="supplier_reference" maxLength={120} />
                </label>
              </div>
              <label>
                Stockage
                <input name="storage_requirements" maxLength={300} />
              </label>
            </fieldset>
          </ActionForm>
          <ActionForm
            action={createInventoryLot}
            className="card form"
            actionName="inventory-lot"
            submitLabel="Créer et réceptionner"
            disabled={!items?.length}
          >
            <h3>Nouveau lot et réception</h3>
            <label>
              Article
              <select name="inventory_item_id" required>
                <option value="">Choisir</option>
                {items?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="fields-3">
              <label>
                Lot
                <input name="batch_number" required maxLength={120} />
              </label>
              <label>
                Réception
                <input name="received_at" type="date" required />
              </label>
              <label>
                Péremption
                <input name="expiration_date" type="date" />
              </label>
            </div>
            <div className="fields-2">
              <label>
                Quantité reçue
                <input
                  name="quantity"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                />
              </label>
              <label>
                Emplacement
                <input name="storage_location" maxLength={160} />
              </label>
            </div>
            {!items?.length && (
              <p className="form-hint blocked">Créez d’abord un article.</p>
            )}
          </ActionForm>
        </div>
      </section>
    </div>
  );
}
