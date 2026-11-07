import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { hardDeleteOrganization } from "../tests/db-cleanup";
import { currentProfile } from "../scripts/lib/stack-identity.mjs";

// Release-blocking E2E (V2-07 §35): exercises the real offline/online
// browser controls against the production build and service worker (never
// dev mode - see docs/OFFLINE_PWA.md and spec §45 "development-mode
// service-worker behavior alone is not sufficient evidence"). Covers the
// exact flow §35 specifies: login online, prepare a trial for offline use,
// go offline, enter evaluations, reload while still offline, restore
// network, synchronize, and confirm exactly one server record per queued
// operation.

const profile = currentProfile();
const backend = JSON.parse(readFileSync(profile.backendFile, "utf8"));
if (backend.API_URL !== profile.apiUrl)
  throw new Error("E2E requires isolated local Supabase");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const marker = randomUUID().slice(0, 8);
const password = `${randomUUID()}Aa9!`;
const email = `offline-e2e-${marker}@example.test`;
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  const team = await admin
    .from("organizations")
    .insert({ name: "Offline e2e team", slug: `offline-e2e-${marker}` })
    .select("id")
    .single();
  if (team.error) throw team.error;
  ids.team = team.data.id;

  const program = await admin
    .from("programs")
    .insert({
      organization_id: ids.team,
      code: `OFE2E${marker.toUpperCase()}`,
      name: "Offline e2e program",
    })
    .select("id")
    .single();
  if (program.error) throw program.error;
  ids.program = program.data.id;

  const user = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (user.error) throw user.error;
  ids.user = user.data.user.id;
  const userProfile = await admin
    .from("profiles")
    .insert({
      user_id: ids.user,
      organization_id: ids.team,
      role: "user",
      display_name: "Offline e2e user",
    })
    .select("id")
    .single();
  if (userProfile.error) throw userProfile.error;
  ids.profile = userProfile.data.id;

  const trait = await admin
    .from("phenotype_traits")
    .insert({
      organization_id: ids.team,
      code: `height${marker}`,
      name: "Hauteur",
      category: "morphology",
      data_type: "numeric",
      unit: "cm",
      minimum_value: 0,
      maximum_value: 300,
      decimal_places: 1,
    })
    .select("id")
    .single();
  if (trait.error) throw trait.error;
  ids.trait = trait.data.id;

  const module_ = await admin
    .from("phenotyping_modules")
    .insert({ organization_id: ids.team, name: `Module e2e ${marker}` })
    .select("id")
    .single();
  if (module_.error) throw module_.error;
  await admin.from("phenotyping_module_traits").insert({
    module_id: module_.data.id,
    trait_id: ids.trait,
    display_order: 1,
  });
  await admin
    .from("program_phenotyping_modules")
    .insert({ program_id: ids.program, module_id: module_.data.id });

  const site = await admin
    .from("sites")
    .insert({
      organization_id: ids.team,
      code: `SITE-OFE2E-${marker}`,
      name: "Site e2e",
    })
    .select("id")
    .single();
  if (site.error) throw site.error;
  const environment = await admin
    .from("environments")
    .insert({
      program_id: ids.program,
      site_id: site.data.id,
      code: `ENV-OFE2E-${marker}`,
      name: "Environment e2e",
    })
    .select("id")
    .single();
  if (environment.error) throw environment.error;

  const trial = await admin
    .from("trials")
    .insert({
      program_id: ids.program,
      code: `TRIAL-OFE2E-${marker}`,
      name: "Offline e2e trial",
    })
    .select("id")
    .single();
  if (trial.error) throw trial.error;
  ids.trial = trial.data.id;
  await admin
    .from("trial_environments")
    .insert({ trial_id: ids.trial, environment_id: environment.data.id });

  for (const code of ["OF1", "OF2"]) {
    const entry = await admin
      .from("trial_entries")
      .insert({
        trial_id: ids.trial,
        code,
        label: `Entrée ${code}`,
        scientific_role: "genotype",
      })
      .select("id")
      .single();
    if (entry.error) throw entry.error;
    const phenotype = await admin
      .from("phenotypes")
      .insert({
        program_id: ids.program,
        phenotype_code: `OFE2E-${marker}-${code}`,
        environment_id: environment.data.id,
        trial_entry_id: entry.data.id,
      })
      .select("id")
      .single();
    if (phenotype.error) throw phenotype.error;
    ids[`phenotype_${code}`] = phenotype.data.id;
  }
});

test.afterAll(async () => {
  if (ids.user) await admin.auth.admin.deleteUser(ids.user);
  if (ids.team) hardDeleteOrganization(ids.team);
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("**/app**");
}

/** Waits for the service worker to be active and controlling this exact
 * page. `navigator.serviceWorker.ready` only guarantees an active worker
 * exists for the origin - clientsClaim makes it take over the already-open
 * page quickly, but not synchronously, so a slow run (many other tests
 * sharing the browser process) can still race it. One reload is enough:
 * once the worker is active, the reloaded navigation is always controlled
 * from the start. */
async function waitForServiceWorkerControl(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.ready, null, {
    timeout: 30000,
  });
  const alreadyControlled = await page.evaluate(
    () => !!navigator.serviceWorker.controller,
  );
  if (!alreadyControlled) {
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, {
      timeout: 30000,
    });
  }
}

