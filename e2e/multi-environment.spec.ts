import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { hardDeleteOrganization } from "../tests/db-cleanup";
import { currentProfile } from "../scripts/lib/stack-identity.mjs";

const profile = currentProfile();
const backend = JSON.parse(readFileSync(profile.backendFile, "utf8"));
if (backend.API_URL !== profile.apiUrl)
  throw new Error("E2E requires isolated local Supabase");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const marker = randomUUID().slice(0, 8);
const password = `${randomUUID()}Aa9!`;
const email = `met-e2e-${marker}@example.test`;
const programCode = `METE2E${marker.toUpperCase()}`;
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  const team = await admin
    .from("organizations")
    .insert({ name: "MET e2e team", slug: `met-e2e-${marker}` })
    .select("id")
    .single();
  if (team.error) throw team.error;
  ids.team = team.data.id;

  const program = await admin
    .from("programs")
    .insert({
      organization_id: ids.team,
      code: programCode,
      name: "MET e2e program",
      species: "Synthetic species",
    })
    .select("id")
    .single();
  if (program.error) throw program.error;
  ids.program = program.data.id;

  const owner = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (owner.error) throw owner.error;
  ids.owner = owner.data.user.id;
  const ownerProfile = await admin
    .from("profiles")
    .insert({
      user_id: ids.owner,
      organization_id: ids.team,
      role: "team_admin",
      display_name: "MET e2e owner",
    })
    .select("id")
    .single();
  if (ownerProfile.error) throw ownerProfile.error;

  const trait = await admin
    .from("phenotype_traits")
    .insert({
      organization_id: ids.team,
      code: "yield_met_e2e",
      name: "Rendement e2e",
      data_type: "numeric",
    })
    .select("id")
    .single();
  if (trait.error) throw trait.error;
  ids.trait = trait.data.id;

  const phenotypingModule = await admin
    .from("phenotyping_modules")
    .insert({ organization_id: ids.team, name: `Module MET e2e ${marker}` })
    .select("id")
    .single();
  if (phenotypingModule.error) throw phenotypingModule.error;
  await admin.from("program_phenotyping_modules").insert({
    program_id: ids.program,
    module_id: phenotypingModule.data.id,
  });
  await admin.from("phenotyping_module_traits").insert({
    module_id: phenotypingModule.data.id,
    trait_id: ids.trait,
    display_order: 0,
  });

  const site = await admin
    .from("sites")
    .insert({
      organization_id: ids.team,
      code: `SITE-E2E-${marker}`,
      name: "Site e2e",
    })
    .select("id")
    .single();
  if (site.error) throw site.error;

  // Eligible trial: 2 environments x 6 entries x 3 reps, seeded directly
  // (not through the UI - /app/trials' own CRUD flow is exercised by the
  // first test below instead, so observation seeding here stays fast and
  // focused on the analysis page).
  const env1 = await admin
    .from("environments")
    .insert({
      program_id: ids.program,
      site_id: site.data.id,
      code: `ENV1-${marker}`,
      name: "Env 1",
    })
    .select("id")
    .single();
  if (env1.error) throw env1.error;
  const env2 = await admin
    .from("environments")
    .insert({
      program_id: ids.program,
      site_id: site.data.id,
      code: `ENV2-${marker}`,
      name: "Env 2",
    })
    .select("id")
    .single();
  if (env2.error) throw env2.error;

  const trial = await admin
    .from("trials")
    .insert({
      program_id: ids.program,
      code: `TRIAL-${marker}`,
      name: "Trial e2e",
    })
    .select("id")
    .single();
  if (trial.error) throw trial.error;
  ids.trial = trial.data.id;

  await admin.from("trial_environments").insert([
    { trial_id: ids.trial, environment_id: env1.data.id },
    { trial_id: ids.trial, environment_id: env2.data.id },
  ]);

  const entryIds: string[] = [];
  for (const code of ["E1", "E2", "E3", "E4", "E5", "E6"]) {
    const entry = await admin
      .from("trial_entries")
      .insert({
        trial_id: ids.trial,
        code,
        label: `Entry ${code}`,
        scientific_role: "other",
      })
      .select("id")
      .single();
    if (entry.error) throw entry.error;
    entryIds.push(entry.data.id);
  }

  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (const environmentId of [env1.data.id, env2.data.id]) {
    for (const entryId of entryIds) {
      for (let rep = 1; rep <= 3; rep++) {
        const pheno = await admin
          .from("phenotypes")
          .insert({
            program_id: ids.program,
            phenotype_code: `MET-E2E-${marker}-${environmentId.slice(0, 4)}-${entryId.slice(0, 4)}-${rep}`,
            environment_id: environmentId,
            trial_entry_id: entryId,
            block: String(rep),
          })
          .select("id")
          .single();
        if (pheno.error) throw pheno.error;
        const evalRow = await admin
          .from("phenotype_evaluations")
          .insert({
            phenotype_id: pheno.data.id,
            evaluation_date: "2026-03-01",
          })
          .select("id")
          .single();
        if (evalRow.error) throw evalRow.error;
        await admin.from("phenotype_trait_values").insert({
          phenotype_evaluation_id: evalRow.data.id,
          trait_id: ids.trait,
          numeric_value: 50 + rand() * 10,
        });
      }
    }
  }

  // Sparse trial: a single environment - the NOT_ESTIMABLE demonstration.
  const sparseTrial = await admin
    .from("trials")
    .insert({
      program_id: ids.program,
      code: `SPARSE-${marker}`,
      name: "Sparse trial e2e",
    })
    .select("id")
    .single();
  if (sparseTrial.error) throw sparseTrial.error;
  ids.sparseTrial = sparseTrial.data.id;
  await admin
    .from("trial_environments")
    .insert({ trial_id: ids.sparseTrial, environment_id: env1.data.id });
  const sparseEntry = await admin
    .from("trial_entries")
    .insert({
      trial_id: ids.sparseTrial,
      code: "S1",
      label: "Sparse entry",
      scientific_role: "other",
    })
    .select("id")
    .single();
  if (sparseEntry.error) throw sparseEntry.error;
  const sparsePheno = await admin
    .from("phenotypes")
    .insert({
      program_id: ids.program,
      phenotype_code: `MET-SPARSE-E2E-${marker}`,
      environment_id: env1.data.id,
      trial_entry_id: sparseEntry.data.id,
    })
    .select("id")
    .single();
  if (sparsePheno.error) throw sparsePheno.error;
  const sparseEval = await admin
    .from("phenotype_evaluations")
    .insert({
      phenotype_id: sparsePheno.data.id,
      evaluation_date: "2026-03-01",
    })
    .select("id")
    .single();
  if (sparseEval.error) throw sparseEval.error;
  await admin.from("phenotype_trait_values").insert({
    phenotype_evaluation_id: sparseEval.data.id,
    trait_id: ids.trait,
    numeric_value: 10,
  });
});

