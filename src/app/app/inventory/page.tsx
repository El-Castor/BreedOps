import { ActionForm } from "@/components/action-form";
import {
  Breadcrumbs,
  EmptyState,
  ErrorState,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
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

  return (
    <div className="page">
      <Breadcrumbs
        items={[{ label: "Accueil", href: "/app" }, { label: "Inventaire" }]}
      />
      <PageHeader
        eyebrow={team.name}
        title="Inventaire et mouvements"
        description="Suivez les articles, lots, stocks et mouvements dans un registre transactionnel."
      />
      <section className="grid-2">
        <ActionForm
          action={createInventoryItem}
          className="card form"
          actionName="inventory-item"
          submitLabel="Créer l’article"
        >
          <h2>Nouvel article</h2>
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
          <div className="fields-3">
            <label>
              CAS
              <input name="cas_number" maxLength={80} />
            </label>
            <label>
              Référence fournisseur
              <input name="supplier_reference" maxLength={120} />
            </label>
            <label>
              Stockage
              <input name="storage_requirements" maxLength={300} />
            </label>
          </div>
        </ActionForm>
        <ActionForm
          action={createInventoryLot}
          className="card form"
          actionName="inventory-lot"
          submitLabel="Créer et réceptionner"
          disabled={!items?.length}
        >
          <h2>Nouveau lot et réception</h2>
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
          <div className="fields-3">
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
            <p className="form-hint">Créez d’abord un article.</p>
          )}
        </ActionForm>
      </section>
      <section className="card">
        <h2>Mouvement traçable</h2>
        <ActionForm
          action={recordInventoryMovement}
          className="form"
          actionName="inventory-movement"
          submitLabel="Enregistrer le mouvement"
          disabled={!lots?.length}
        >
          <div className="fields-3">
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
          <div className="fields-3">
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
          </div>
          {!lots?.length && (
            <p className="form-hint">Réceptionnez d’abord un lot.</p>
          )}
        </ActionForm>
      </section>
      <section className="card table-wrap">
        <div className="section-heading">
          <h2>Lots et alertes</h2>
          <form method="get">
            <input
              name="q"
              defaultValue={query}
              placeholder="Article, CAS, référence"
            />
            <button>Rechercher</button>
          </form>
        </div>
        <table>
          <thead>
            <tr>
              <th>Article</th>
              <th>Lot</th>
              <th>Stock</th>
              <th>Péremption</th>
              <th>Alerte</th>
              <th>Emplacement</th>
            </tr>
          </thead>
          <tbody>
            {displayLots?.map((lot) => {
              const item = items?.find(
                (value) => value.id === lot.inventory_item_id,
              );
              const alert = alertFor(lot.id);
              return (
                <tr key={lot.id}>
                  <td>{item?.name}</td>
                  <td>{lot.batch_number}</td>
                  <td>
                    {lot.current_quantity} {item?.default_unit}
                  </td>
                  <td>{lot.expiration_date ?? "—"}</td>
                  <td>
                    <StatusBadge
                      tone={
                        alert?.alert_level === "urgent" ? "danger" : "neutral"
                      }
                    >
                      {alert?.alert_level ?? "ok"}
                    </StatusBadge>
                    {alert?.days_before_expiration != null
                      ? ` · ${alert.days_before_expiration} j`
                      : ""}
                  </td>
                  <td>{lot.storage_location ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!displayLots?.length && (
          <EmptyState
            title="Aucun lot"
            message="Créez un article puis réceptionnez son premier lot."
          />
        )}
      </section>
      <section className="card table-wrap">
        <h2>Historique des mouvements</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Lot</th>
              <th>Type</th>
              <th>Quantité</th>
              <th>Motif</th>
            </tr>
          </thead>
          <tbody>
            {movements?.map((movement) => (
              <tr key={movement.id}>
                <td>{movement.movement_date}</td>
                <td>{lotName(movement.inventory_lot_id)}</td>
                <td>{movement.movement_type}</td>
                <td>
                  {movement.quantity} {movement.unit}
                </td>
                <td>{movement.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!movements?.length && (
          <EmptyState
            title="Aucun mouvement"
            message="Les réceptions, consommations et ajustements apparaîtront ici."
          />
        )}
      </section>
    </div>
  );
}