async function enterEvaluation(
  page: Page,
  phenotypeCode: string,
  value: string,
) {
  await page.getByLabel("Rechercher un phénotype").fill(phenotypeCode);
  await page.getByRole("button", { name: new RegExp(phenotypeCode) }).click();
  await page.getByLabel(/Hauteur/).fill(value);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(
    page.getByText("Évaluation enregistrée localement"),
  ).toBeVisible();
}

test.describe
  .serial("offline field capture - real browser offline/online flow", () => {
  test("prepares a trial offline, captures evaluations while offline, survives a reload, and synchronizes exactly once per operation on reconnect", async ({
    page,
    context,
  }) => {
    await signIn(page);

    // Prepare the trial for offline use (while online).
    await page.goto(`/app/field-packs?program=${ids.program}`);
    await page
      .getByRole("button", { name: "Rendre disponible hors ligne" })
      .click();
    await expect(
      page.getByText("Disponible hors ligne", { exact: true }),
    ).toBeVisible({
      timeout: 15000,
    });

    // The service worker must have installed and claimed this page before
    // going offline, or the precached /field shell won't be available.
    await waitForServiceWorkerControl(page);

    // Switch the real browser context offline (V2-07 §35: "Playwright's
    // actual offline/network controls").
    await context.setOffline(true);

    // No ?profile= query param: /field is precached as the bare URL
    // (next.config.mjs additionalPrecacheEntries), and a query-string
    // variant would miss that precache entry entirely once offline. The
    // page resolves its profile from localStorage instead, already seeded
    // by OfflineIndicator (src/components/app-shell.tsx) on every /app/*
    // page visited before this point.
    await page.goto("/field");
    await expect(
      page.getByRole("heading", { name: "Espace terrain" }),
    ).toBeVisible();
    await expect(page.getByText("Hors ligne")).toBeVisible();

    await enterEvaluation(page, `OFE2E-${marker}-OF1`, "120.5");
    await enterEvaluation(page, `OFE2E-${marker}-OF2`, "95.0");

    // Both operations must still be PENDING, not silently dropped, before
    // any reload happens.
    await expect(page.getByText("2 évaluation(s) en attente")).toBeVisible();

    // "close/reload page" while still offline (V2-07 §35) - IndexedDB must
    // survive this, and the shell itself must still render from precache.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Espace terrain" }),
    ).toBeVisible();
    await expect(page.getByText("2 évaluation(s) en attente")).toBeVisible();

    // Restore network - the browser `online` event alone must trigger
    // synchronization (V2-07 §19), with no manual action required.
    await context.setOffline(false);
    await expect(page.getByText("Synchronisé")).toBeVisible({ timeout: 20000 });

    // Exactly one evaluation per operation - never a duplicate, even
    // though the SYNCING state was entered once already before the reload
    // tested durability above.
    const evalRows = await admin
      .from("phenotype_evaluations")
      .select("id,phenotype_id,evaluation_date")
      .in("phenotype_id", [ids.phenotype_OF1, ids.phenotype_OF2]);
    if (evalRows.error) throw evalRows.error;
    expect(evalRows.data).toHaveLength(2);

    const heightValues = await admin
      .from("phenotype_trait_values")
      .select("numeric_value,phenotype_evaluation_id")
      .eq("trait_id", ids.trait)
      .in(
        "phenotype_evaluation_id",
        evalRows.data.map((row) => row.id),
      );
    if (heightValues.error) throw heightValues.error;
    expect(
      heightValues.data.map((row) => Number(row.numeric_value)).sort(),
    ).toEqual([95, 120.5].sort());
  });

  test("shows the BreedOps offline page, not a generic network error, for an uncached online-only route while offline", async ({
    page,
    context,
  }) => {
    await signIn(page);
    await page.goto("/app");
    await waitForServiceWorkerControl(page);

    await context.setOffline(true);
    // An authenticated, never-precached route (per V2-07 §5, deliberately
    // not cached) requested offline must fall back to BreedOps's own
    // offline page (src/app/offline), not the browser's default error.
    await page.goto(`/app/analytics?program=${ids.program}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Cette page nécessite une connexion" }),
    ).toBeVisible();
    await expect(
      page.getByText("Vous êtes actuellement hors ligne"),
    ).toBeVisible();
    await context.setOffline(false);
  });

  test("manifest is served and valid, and the offline shell is reachable with no network at all", async ({
    page,
    context,
  }) => {
    const manifestResponse = await page.request.get("/manifest.webmanifest");
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();
    expect(manifest.name).toBe("BreedOps");
    expect(manifest.display).toBe("standalone");
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);

    await signIn(page);
    await page.goto("/app");
    await waitForServiceWorkerControl(page);

    await context.setOffline(true);
    await page.goto("/offline", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Cette page nécessite une connexion" }),
    ).toBeVisible();
    await context.setOffline(false);
  });
});
