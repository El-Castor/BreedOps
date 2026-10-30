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
const emailOwner = `qr-owner-${marker}@example.test`;
const emailOther = `qr-other-${marker}@example.test`;
const programCode = `QRE2E${marker.toUpperCase()}`;
const parentCode = `${programCode}-P-0001`;
const ids: Record<string, string> = {};

async function signIn(page: Page, email: string, pass: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(pass);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

test.beforeAll(async () => {
  const teamOwner = await admin
    .from("organizations")
    .insert({ name: "QR e2e owner team", slug: `qr-owner-${marker}` })
    .select("id")
    .single();
  if (teamOwner.error) throw teamOwner.error;
  ids.teamOwner = teamOwner.data.id;
  const teamOther = await admin
    .from("organizations")
    .insert({ name: "QR e2e other team", slug: `qr-other-${marker}` })
    .select("id")
    .single();
  if (teamOther.error) throw teamOther.error;
  ids.teamOther = teamOther.data.id;

  const program = await admin
    .from("programs")
    .insert({
      organization_id: ids.teamOwner,
      code: programCode,
      name: "QR e2e program",
      species: "Synthetic species",
    })
    .select("id")
    .single();
  if (program.error) throw program.error;
  ids.program = program.data.id;

  const owner = await admin.auth.admin.createUser({
    email: emailOwner,
    password,
    email_confirm: true,
  });
  if (owner.error) throw owner.error;
  ids.owner = owner.data.user.id;
  const ownerProfile = await admin.from("profiles").insert({
    user_id: ids.owner,
    organization_id: ids.teamOwner,
    role: "user",
    display_name: "QR e2e owner",
  });
  if (ownerProfile.error) throw ownerProfile.error;

  const other = await admin.auth.admin.createUser({
    email: emailOther,
    password,
    email_confirm: true,
  });
  if (other.error) throw other.error;
  ids.other = other.data.user.id;
  const otherProfile = await admin.from("profiles").insert({
    user_id: ids.other,
    organization_id: ids.teamOther,
    role: "user",
    display_name: "QR e2e other",
  });
  if (otherProfile.error) throw otherProfile.error;

  const parent = await admin
    .from("parent_lines")
    .insert({
      program_id: ids.program,
      parent_code: parentCode,
      line_name: "QR e2e parent",
    })
    .select("id")
    .single();
  if (parent.error) throw parent.error;
  ids.parent = parent.data.id;
});

test.afterAll(async () => {
  for (const key of ["owner", "other"])
    if (ids[key]) await admin.auth.admin.deleteUser(ids[key]);
  for (const key of ["teamOwner", "teamOther"])
    if (ids[key]) hardDeleteOrganization(ids[key]);
});

test("open an entity, display its QR label, scan-navigate to it, and deny it across teams", async ({
  page,
}) => {
  // 1. Open the entity (breeding registry row -> inspector).
  await signIn(page, emailOwner, password);
  await page.goto(`/app/breeding?program=${ids.program}`);
  await page.getByRole("row").filter({ hasText: parentCode }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // 2. Display its QR/label from the inspector.
  await page
    .getByRole("button", { name: "Afficher le QR", exact: true })
    .click();
  await expect(page.locator(".qr-label svg")).toBeVisible();
  await expect(
    page.getByText(parentCode, { exact: true }).first(),
  ).toBeVisible();

  // 3 & 4. Navigate through the exact destination a scanned QR encodes and
  // confirm the correct entity is shown.
  await page.goto(`/app/lookup?type=parent&id=${ids.parent}`);
  await expect(
    page.getByText(parentCode, { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("QR e2e parent", { exact: true })).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/app\/breeding/),
    page.getByRole("link", { name: "Voir dans le registre" }).click(),
  ]);
  await expect(
    page.getByRole("row").filter({ hasText: parentCode }),
  ).toBeVisible();

  // 5. A different team's account scanning the exact same QR must not
  // retrieve it.
  await page.locator("header details > summary").click();
  await Promise.all([
    page.waitForURL(/\/login/),
    page.getByRole("button", { name: "Déconnexion" }).click(),
  ]);
  await signIn(page, emailOther, password);
  await page.goto(`/app/lookup?type=parent&id=${ids.parent}`);
  await expect(
    page.getByText("Aucune entité correspondante", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(parentCode, { exact: true })).toHaveCount(0);
});

test("selecting several seed lots prints them together on one sheet", async ({
  page,
}) => {
  const lotCodeA = `${programCode}-L-0001`;
  const lotCodeB = `${programCode}-L-0002`;
  const lotA = await admin
    .from("seed_lots")
    .insert({ program_id: ids.program, seed_lot_code: lotCodeA })
    .select("id")
    .single();
  if (lotA.error) throw lotA.error;
  const lotB = await admin
    .from("seed_lots")
    .insert({ program_id: ids.program, seed_lot_code: lotCodeB })
    .select("id")
    .single();
  if (lotB.error) throw lotB.error;

  await signIn(page, emailOwner, password);
  await page.goto(`/app/breeding?program=${ids.program}`);

  // Scoped to the label-print-bar's own class, not the generic
  // role="status" - this page can also show an unrelated role="status"
  // prerequisite notice (no families yet), so a global role lookup would
  // be ambiguous.
  const printBar = page.locator(".label-print-bar");
  await expect(printBar).toHaveCount(0);
  await page
    .getByRole("row")
    .filter({ hasText: lotCodeA })
    .getByRole("checkbox")
    .check();
  await page
    .getByRole("row")
    .filter({ hasText: lotCodeB })
    .getByRole("checkbox")
    .check();

  await expect(printBar).toContainText("2 étiquettes sélectionnées");

  await printBar.getByRole("link", { name: "Imprimer les étiquettes" }).click();
  await expect(page).toHaveURL(/\/app\/labels\/print\?items=/);
  await expect(page.getByText(lotCodeA, { exact: true })).toBeVisible();
  await expect(page.getByText(lotCodeB, { exact: true })).toBeVisible();
  await expect(page.locator(".qr-label")).toHaveCount(2);
});
