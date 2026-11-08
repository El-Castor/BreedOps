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
const email = `bd-e2e-${marker}@example.test`;
const programCode = `BDE2E${marker.toUpperCase()}`;
const ids: Record<string, string> = {};

async function insertPhenotypeValue(params: {
  programId: string;
  phenotypeCode: string;
  environmentId: string;
  trialEntryId: string;
  values: { traitId: string; value: number }[];
}) {
  const pheno = await admin
    .from("phenotypes")
    .insert({
      program_id: params.programId,
      phenotype_code: params.phenotypeCode,
      environment_id: params.environmentId,
      trial_entry_id: params.trialEntryId,
    })
    .select("id")
    .single();
  if (pheno.error) throw pheno.error;
  const evalRow = await admin
    .from("phenotype_evaluations")
    .insert({ phenotype_id: pheno.data.id, evaluation_date: "2026-04-01" })
    .select("id")
    .single();
  if (evalRow.error) throw evalRow.error;
  for (const { traitId, value } of params.values) {
    await admin.from("phenotype_trait_values").insert({
      phenotype_evaluation_id: evalRow.data.id,
      trait_id: traitId,
      numeric_value: value,
    });
  }
}

test.beforeAll(async () => {
  const team = await admin
    .from("organizations")
    .insert({ name: "BreedingDecision e2e team", slug: `bd-e2e-${marker}` })
    .select("id")
    .single();
  if (team.error) throw team.error;
  ids.team = team.data.id;

  const program = await admin
    .from("programs")
    .insert({
      organization_id: ids.team,
      code: programCode,
      name: "Breeding decision e2e program",
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
      display_name: "Breeding decision e2e owner",
    })
    .select("id")
    .single();
  if (ownerProfile.error) throw ownerProfile.error;

  const phenotypingModule = await admin
    .from("phenotyping_modules")
    .insert({ organization_id: ids.team, name: `Module BD e2e ${marker}` })
    .select("id")
    .single();
  if (phenotypingModule.error) throw phenotypingModule.error;
  await admin.from("program_phenotyping_modules").insert({
    program_id: ids.program,
    module_id: phenotypingModule.data.id,
  });

  const traitYield = await admin
    .from("phenotype_traits")
    .insert({
      organization_id: ids.team,
      code: `yld${marker}`,
      name: "Rendement e2e",
      data_type: "numeric",
    })
    .select("id")
    .single();
  if (traitYield.error) throw traitYield.error;
  ids.traitYield = traitYield.data.id;

  const traitHeight = await admin
    .from("phenotype_traits")
    .insert({
      organization_id: ids.team,
      code: `hgt${marker}`,
      name: "Hauteur e2e",
      data_type: "numeric",
    })
    .select("id")
    .single();
  if (traitHeight.error) throw traitHeight.error;
  ids.traitHeight = traitHeight.data.id;

  for (const [traitId, order] of [
    [ids.traitYield, 0],
    [ids.traitHeight, 1],
  ] as const) {
    await admin.from("phenotyping_module_traits").insert({
      module_id: phenotypingModule.data.id,
      trait_id: traitId,
      display_order: order,
    });
  }

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

  // Trial A: 6 genotype-role entries, 1 environment -> MGIDI eligible (6
  // candidates > 2 traits).
  const envA = await admin
    .from("environments")
    .insert({
      program_id: ids.program,
      site_id: site.data.id,
      code: `ENVA-${marker}`,
      name: "Env A",
    })
    .select("id")
    .single();
  if (envA.error) throw envA.error;

  const trialA = await admin
    .from("trials")
    .insert({
      program_id: ids.program,
      code: `TRIALA-${marker}`,
      name: "MGIDI eligible trial e2e",
    })
    .select("id")
    .single();
  if (trialA.error) throw trialA.error;
  ids.trialA = trialA.data.id;
  await admin
    .from("trial_environments")
    .insert({ trial_id: ids.trialA, environment_id: envA.data.id });

  let seed = 11;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (const code of ["A1", "A2", "A3", "A4", "A5", "A6"]) {
    const entry = await admin
      .from("trial_entries")
      .insert({
        trial_id: ids.trialA,
        code,
        label: `Entry ${code}`,
        scientific_role: "genotype",
      })
      .select("id")
      .single();
    if (entry.error) throw entry.error;
    await insertPhenotypeValue({
      programId: ids.program,
      phenotypeCode: `BD-E2E-A-${marker}-${code}`,
      environmentId: envA.data.id,
      trialEntryId: entry.data.id,
      values: [
        { traitId: ids.traitYield, value: 50 + rand() * 10 },
        { traitId: ids.traitHeight, value: 100 + rand() * 20 },
      ],
    });
  }

  // Trial B: only 2 entries, same 2 traits -> MGIDI NOT_ESTIMABLE
  // (candidates=2 is not strictly more than traits=2).
  const envB = await admin
    .from("environments")
    .insert({
      program_id: ids.program,
      site_id: site.data.id,
      code: `ENVB-${marker}`,
      name: "Env B",
    })
    .select("id")
    .single();
  if (envB.error) throw envB.error;
  const trialB = await admin
    .from("trials")
    .insert({
      program_id: ids.program,
      code: `TRIALB-${marker}`,
      name: "MGIDI sparse trial e2e",
    })
    .select("id")
    .single();
  if (trialB.error) throw trialB.error;
  ids.trialB = trialB.data.id;
  await admin
    .from("trial_environments")
    .insert({ trial_id: ids.trialB, environment_id: envB.data.id });
  for (const code of ["B1", "B2"]) {
    const entry = await admin
      .from("trial_entries")
      .insert({
        trial_id: ids.trialB,
        code,
        label: `Entry ${code}`,
        scientific_role: "genotype",
      })
      .select("id")
      .single();
    if (entry.error) throw entry.error;
    await insertPhenotypeValue({
      programId: ids.program,
      phenotypeCode: `BD-E2E-B-${marker}-${code}`,
      environmentId: envB.data.id,
      trialEntryId: entry.data.id,
      values: [
        { traitId: ids.traitYield, value: 50 + rand() * 10 },
        { traitId: ids.traitHeight, value: 100 + rand() * 20 },
      ],
    });
  }
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

test("builds a scenario and traits through the UI, runs MGIDI, and shows the ranking/selection-differential/genetic-validity panel", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(
    `/app/analytics/breeding-decision?program=${ids.program}&trial=${ids.trialA}`,
  );
  await expect(
    page.getByRole("heading", { name: "Décision d’amélioration" }),
  ).toBeVisible();

  await page
    .locator(
      'form[data-action="create-breeding-decision-scenario"] input[name="name"]',
    )
    .fill(`Scenario A ${marker}`);
  await page
    .locator(
      'form[data-action="create-breeding-decision-scenario"] input[name="selection_proportion"]',
    )
    .fill("30");
  await page
    .locator(
      'form[data-action="create-breeding-decision-scenario"] button[type="submit"]',
    )
    .click();
  await expect(page.getByText(`Scenario A ${marker}`).first()).toBeVisible();

  // Selecting the newly-created scenario's chip navigates with ?scenario=,
  // which is required before the "add trait"/"run analysis" forms render.
  await page.getByRole("link", { name: `Scenario A ${marker}` }).click();

  await page
    .locator(
      'form[data-action="add-breeding-decision-scenario-trait"] select[name="trait_id"]',
    )
    .selectOption(ids.traitYield);
  await page
    .locator(
      'form[data-action="add-breeding-decision-scenario-trait"] select[name="source_type"]',
    )
    .selectOption("RAW_PHENOTYPIC");
  await page
    .locator(
      'form[data-action="add-breeding-decision-scenario-trait"] button[type="submit"]',
    )
    .click();
  await expect(page.getByRole("cell", { name: "Rendement e2e" })).toBeVisible();

  await page
    .locator(
      'form[data-action="add-breeding-decision-scenario-trait"] select[name="trait_id"]',
    )
    .selectOption(ids.traitHeight);
  await page
    .locator(
      'form[data-action="add-breeding-decision-scenario-trait"] select[name="source_type"]',
    )
    .selectOption("RAW_PHENOTYPIC");
  await page
    .locator(
      'form[data-action="add-breeding-decision-scenario-trait"] button[type="submit"]',
    )
    .click();
  await expect(page.getByRole("cell", { name: "Hauteur e2e" })).toBeVisible();

  await page
    .locator(
      'form[data-action="create-breeding-decision-run"] select[name="method"]',
    )
    .selectOption("selection_mgidi_v1");
  await page
    .locator(
      'form[data-action="create-breeding-decision-run"] button[type="submit"]',
    )
    .click();

  await expect(
    page.getByRole("heading", { name: /Résultat le plus récent — MGIDI/ }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Classement" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Différentiel de sélection par trait" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Panneau de validité génétique" }),
  ).toBeVisible();
  await expect(page.getByText("NOT_ESTIMABLE").first()).toBeVisible();
  await expect(page.getByText("Sélectionné par MGIDI").first()).toBeVisible();

  await expect(
    page.getByRole("link", { name: "Exporter en CSV" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Exporter en JSON" }),
  ).toBeVisible();
});

test("demonstrates NOT_ESTIMABLE in the browser when candidates do not strictly exceed the trait count (never a fabricated ranking)", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(
    `/app/analytics/breeding-decision?program=${ids.program}&trial=${ids.trialB}`,
  );

  await page
    .locator(
      'form[data-action="create-breeding-decision-scenario"] input[name="name"]',
    )
    .fill(`Scenario B ${marker}`);
  await page
    .locator(
      'form[data-action="create-breeding-decision-scenario"] button[type="submit"]',
    )
    .click();
  await expect(page.getByText(`Scenario B ${marker}`).first()).toBeVisible();
  await page.getByRole("link", { name: `Scenario B ${marker}` }).click();

  for (const traitId of [ids.traitYield, ids.traitHeight]) {
    await page
      .locator(
        'form[data-action="add-breeding-decision-scenario-trait"] select[name="trait_id"]',
      )
      .selectOption(traitId);
    await page
      .locator(
        'form[data-action="add-breeding-decision-scenario-trait"] select[name="source_type"]',
      )
      .selectOption("RAW_PHENOTYPIC");
    await page
      .locator(
        'form[data-action="add-breeding-decision-scenario-trait"] button[type="submit"]',
      )
      .click();
  }

  await page
    .locator(
      'form[data-action="create-breeding-decision-run"] select[name="method"]',
    )
    .selectOption("selection_mgidi_v1");
  await page
    .locator(
      'form[data-action="create-breeding-decision-run"] button[type="submit"]',
    )
    .click();

  await expect(page.getByText("NOT_ESTIMABLE").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "Classement" })).toHaveCount(
    0,
  );
});
