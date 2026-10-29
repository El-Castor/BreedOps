import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { FormDrawer } from "@/components/form-drawer";
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
const equipmentStatusLabels: Record<
  string,
  { label: string; tone: "success" | "warning" | "danger" }
> = {
  operational: { label: "Opérationnel", tone: "success" },
  maintenance: { label: "En maintenance", tone: "warning" },
  out_of_service: { label: "Hors service", tone: "danger" },
};
import { requireIdentity } from "@/lib/auth";
import { collectionState } from "@/lib/query-state";
import {
  createEquipment,
  createInventoryItem,
  createInventoryLot,
  recordInventoryMovement,
  setEquipmentArchived,
  updateEquipmentStatus,
} from "./actions";

export default async function Inventory({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; eq?: string }>;
}) {
  const { client, team } = await requireIdentity();
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const equipmentQuery = params.eq?.trim() ?? "";
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

  const [equipmentResult, coverageResult] = await Promise.all([
    client
      .from("equipment")
      .select(
        "id,name,category,manufacturer,model,serial_number,location,operational_status,commissioned_at,next_maintenance_at,notes,deleted_at",
      )
      .eq("organization_id", team.id)
      .order("name"),
    client
      .from("inventory_item_coverage")
      .select(
        "inventory_item_id,name,default_unit,minimum_stock,current_quantity,average_weekly_consumption,estimated_weeks_remaining,has_sufficient_data,low_coverage",
      )
      .order("name"),
  ]);
  const equipmentState = collectionState(
    equipmentResult,
    "Impossible de charger les équipements.",
  );
  const coverageState = collectionState(
    coverageResult,
    "Impossible de charger la couverture de stock.",
  );
  const failedExtra = [equipmentState, coverageState].find(
    (state) => state.status === "error",
  );
  if (failedExtra?.status === "error")
    return (
      <div className="page">
        <ErrorState message={failedExtra.message} retryHref="/app/inventory" />
      </div>
    );
  const equipment = equipmentState.data;
  const coverage = coverageState.data;
  const equipmentNeedle = equipmentQuery.toLocaleLowerCase();
  const displayEquipment = equipmentQuery
    ? equipment?.filter((item) =>
        [
          item.name,
          item.category,
          item.manufacturer,
          item.model,
          item.serial_number,
          item.location,
        ].some((value) => value?.toLocaleLowerCase().includes(equipmentNeedle)),
      )
    : equipment;
  const lowCoverageCount = (coverage ?? []).filter(
    (item) => item.low_coverage,
  ).length;
  return (
    <div className="page">
      <Breadcrumbs
        items={[{ label: "Accueil", href: "/app" }, { label: "Inventaire" }]}
      />
      <PageHeader
        eyebrow={`Laboratoire · ${team.name}`}
        title="Inventaire et mouvements"
        description="Articles, lots, stocks et mouvements dans un registre transactionnel. Les quantités sont recalculées par PostgreSQL."
        actions={
          <>
            <Link
              className="button-link secondary"
              href="/app/import-export/export?entity=inventory_lots&format=csv"
              title="Exporter l’inventaire (lots de réactifs — CSV)"
            >
              Exporter l’inventaire
            </Link>
            <FormDrawer
              label="Nouvel article"
              title="Nouvel article"
              description="Article de laboratoire suivi en stock."
              icon="add"
            >
              <ActionForm
                action={createInventoryItem}
                className="form"
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
            </FormDrawer>
            <FormDrawer
              label="Nouveau lot"
              title="Nouveau lot et réception"
              description="La réception crée le premier mouvement du lot."
              icon="lot"
              variant="secondary"
              disabled={!items?.length}
              disabledReason="Créez d’abord un article"
            >
              <ActionForm
                action={createInventoryLot}
                className="form"
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
            </FormDrawer>
            <FormDrawer
              label="Mouvement"
              title="Mouvement traçable"
              description="Consommation, retour, ajustement ou destruction."
              icon="history"
              variant="secondary"
              disabled={!lots?.length}
              disabledReason="Réceptionnez d’abord un lot"
            >
              <ActionForm
                action={recordInventoryMovement}
                className="form"
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
                      <option value="positive_adjustment">
                        Ajustement positif
                      </option>
                      <option value="negative_adjustment">
                        Ajustement négatif
                      </option>
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
                  <p className="form-hint blocked">
                    Réceptionnez d’abord un lot.
                  </p>
                )}
              </ActionForm>
            </FormDrawer>
            <FormDrawer
              label="Nouvel équipement"
              title="Nouvel équipement"
              description="Registre opérationnel du laboratoire — sans quantité ni mouvement."
              icon="add"
              variant="secondary"
            >
              <ActionForm
                action={createEquipment}
                className="form"
                actionName="equipment"
                submitLabel="Ajouter l’équipement"
              >
                <h3>Nouvel équipement</h3>
                <input type="hidden" name="organization_id" value={team.id} />
                <label>
                  Nom
                  <input name="name" required maxLength={160} />
                </label>
                <div className="fields-2">
                  <label>
                    Catégorie
                    <input name="category" required maxLength={80} />
                  </label>
                  <label>
                    Statut
                    <select
                      name="operational_status"
                      defaultValue="operational"
                    >
                      <option value="operational">Opérationnel</option>
                      <option value="maintenance">En maintenance</option>
                      <option value="out_of_service">Hors service</option>
                    </select>
                  </label>
                </div>
                <div className="fields-2">
                  <label>
                    Fabricant
                    <input name="manufacturer" maxLength={160} />
                  </label>
                  <label>
                    Modèle
                    <input name="model" maxLength={160} />
                  </label>
                </div>
                <div className="fields-2">
                  <label>
                    Numéro de série
                    <input name="serial_number" maxLength={160} />
                  </label>
                  <label>
                    Emplacement
                    <input name="location" maxLength={160} />
                  </label>
                </div>
                <div className="fields-2">
                  <label>
                    Mise en service
                    <input name="commissioned_at" type="date" />
                  </label>
                  <label>
                    Prochaine maintenance
                    <input name="next_maintenance_at" type="date" />
                  </label>
                </div>
                <label>
                  Notes
                  <textarea name="notes" maxLength={1000} rows={2} />
                </label>
              </ActionForm>
            </FormDrawer>
          </>
        }
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
        <MetricCard label="Équipements" value={equipment.length} />
        <MetricCard
          label="Couverture faible"
          value={lowCoverageCount}
          attention={lowCoverageCount > 0}
        />
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

      <section>
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
      </section>

      <section className="section-block">
        <SectionHeader
          title="Couverture de stock estimée"
          description="Consommation réelle moyenne sur 90 jours (hors réceptions et ajustements) ; aucune estimation n’est affichée sans historique de consommation."
        />
        <Card className="flush">
          {coverage?.length ? (
            <DataTable label="Couverture de stock estimée">
              <table>
                <thead>
                  <tr>
                    <th>Article</th>
                    <th className="num">Stock</th>
                    <th className="num">Conso. moyenne / semaine</th>
                    <th className="num">Couverture estimée</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((item) => (
                    <tr key={item.inventory_item_id}>
                      <td>{item.name}</td>
                      <td className="num">
                        {item.current_quantity} {item.default_unit}
                      </td>
                      <td className="num">
                        {item.has_sufficient_data
                          ? `${item.average_weekly_consumption} ${item.default_unit}`
                          : "—"}
                      </td>
                      <td className="num">
                        {item.has_sufficient_data ? (
                          <>
                            {item.estimated_weeks_remaining} sem.
                            {item.low_coverage && (
                              <span className="secondary-line">
                                <StatusBadge tone="warning">
                                  Couverture faible
                                </StatusBadge>
                              </span>
                            )}
                          </>
                        ) : (
                          <StatusBadge tone="info">
                            Historique insuffisant
                          </StatusBadge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          ) : (
            <EmptyState
              title="Aucun article"
              message="Créez un article d’inventaire pour voir sa couverture estimée."
            />
          )}
        </Card>
      </section>

      <section className="section-block">
        <SectionHeader
          title="Équipements"
          description="Registre opérationnel du laboratoire — distinct des lots de réactifs."
          aside={
            <form method="get" className="inline-form" role="search">
              <label className="sr-only" htmlFor="equipment-search">
                Rechercher un équipement
              </label>
              <input
                id="equipment-search"
                type="search"
                name="eq"
                defaultValue={equipmentQuery}
                placeholder="Nom, catégorie, série, emplacement"
              />
              <button className="secondary">Rechercher</button>
            </form>
          }
        />
        <Card className="flush">
          {displayEquipment?.length ? (
            <DataTable label="Équipements">
              <table>
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Catégorie</th>
                    <th>Fabricant / modèle</th>
                    <th>Emplacement</th>
                    <th>Statut</th>
                    <th>Prochaine maintenance</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayEquipment.map((item) => {
                    const archived = Boolean(item.deleted_at);
                    const status =
                      equipmentStatusLabels[item.operational_status];
                    return (
                      <tr
                        key={item.id}
                        className={archived ? "archived" : undefined}
                      >
                        <td>
                          <strong className="code">{item.name}</strong>
                        </td>
                        <td>{item.category}</td>
                        <td>
                          {[item.manufacturer, item.model]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </td>
                        <td>{item.location ?? "—"}</td>
                        <td>
                          {archived ? (
                            <StatusBadge tone="archived">Archivé</StatusBadge>
                          ) : status ? (
                            <StatusBadge tone={status.tone}>
                              {status.label}
                            </StatusBadge>
                          ) : (
                            item.operational_status
                          )}
                        </td>
                        <td className="num">
                          {formatDay(item.next_maintenance_at)}
                        </td>
                        <td className="cell-actions">
                          {!archived && (
                            <ActionForm
                              action={updateEquipmentStatus}
                              actionName={`equipment-status-${item.id}`}
                              submitLabel="Changer"
                              className="inline-form"
                              resetOnSuccess={false}
                            >
                              <input type="hidden" name="id" value={item.id} />
                              <select
                                name="operational_status"
                                defaultValue={item.operational_status}
                              >
                                <option value="operational">
                                  Opérationnel
                                </option>
                                <option value="maintenance">
                                  En maintenance
                                </option>
                                <option value="out_of_service">
                                  Hors service
                                </option>
                              </select>
                            </ActionForm>
                          )}
                          <ActionForm
                            action={setEquipmentArchived}
                            actionName={`equipment-lifecycle-${item.id}`}
                            submitLabel={archived ? "Restaurer" : "Archiver"}
                            className="inline-form"
                            resetOnSuccess={false}
                          >
                            <input type="hidden" name="id" value={item.id} />
                            <input
                              type="hidden"
                              name="operation"
                              value={archived ? "restore" : "archive"}
                            />
                          </ActionForm>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataTable>
          ) : (
            <EmptyState
              title="Aucun équipement"
              message={
                equipmentQuery
                  ? `Aucun résultat pour « ${equipmentQuery} ».`
                  : "Ajoutez le premier équipement du laboratoire."
              }
            />
          )}
        </Card>
      </section>
    </div>
  );
}