test.afterAll(async () => {
  if (ids.owner) await admin.auth.admin.deleteUser(ids.owner);
  if (ids.team) hardDeleteOrganization(ids.team);
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

test("builds a site/environment/trial through the /app/trials UI (no data seeded via admin)", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/app/trials?program=${ids.program}`);

  await page
    .locator('form[data-action="trials-create-site"] input[name="code"]')
    .fill(`UI-SITE-${marker}`);
  await page
    .locator('form[data-action="trials-create-site"] input[name="name"]')
    .fill("Site créé via l'UI");
  await page
    .locator('form[data-action="trials-create-site"] button[type="submit"]')
    .click();
  await expect(page.getByText(`UI-SITE-${marker}`).first()).toBeVisible();

  await page
    .locator('form[data-action="trials-create-environment"] input[name="code"]')
    .fill(`UI-ENV-${marker}`);
  await page
    .locator('form[data-action="trials-create-environment"] input[name="name"]')
    .fill("Env créé via l'UI");
  await page
    .locator(
      'form[data-action="trials-create-environment"] button[type="submit"]',
    )
    .click();
  await expect(page.getByText(`UI-ENV-${marker}`).first()).toBeVisible();

  await page
    .locator('form[data-action="trials-create-trial"] input[name="code"]')
    .fill(`UI-TRIAL-${marker}`);
  await page
    .locator('form[data-action="trials-create-trial"] input[name="name"]')
    .fill("Essai créé via l'UI");
  await page
    .locator('form[data-action="trials-create-trial"] button[type="submit"]')
    .click();
  await expect(page.getByText(`UI-TRIAL-${marker}`).first()).toBeVisible();
});

test("runs a met_base_v1 analysis through the browser and renders variance components/BLUPs", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(
    `/app/analytics/multi-environment?program=${ids.program}&trial=${ids.trial}&trait=${ids.trait}`,
  );
  await expect(
    page.getByRole("heading", { name: "Diagnostic de conception" }),
  ).toBeVisible();
  await expect(
    page.getByText("Éligible pour une analyse Entrée × Environnement"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Carte de chaleur Entrée" }),
  ).toBeVisible();

  await page
    .locator('form[data-action="met-run-analysis"] select[name="model_type"]')
    .selectOption("met_base_v1");
  await page
    .locator('form[data-action="met-run-analysis"] button[type="submit"]')
    .click();

  await expect(
    page.getByRole("heading", { name: /Résultat le plus récent/ }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Composantes de variance")).toBeVisible();
  await expect(page.getByText("Prédictions par entrée (BLUP)")).toBeVisible();
});

test("demonstrates NOT_ESTIMABLE in the browser for a trial with only one environment (never a fabricated result)", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(
    `/app/analytics/multi-environment?program=${ids.program}&trial=${ids.sparseTrial}&trait=${ids.trait}`,
  );
  await expect(page.getByText("NOT_ESTIMABLE").first()).toBeVisible();
  await expect(
    page.getByText(/environnements distincts sont nécessaires/),
  ).toBeVisible();
  await expect(
    page.getByText("Éligible pour une analyse Entrée × Environnement"),
  ).toHaveCount(0);
});
