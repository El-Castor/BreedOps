import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const backend = JSON.parse(readFileSync(".local/test-backend.json", "utf8"));
if (backend.API_URL !== "http://127.0.0.1:55421")
  throw new Error("E2E requires isolated local Supabase");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const marker = randomUUID().slice(0, 8);
const email = `e2e-${marker}@example.test`;
const password = `${randomUUID()}Aa9!`;
const ids: Record<string, string> = {};

function day(offset: number) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

async function signOut(page: Page) {
  await page.locator("header details > summary").click();
  await Promise.all([
    page.waitForURL(/\/login/),
    page.getByRole("button", { name: "Déconnexion" }).click(),
  ]);
}

test.beforeAll(async () => {
  const team = await admin
    .from("organizations")
    .insert({ name: "Synthetic E2E team", slug: `e2e-${marker}` })
    .select("id")
    .single();
  if (team.error) throw team.error;
  ids.team = team.data.id;
  const account = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (account.error) throw account.error;
  ids.user = account.data.user.id;
  const profile = await admin.from("profiles").insert({
    user_id: ids.user,
    organization_id: ids.team,
    role: "user",
    display_name: "Synthetic E2E operator",
  });
  if (profile.error) throw profile.error;
});

test.afterAll(async () => {
  if (ids.user) await admin.auth.admin.deleteUser(ids.user);
  if (ids.team) await admin.from("organizations").delete().eq("id", ids.team);
});

