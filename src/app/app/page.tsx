import Link from "next/link";
import { requireIdentity } from "@/lib/auth";
import { updateDisplayName, updateTeamName } from "./actions";
import {
  createCross,
  createFamily,
  createGerminationTest,
  createParentLine,
  createProgram,
  createSeedLot,
  updateCross,
} from "./breeding-actions";

type Params = { program?: string; q?: string };
export default async function Application({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const { client, user, profile, team } = await requireIdentity();
  const params = await searchParams;
  const { data: programs = [] } = await client
    .from("programs")
    .select("id,code,name,species,campaign")
    .is("deleted_at", null)
    .order("code");
  const selected =
    programs?.find((program) => program.id === params.program) ?? programs?.[0];
  const programId = selected?.id;
  let parentsQuery = client
    .from("parent_lines")
    .select("id,parent_code,line_name,generation,status")
    .is("deleted_at", null)
    .order("parent_code");
  let crossesQuery = client
    .from("crosses")
    .select(
      "id,cross_code,female_parent_id,male_parent_id,pollination_date,pollinated_units,total_seeds,status,notes",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  let familiesQuery = client
    .from("families")
    .select("id,family_code,cross_id,generation,status")
    .is("deleted_at", null)
    .order("family_code");
  let lotsQuery = client
    .from("seed_lots")
    .select(
      "id,seed_lot_code,cross_id,family_id,harvest_date,total_quantity,quantity_unit,storage_location,status",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (programId) {
    parentsQuery = parentsQuery.eq("program_id", programId);
    crossesQuery = crossesQuery.eq("program_id", programId);
    familiesQuery = familiesQuery.eq("program_id", programId);
    lotsQuery = lotsQuery.eq("program_id", programId);
  } else {
    parentsQuery = parentsQuery.limit(0);
    crossesQuery = crossesQuery.limit(0);
    familiesQuery = familiesQuery.limit(0);
    lotsQuery = lotsQuery.limit(0);
  }
  if (params.q?.trim())
    crossesQuery = crossesQuery.ilike(
      "cross_code",
      `%${params.q.trim().replace(/[%_]/g, "\\$&")}%`,
    );
  const [
    { data: parents = [] },
    { data: crosses = [] },
    { data: families = [] },
    { data: lots = [] },
  ] = await Promise.all([parentsQuery, crossesQuery, familiesQuery, lotsQuery]);
  const lotIds = lots?.map((lot) => lot.id) ?? [];
  const { data: tests = [] } = lotIds.length
    ? await client
        .from("germination_tests")
        .select(
          "id,seed_lot_id,test_date,evaluation_day,seeds_tested,seeds_germinated,germination_rate,method",
        )
        .in("seed_lot_id", lotIds)
        .is("deleted_at", null)
        .order("test_date", { ascending: false })
    : { data: [] };
  const parentName = (value: string) =>
    parents?.find((parent) => parent.id === value)?.parent_code ?? "—";
  const crossName = (value: string | null) =>
    crosses?.find((cross) => cross.id === value)?.cross_code ?? "—";
  const familyName = (value: string | null) =>
    families?.find((family) => family.id === value)?.family_code ?? "—";
  const lotName = (value: string) =>
    lots?.find((lot) => lot.id === value)?.seed_lot_code ?? "—";

  return (
    <main className="workspace">
      <header>
        <div>
          <p className="eyebrow">{team.name}</p>
          <h1>BreedOps</h1>
          <p>
            {profile.display_name || user.email} — {profile.role}
          </p>
        </div>
        <form action="/auth/logout" method="post">
          <button>Déconnexion</button>
        </form>
      </header>
      <nav className="program-nav" aria-label="Programmes">
        <Link
          href={
            programId
              ? `/app/phenotypes?program=${programId}`
              : "/app/phenotypes"
          }
        >
          Notation phénotypique
        </Link>
        <Link href="/app/inventory">Inventaire</Link>
        {programs?.map((program) => (
          <Link
            key={program.id}
            className={program.id === programId ? "active" : ""}
            href={`/app?program=${program.id}`}
          >
            {program.code}
          </Link>
        ))}
      </nav>
      <section className="grid-2">
        <form
          action={createProgram}
          className="card form"
          data-action="program"
        >
          <h2>Nouveau programme</h2>
          <label>
            Code
            <input name="code" required maxLength={80} />
          </label>
          <label>
            Nom
            <input name="name" required maxLength={160} />
          </label>
          <label>
            Espèce
            <input name="species" required maxLength={160} />
          </label>
          <label>
            Campagne
            <input name="campaign" maxLength={40} />
          </label>
          <button>Créer le programme</button>
        </form>
        <section className="card">
          <h2>Compte et équipe</h2>
          <form
            action={updateDisplayName}
            className="form"
            data-action="profile"
          >
            <label>
              Nom affiché
              <input
                name="display_name"
                defaultValue={profile.display_name || ""}
                required
                maxLength={120}
              />
            </label>
            <button>Enregistrer mon profil</button>
          </form>
          {profile.role !== "user" && (
            <form
              action={updateTeamName}
              className="form compact"
              data-action="team"
            >
              <label>
                Nom de l’équipe
                <input
                  name="name"
                  defaultValue={team.name}
                  required
                  maxLength={120}
                />
              </label>
              <button>Enregistrer l’équipe</button>
            </form>
          )}
        </section>
      </section>
      {!selected ? (
        <section className="card empty">
          <h2>Commencez par créer un programme</h2>
          <p>Les lignées et les lots seront rattachés à ce programme.</p>
        </section>
      ) : (
        <>
          <header className="section-header">
            <div>
              <p className="eyebrow">{selected.code}</p>
              <h2>{selected.name}</h2>
              <small>
                {selected.species} ·{" "}
                {selected.campaign || "campagne non renseignée"}
              </small>
            </div>
            <form className="search">
              <input name="program" type="hidden" value={programId} />
              <label>
                Rechercher un croisement
                <input name="q" defaultValue={params.q} placeholder="Code" />
              </label>
              <button>Rechercher</button>
            </form>
          </header>
          <section className="grid-2">
            <form
              action={createParentLine}
              className="card form"
              data-action="parent"
            >
              <h2>Ajouter une lignée parentale</h2>
              <input type="hidden" name="program_id" value={programId} />
              <label>
                Code
                <input name="parent_code" required maxLength={80} />
              </label>
              <label>
                Nom de lignée
                <input name="line_name" required maxLength={160} />
              </label>
              <label>
                Génération
                <input name="generation" type="number" min="0" />
              </label>
              <button>Ajouter la lignée</button>
            </form>
            <form
              action={createCross}
              className="card form"
              data-action="cross"
            >
              <h2>Créer un croisement</h2>
              <input type="hidden" name="program_id" value={programId} />
              <label>
                Code
                <input name="cross_code" required maxLength={80} />
              </label>
              <label>
                Parent femelle
                <select name="female_parent_id" required>
                  <option value="">Choisir</option>
                  {parents?.map((parent) => (
                    <option key={parent.id} value={parent.id}>
                      {parent.parent_code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Parent mâle
                <select name="male_parent_id" required>
                  <option value="">Choisir</option>
                  {parents?.map((parent) => (
                    <option key={parent.id} value={parent.id}>
                      {parent.parent_code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Date de pollinisation
                <input name="pollination_date" type="date" required />
              </label>
              <div className="fields-3">
                <label>
                  Unités pollinisées
                  <input name="pollinated_units" type="number" min="0" />
                </label>
                <label>
                  Unités établies
                  <input name="established_units" type="number" min="0" />
                </label>
                <label>
                  Graines
                  <input name="total_seeds" type="number" min="0" />
                </label>
              </div>
              <button disabled={(parents?.length ?? 0) < 2}>
                Créer le croisement
              </button>
            </form>
          </section>
          <section className="card table-wrap">
            <h2>Croisements</h2>
            {!crosses?.length ? (
              <p>Aucun croisement.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Parents</th>
                    <th>Date</th>
                    <th>Rendement</th>
                    <th>État</th>
                    <th>Modification</th>
                  </tr>
                </thead>
                <tbody>
                  {crosses.map((cross) => (
                    <tr key={cross.id}>
                      <td>{cross.cross_code}</td>
                      <td>
                        {parentName(cross.female_parent_id)} ×{" "}
                        {parentName(cross.male_parent_id)}
                      </td>
                      <td>{cross.pollination_date || "—"}</td>
                      <td>
                        {cross.pollinated_units
                          ? `${(Number(cross.total_seeds || 0) / cross.pollinated_units).toFixed(2)} graines/unité`
                          : "—"}
                      </td>
                      <td>{cross.status}</td>
                      <td>
                        <form
                          action={updateCross}
                          className="inline-form"
                          data-action="cross-update"
                        >
                          <input type="hidden" name="id" value={cross.id} />
                          <select name="status" defaultValue={cross.status}>
                            <option value="planned">Planifié</option>
                            <option value="active">Actif</option>
                            <option value="completed">Terminé</option>
                            <option value="cancelled">Annulé</option>
                          </select>
                          <input
                            name="notes"
                            defaultValue={cross.notes || ""}
                            placeholder="Notes"
                            maxLength={1000}
                          />
                          <button>Mettre à jour</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="grid-2">
            <form
              action={createFamily}
              className="card form"
              data-action="family"
            >
              <h2>Créer une famille</h2>
              <input type="hidden" name="program_id" value={programId} />
              <label>
                Croisement
                <select name="cross_id" required>
                  <option value="">Choisir</option>
                  {crosses?.map((cross) => (
                    <option key={cross.id} value={cross.id}>
                      {cross.cross_code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Code famille
                <input name="family_code" required maxLength={80} />
              </label>
              <label>
                Génération
                <input name="generation" type="number" min="0" />
              </label>
              <button disabled={!crosses?.length}>Créer la famille</button>
            </form>
            <form
              action={createSeedLot}
              className="card form"
              data-action="seed-lot"
            >
              <h2>Créer un lot de graines</h2>
              <input type="hidden" name="program_id" value={programId} />
              <label>
                Croisement
                <select name="cross_id" required>
                  <option value="">Choisir</option>
                  {crosses?.map((cross) => (
                    <option key={cross.id} value={cross.id}>
                      {cross.cross_code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Famille
                <select name="family_id" required>
                  <option value="">Choisir</option>
                  {families?.map((family) => (
                    <option key={family.id} value={family.id}>
                      {family.family_code} ({crossName(family.cross_id)})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Code lot
                <input name="seed_lot_code" required maxLength={80} />
              </label>
              <label>
                Date de récolte
                <input name="harvest_date" type="date" required />
              </label>
              <label>
                Quantité (graines)
                <input
                  name="total_quantity"
                  type="number"
                  min="0"
                  step="1"
                  required
                />
              </label>
              <label>
                Emplacement
                <input name="storage_location" maxLength={160} />
              </label>
              <button disabled={!families?.length}>Créer le lot</button>
            </form>
          </section>
          <section className="card table-wrap">
            <h2>Familles et lots</h2>
            <table>
              <thead>
                <tr>
                  <th>Lot</th>
                  <th>Famille</th>
                  <th>Croisement</th>
                  <th>Récolte</th>
                  <th>Quantité</th>
                  <th>Emplacement</th>
                </tr>
              </thead>
              <tbody>
                {lots?.map((lot) => (
                  <tr key={lot.id}>
                    <td>{lot.seed_lot_code}</td>
                    <td>{familyName(lot.family_id)}</td>
                    <td>{crossName(lot.cross_id)}</td>
                    <td>{lot.harvest_date || "—"}</td>
                    <td>
                      {lot.total_quantity} {lot.quantity_unit}
                    </td>
                    <td>{lot.storage_location || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!lots?.length && <p>Aucun lot.</p>}
          </section>
          <section className="grid-2">
            <form
              action={createGerminationTest}
              className="card form"
              data-action="germination"
            >
              <h2>Enregistrer un test de germination</h2>
              <label>
                Lot
                <select name="seed_lot_id" required>
                  <option value="">Choisir</option>
                  {lots?.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.seed_lot_code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Date
                <input name="test_date" type="date" required />
              </label>
              <label>
                Jour d’évaluation
                <input name="evaluation_day" type="number" min="0" required />
              </label>
              <label>
                Graines testées
                <input name="seeds_tested" type="number" min="1" required />
              </label>
              <label>
                Graines germées
                <input name="seeds_germinated" type="number" min="0" required />
              </label>
              <label>
                Méthode
                <input name="method" required maxLength={160} />
              </label>
              <button disabled={!lots?.length}>Enregistrer le test</button>
            </form>
            <section className="card table-wrap">
              <h2>Résultats de germination</h2>
              <table>
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Date</th>
                    <th>Résultat</th>
                    <th>Méthode</th>
                  </tr>
                </thead>
                <tbody>
                  {tests?.map((test) => (
                    <tr key={test.id}>
                      <td>{lotName(test.seed_lot_id)}</td>
                      <td>{test.test_date}</td>
                      <td>
                        <strong>
                          {Number(test.germination_rate).toFixed(2)} %
                        </strong>
                        <br />
                        <small>
                          {test.seeds_germinated}/{test.seeds_tested} à J
                          {test.evaluation_day}
                        </small>
                      </td>
                      <td>{test.method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!tests?.length && <p>Aucun test.</p>}
            </section>
          </section>
        </>
      )}
    </main>
  );
}
