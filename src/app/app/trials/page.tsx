import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import {
  Breadcrumbs,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgramContext,
  ProgramSwitch,
  StatusBadge,
} from "@/components/ui";
import { requireIdentity } from "@/lib/auth";
import { collectionState } from "@/lib/query-state";
import {
  addTrialEnvironment,
  createEnvironment,
  createSite,
  createTrial,
  createTrialEntry,
  listEnvironments,
  listSites,
  listTrialEntries,
  listTrialEnvironments,
  listTrials,
  listUnmappedLocations,
  listUnmappedMaterial,
  mapLegacyLocation,
  mapLegacyMaterial,
  removeTrialEnvironment,
} from "./actions";

const scientificRoleLabels: Record<string, string> = {
  genotype: "Génotype",
  family: "Famille",
  population: "Population",
  seed_lot: "Lot de graines",
  other: "Autre",
};

export default async function Trials({
  searchParams,
}: {
  searchParams: Promise<{ program?: string; trial?: string }>;
}) {
  const { client, team } = await requireIdentity();
  const params = await searchParams;

  const programsState = collectionState(
    await client
      .from("programs")
      .select("id,code,name,species,campaign")
      .is("deleted_at", null)
      .order("code"),
    "Impossible de charger les programmes.",
  );
  if (programsState.status === "error") {
    return (
      <div className="page">
        <ErrorState message={programsState.message} retryHref="/app/trials" />
      </div>
    );
  }
  const programs = programsState.data;
  const program = programs.find((p) => p.id === params.program) ?? programs[0];
  const programId = program?.id;

  const breadcrumbs = (
    <Breadcrumbs
      items={[
        { label: "Accueil", href: "/app" },
        { label: "Essais multi-environnements" },
      ]}
    />
  );
  const header = (
    <PageHeader
      eyebrow="Conception expérimentale"
      title="Essais multi-environnements"
      description="Sites, environnements et essais : la structure normalisée sur laquelle s’appuie l’analyse Entrée × Environnement. Les entités archivées restent visibles pour inspection."
    />
  );

  if (!programId) {
    return (
      <div className="page">
        {breadcrumbs}
        {header}
        <EmptyState
          title="Aucun programme"
          message="Créez un programme avant de définir un essai multi-environnement."
          action={{ label: "Créer un programme", href: "/app" }}
        />
      </div>
    );
  }

  const [sites, environments, trials] = await Promise.all([
    listSites(team.id),
    listEnvironments(programId),
    listTrials(programId),
  ]);
  const trial = trials.find((t) => t.id === params.trial) ?? trials[0];

  const [trialEnvironments, trialEntries] = trial
    ? await Promise.all([
        listTrialEnvironments(trial.id),
        listTrialEntries(trial.id),
      ])
    : [[], []];
  const availableEnvironments = environments.filter(
    (e) => !trialEnvironments.some((te) => te.id === e.id),
  );

  const [unmappedLocations, unmappedMaterial] = trial
    ? await Promise.all([
        listUnmappedLocations(programId),
        listUnmappedMaterial(programId),
      ])
    : [[], []];

  const basePath = "/app/trials";

  return (
    <div className="page">
      {breadcrumbs}
      {header}
      <ProgramContext team={team.name} program={program} />
      <ProgramSwitch
        programs={programs}
        activeId={programId}
        basePath={basePath}
      />

      <div className="section-grid">
        <Card>
          <h3 className="chart-title">Sites</h3>
          <p className="chart-description">
            Un site est un lieu physique/organisationnel, partagé par toute
            l’équipe - indépendant du programme.
          </p>
          <ActionForm action={createSite} actionName="trials-create-site">
            <input type="hidden" name="organization_id" value={team.id} />
            <label>
              Code
              <input name="code" required maxLength={40} />
            </label>
            <label>
              Nom
              <input name="name" required maxLength={200} />
            </label>
            <label>
              Description (optionnel)
              <textarea name="description" maxLength={2000} />
            </label>
          </ActionForm>
          {sites.length === 0 ? (
            <EmptyState
              title="Aucun site"
              message="Créez le premier site de l’équipe."
            />
          ) : (
            <DataTable label="Sites">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Nom</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((site) => (
                    <tr key={site.id}>
                      <td>
                        <code>{site.code}</code>
                      </td>
                      <td>{site.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          )}
        </Card>

        <Card>
          <h3 className="chart-title">Environnements</h3>
          <p className="chart-description">
            Un environnement = un site observé pour une campagne/un contexte
            donné, propre à ce programme.
          </p>
          {sites.length === 0 ? (
            <EmptyState
              title="Aucun site disponible"
              message="Créez d’abord un site pour pouvoir y rattacher un environnement."
            />
          ) : (
            <ActionForm
              action={createEnvironment}
              actionName="trials-create-environment"
            >
              <input type="hidden" name="program_id" value={programId} />
              <label>
                Site
                <select name="site_id" required>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.code} — {site.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Code
                <input name="code" required maxLength={40} />
              </label>
              <label>
                Nom
                <input name="name" required maxLength={200} />
              </label>
              <label>
                Campagne (optionnel)
                <input name="campaign" maxLength={40} placeholder="2026A" />
              </label>
              <label>
                Contexte de gestion (optionnel)
                <textarea name="management_context" maxLength={2000} />
              </label>
            </ActionForm>
          )}
          {environments.length === 0 ? (
            <EmptyState
              title="Aucun environnement"
              message="Créez le premier environnement de ce programme."
            />
          ) : (
            <DataTable label="Environnements">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Nom</th>
                    <th scope="col">Site</th>
                    <th scope="col">Campagne</th>
                  </tr>
                </thead>
                <tbody>
                  {environments.map((env) => (
                    <tr key={env.id}>
                      <td>
                        <code>{env.code}</code>
                      </td>
                      <td>{env.name}</td>
                      <td>{env.siteCode}</td>
                      <td>{env.campaign ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          )}
        </Card>

        <Card>
          <h3 className="chart-title">Essais</h3>
          <p className="chart-description">
            Un essai regroupe un ensemble explicite d’environnements et
            d’entrées, analysé ensemble pour la stabilité G×E.
          </p>
          <ActionForm action={createTrial} actionName="trials-create-trial">
            <input type="hidden" name="program_id" value={programId} />
            <label>
              Code
              <input name="code" required maxLength={40} />
            </label>
            <label>
              Nom
              <input name="name" required maxLength={200} />
            </label>
            <label>
              Description (optionnel)
              <textarea name="description" maxLength={2000} />
            </label>
          </ActionForm>
          {trials.length === 0 ? (
            <EmptyState
              title="Aucun essai"
              message="Créez le premier essai de ce programme."
            />
          ) : (
            <DataTable label="Essais">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Nom</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {trials.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <code>{t.code}</code>
                      </td>
                      <td>{t.name}</td>
                      <td>
                        <Link
                          className={t.id === trial?.id ? "active" : ""}
                          href={`${basePath}?program=${programId}&trial=${t.id}`}
                        >
                          Gérer
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          )}
        </Card>
      </div>

      {trial && (
        <Card>
          <h3 className="chart-title">
            Essai sélectionné : {trial.code} — {trial.name}
          </h3>
          <div className="section-grid">
            <div>
              <h4>Environnements de l’essai ({trialEnvironments.length})</h4>
              {trialEnvironments.length === 0 ? (
                <EmptyState
                  title="Aucun environnement"
                  message="Ajoutez au moins deux environnements pour permettre une analyse Entrée × Environnement."
                />
              ) : (
                <DataTable label="Environnements de l’essai">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Code</th>
                        <th scope="col">Site</th>
                        <th scope="col">Campagne</th>
                        <th scope="col"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {trialEnvironments.map((env) => (
                        <tr key={env.id}>
                          <td>
                            <code>{env.code}</code>
                          </td>
                          <td>{env.siteCode}</td>
                          <td>{env.campaign ?? "—"}</td>
                          <td>
                            <ActionForm
                              action={removeTrialEnvironment}
                              actionName="trials-remove-environment"
                              submitLabel="Retirer"
                              className="inline-form"
                            >
                              <input
                                type="hidden"
                                name="trial_id"
                                value={trial.id}
                              />
                              <input
                                type="hidden"
                                name="environment_id"
                                value={env.id}
                              />
                            </ActionForm>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DataTable>
              )}
              {availableEnvironments.length > 0 && (
                <ActionForm
                  action={addTrialEnvironment}
                  actionName="trials-add-environment"
                  submitLabel="Ajouter à l’essai"
                >
                  <input type="hidden" name="trial_id" value={trial.id} />
                  <label>
                    Environnement
                    <select name="environment_id" required>
                      {availableEnvironments.map((env) => (
                        <option key={env.id} value={env.id}>
                          {env.code} — {env.siteCode}
                          {env.campaign ? ` (${env.campaign})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </ActionForm>
              )}
            </div>

            <div>
              <h4>Entrées de l’essai ({trialEntries.length})</h4>
              <ActionForm
                action={createTrialEntry}
                actionName="trials-create-entry"
              >
                <input type="hidden" name="trial_id" value={trial.id} />
                <label>
                  Code
                  <input name="code" required maxLength={40} />
                </label>
                <label>
                  Libellé
                  <input name="label" required maxLength={200} />
                </label>
                <label>
                  Rôle scientifique
                  <select name="scientific_role" defaultValue="other">
                    {Object.entries(scientificRoleLabels).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </ActionForm>
              {trialEntries.length === 0 ? (
                <EmptyState
                  title="Aucune entrée"
                  message="Ajoutez au moins deux entrées communes à plusieurs environnements."
                />
              ) : (
                <DataTable label="Entrées de l’essai">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Code</th>
                        <th scope="col">Libellé</th>
                        <th scope="col">Rôle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trialEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td>
                            <code>{entry.code}</code>
                          </td>
                          <td>{entry.label}</td>
                          <td>
                            <StatusBadge tone="info">
                              {scientificRoleLabels[entry.scientificRole] ??
                                entry.scientificRole}
                            </StatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DataTable>
              )}
            </div>
          </div>

          <div className="section-grid">
            <div>
              <h4>Correspondance des emplacements existants</h4>
              <p className="chart-description">
                Ces emplacements en texte libre (
                <code>phenotypes.location</code>) ne sont jamais interprétés
                automatiquement comme un environnement - choisissez
                explicitement, pour chacun, l’environnement normalisé
                correspondant.
              </p>
              {unmappedLocations.length === 0 ? (
                <EmptyState
                  title="Aucun emplacement à mapper"
                  message="Tous les emplacements existants sont déjà liés à un environnement, ou ce programme n’en a aucun."
                />
              ) : (
                <DataTable label="Emplacements à mapper">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Emplacement</th>
                        <th scope="col">Phénotypes</th>
                        <th scope="col">Environnement cible</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unmappedLocations.map((loc) => (
                        <tr key={loc.location}>
                          <td>{loc.location}</td>
                          <td>{loc.phenotypeCount}</td>
                          <td>
                            <ActionForm
                              action={mapLegacyLocation}
                              actionName="trials-map-location"
                              submitLabel="Appliquer"
                              className="inline-form"
                            >
                              <input
                                type="hidden"
                                name="program_id"
                                value={programId}
                              />
                              <input
                                type="hidden"
                                name="location"
                                value={loc.location}
                              />
                              <select name="environment_id" required>
                                {environments.map((env) => (
                                  <option key={env.id} value={env.id}>
                                    {env.code}
                                  </option>
                                ))}
                              </select>
                            </ActionForm>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DataTable>
              )}
            </div>

            <div>
              <h4>Correspondance du matériel existant</h4>
              <p className="chart-description">
                Ces familles/lots de graines existants ne sont jamais
                interprétés automatiquement comme une entrée - choisissez
                explicitement, pour chacun, l’entrée de l’essai sélectionné
                correspondante.
              </p>
              {trialEntries.length === 0 ? (
                <EmptyState
                  title="Aucune entrée dans cet essai"
                  message="Créez d’abord au moins une entrée dans l’essai sélectionné ci-dessus."
                />
              ) : unmappedMaterial.length === 0 ? (
                <EmptyState
                  title="Aucun matériel à mapper"
                  message="Tout le matériel existant est déjà lié à une entrée, ou ce programme n’en a aucun."
                />
              ) : (
                <DataTable label="Matériel à mapper">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Famille</th>
                        <th scope="col">Lot de graines</th>
                        <th scope="col">Phénotypes</th>
                        <th scope="col">Entrée cible</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unmappedMaterial.map((mat, i) => (
                        <tr key={i}>
                          <td>{mat.familyCode ?? "—"}</td>
                          <td>{mat.seedLotCode ?? "—"}</td>
                          <td>{mat.phenotypeCount}</td>
                          <td>
                            <ActionForm
                              action={mapLegacyMaterial}
                              actionName="trials-map-material"
                              submitLabel="Appliquer"
                              className="inline-form"
                            >
                              <input
                                type="hidden"
                                name="program_id"
                                value={programId}
                              />
                              <input
                                type="hidden"
                                name="family_id"
                                value={mat.familyId ?? ""}
                              />
                              <input
                                type="hidden"
                                name="seed_lot_id"
                                value={mat.seedLotId ?? ""}
                              />
                              <select name="trial_entry_id" required>
                                {trialEntries.map((entry) => (
                                  <option key={entry.id} value={entry.id}>
                                    {entry.code}
                                  </option>
                                ))}
                              </select>
                            </ActionForm>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DataTable>
              )}
            </div>
          </div>

          <div className="page-actions">
            <Link
              className="button-link"
              href={`/app/analytics/multi-environment?program=${programId}&trial=${trial.id}`}
            >
              Analyser cet essai
            </Link>
            <Link
              className="button-link secondary"
              href={`/app/analytics/breeding-decision?program=${programId}&trial=${trial.id}`}
            >
              Décision d’amélioration
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