test("critical V1 journey persists through every module and changes KPIs", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/app/);

  let form = page.locator('form[data-action="program"]');
  await form.getByLabel("Code").fill(`E2EP-${marker}`);
  await form.getByLabel("Nom").fill("Synthetic E2E program");
  await form.getByLabel("Espèce").fill("Synthetic species");
  await form.getByRole("button").click();
  await expect(
    page.getByRole("link", { name: `E2EP-${marker}` }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Ajouter un parent" }).click();
  await expect(
    page.getByText("Aucun parent disponible", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('form[data-action="cross"] button[type="submit"]'),
  ).toBeDisabled();
  await expect(
    page.getByText("Aucun croisement disponible", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('form[data-action="family"] button[type="submit"]'),
  ).toBeDisabled();
  await expect(
    page.getByText("Aucune famille disponible", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('form[data-action="seed-lot"] button[type="submit"]'),
  ).toBeDisabled();

  for (const [index, [code, name]] of [
    [`E2EA-${marker}`, "Synthetic parent A"],
    [`E2EB-${marker}`, "Synthetic parent B"],
  ].entries()) {
    form = page.locator('form[data-action="parent"]');
    await form.getByLabel("Code").fill(code);
    await form.getByLabel("Nom").fill(name);
    await form.getByRole("button").click();
    await expect(
      page.getByRole("cell", { name: code, exact: true }),
    ).toBeVisible();
    if (index === 0) {
      await expect(
        page.getByText("Une seule lignée est disponible."),
      ).toBeVisible();
      await expect(
        page.locator('form[data-action="cross"] button[type="submit"]'),
      ).toBeDisabled();
    }
  }
  await expect(
    page.locator('select[name="female_parent_id"] option'),
  ).toHaveCount(3);
  await expect(
    page.locator('form[data-action="cross"] button[type="submit"]'),
  ).toBeEnabled();
  form = page.locator('form[data-action="cross"]');
  await form.getByLabel("Code").fill(`E2EX-${marker}`);
  await form
    .getByLabel("Parent femelle")
    .selectOption({ label: `E2EA-${marker} · Synthetic parent A` });
  await form
    .getByLabel("Parent mâle")
    .selectOption({ label: `E2EB-${marker} · Synthetic parent B` });
  await form.getByLabel("Date").fill(day(-20));
  await form.getByRole("button").click();
  await expect(
    page.getByRole("cell", { name: `E2EX-${marker}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('select[name="cross_id"]').first().locator("option"),
  ).toHaveCount(2);

  form = page.locator('form[data-action="family"]');
  await form.getByLabel("Code").fill(`E2EF-${marker}`);
  await form.getByLabel("Croisement").selectOption({ label: `E2EX-${marker}` });
  await form.getByRole("button").click();
  await expect(
    page.getByRole("cell", { name: `E2EF-${marker}`, exact: true }),
  ).toBeVisible();
  await expect(page.locator('select[name="family_id"] option')).toHaveCount(2);
  form = page.locator('form[data-action="seed-lot"]');
  await form.getByLabel("Code").fill(`E2EL-${marker}`);
  await form.getByLabel("Croisement").selectOption({ label: `E2EX-${marker}` });
  await form
    .getByLabel("Famille")
    .selectOption({ label: `E2EF-${marker} · E2EX-${marker}` });
  await form.getByLabel("Date de récolte").fill(day(-15));
  await form.getByLabel("Quantité en graines").fill("200");
  await form.getByRole("button").click();
  await expect(
    page.getByRole("cell", { name: `E2EL-${marker}`, exact: true }),
  ).toBeVisible();
  await expect(page.locator('select[name="seed_lot_id"] option')).toHaveCount(
    2,
  );
  form = page.locator('form[data-action="germination"]');
  await form.getByLabel("Lot").selectOption({ label: `E2EL-${marker}` });
  await form.getByLabel("Date").fill(day(-14));
  await form.getByLabel("Jour d’évaluation").fill("7");
  await form.getByLabel("Graines testées").fill("100");
  await form.getByLabel("Graines germées").fill("92");
  await form.getByLabel("Méthode").fill("Synthetic paper test");
  await form.getByRole("button").click();
  await expect(page.getByText("92.00 %", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Pedigree", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `parent E2EA-${marker}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `parent E2EB-${marker}` }),
  ).toBeVisible();
  await page.getByRole("button", { name: `cross E2EX-${marker}` }).click();
  await expect(
    page.getByText(`Parents : E2EA-${marker} × E2EB-${marker}`),
  ).toBeVisible();

  await page.getByRole("link", { name: "Phénotypes", exact: true }).click();
  form = page.locator('form[data-action="model"]');
  await form.getByLabel("Nom").fill("Synthetic E2E selection");
  await form.getByRole("button").click();
  form = page.locator('form[data-action="phenotype"]');
  await form.getByLabel("Code").fill(`E2EPH-${marker}`);
  await form.getByLabel("Famille").selectOption({ label: `E2EF-${marker}` });
  await form.getByLabel("Lot").selectOption({ label: `E2EL-${marker}` });
  await form.getByLabel("Répétition").fill("1");
  await form.getByRole("button").click();
  form = page.locator('form[data-action="evaluation"]');
  await form.getByLabel("Phénotype").selectOption({ label: `E2EPH-${marker}` });
  await form.getByLabel("Date").fill(day(-10));
  for (const label of [
    "Vigueur ×1",
    "Architecture ×1",
    "Rendement ×2",
    "Qualité sanitaire ×2",
    "Qualité analytique ×3",
    "Stabilité ×4",
  ])
    await form.getByLabel(label).fill("9");
  await form.getByRole("button").click();
  await expect(page.getByText("elite", { exact: true })).toBeVisible();

  await page.goto("/app/inventory");
  form = page.locator('form[data-action="inventory-item"]');
  await form.getByLabel("Nom").fill(`Synthetic E2E item ${marker}`);
  await form.getByLabel("Catégorie").fill("reagent");
  await form.getByLabel("Unité").fill("g");
  await form.getByLabel("Stock minimal").fill("90");
  await form.getByRole("button").click();
  form = page.locator('form[data-action="inventory-lot"]');
  await form
    .getByLabel("Article")
    .selectOption({ label: `Synthetic E2E item ${marker}` });
  await form.getByLabel("Lot").fill(`E2EI-${marker}`);
  await form.getByLabel("Réception").fill(day(-2));
  await form.getByLabel("Péremption").fill(day(14));
  await form.getByLabel("Quantité reçue").fill("100");
  await form.getByRole("button").click();
  form = page.locator('form[data-action="inventory-movement"]');
  await form
    .getByLabel("Lot")
    .selectOption({ label: `Synthetic E2E item ${marker} · E2EI-${marker}` });
  await form.getByLabel("Type").selectOption("consumption");
  await form.getByLabel("Quantité").fill("20");
  await form.getByLabel("Date").fill(day(-1));
  await form
    .getByLabel("Motif (obligatoire pour ajustement)")
    .fill("Synthetic E2E use");
  await form.getByRole("button").click();
  await expect(page.getByText("80 g", { exact: true })).toBeVisible();

  await page.goto("/app/operations");
  form = page.locator('form[data-action="cycle"]');
  await form.getByLabel("Nom").fill("Synthetic E2E cycle");
  await form.getByLabel("Début").fill(day(-20));
  await form.getByLabel("Fin").fill(day(60));
  await form.getByRole("button").click();
  form = page.locator('form[data-action="task"]');
  await form.getByLabel("Cycle").selectOption({ label: "Synthetic E2E cycle" });
  await form.getByLabel("Titre").fill("Synthetic E2E task");
  await form.getByLabel("Planifiée").fill(day(-3));
  await form.getByLabel("Échéance").fill(day(-1));
  await form
    .getByLabel("Responsable")
    .selectOption({ label: "Synthetic E2E operator" });
  await form.getByRole("button").click();
  await expect(page.getByText("En retard", { exact: true })).toBeVisible();
  const statusForm = page.locator('form[data-action^="task-status-"]');
  await statusForm.locator('select[name="status"]').selectOption("completed");
  await statusForm.getByRole("button").click();

  const metric = (label: string) =>
    page.locator(".metric").filter({ hasText: label }).locator("strong");
  for (const label of [
    "Croisements",
    "Lots de graines",
    "Phénotypes évalués",
    "Phénotypes Elite",
    "Articles sous seuil",
    "Lots bientôt périmés",
  ])
    await expect(metric(label)).toHaveText("1");
  await expect(metric("Germination moyenne")).toHaveText("92 %");
  await expect(metric("Tâches en retard")).toHaveText("0");
  await expect(metric("Tâches terminées")).toHaveText("100 %");
  await page.reload();
  await expect(
    page.getByText("Synthetic E2E task", { exact: true }),
  ).toBeVisible();
  await page.goto("/app");
  await signOut(page);
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("link", { name: "Programme", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Croisements" })
      .getByRole("cell", { name: `E2EX-${marker}`, exact: true }),
  ).toBeVisible();
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("navigation", { name: "Navigation principale" }),
    ).toBeVisible();
  }
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(
    page.getByRole("button", { name: "Ouvrir la navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir la navigation" }).click();
  await expect(
    page.getByRole("navigation", { name: "Navigation principale" }),
  ).toBeVisible();
});
