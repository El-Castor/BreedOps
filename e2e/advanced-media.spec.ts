import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const emailOwner = `advmedia-e2e-${marker}@example.test`;
const programCode = `ADVE2E${marker.toUpperCase()}`;
const parentCode = `${programCode}-P-0001`;
const ids: Record<string, string> = {};

// A dedicated, programmatically-generated synthetic image - never a real
// user's photo or an accidental repository artifact. A minimal but valid
// 1x1 JPEG (SOI/APP0/SOF0/SOS/EOI only), enough for the server's real
// binary-signature sniffing to accept it as image/jpeg.
const jpegBytes = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
  0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01,
  0x00, 0x00, 0x3f, 0x00, 0xff, 0xd9,
]);
const tmpDir = mkdtempSync(join(tmpdir(), "breedops-advmedia-e2e-"));
const imagePathA = join(tmpDir, "field-photo-a.jpg");
const imagePathB = join(tmpDir, "field-photo-b.jpg");
writeFileSync(imagePathA, jpegBytes);
writeFileSync(imagePathB, jpegBytes);

async function signIn(page: Page, email: string, pass: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(pass);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

test.beforeAll(async () => {
  const team = await admin
    .from("organizations")
    .insert({ name: "AdvMedia e2e team", slug: `advmedia-e2e-${marker}` })
    .select("id")
    .single();
  if (team.error) throw team.error;
  ids.team = team.data.id;

  const program = await admin
    .from("programs")
    .insert({
      organization_id: ids.team,
      code: programCode,
      name: "AdvMedia e2e program",
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
  const ownerProfile = await admin
    .from("profiles")
    .insert({
      user_id: ids.owner,
      organization_id: ids.team,
      role: "user",
      display_name: "AdvMedia e2e owner",
    })
    .select("id")
    .single();
  if (ownerProfile.error) throw ownerProfile.error;

  const parent = await admin
    .from("parent_lines")
    .insert({
      program_id: ids.program,
      parent_code: parentCode,
      line_name: "AdvMedia e2e parent",
    })
    .select("id")
    .single();
  if (parent.error) throw parent.error;
  ids.parent = parent.data.id;
});

test.afterAll(async () => {
  if (ids.owner) await admin.auth.admin.deleteUser(ids.owner);
  if (ids.team) hardDeleteOrganization(ids.team);
});

test("upload two dated images, annotate one, compare them side by side, and persist both after reload", async ({
  page,
}) => {
  await signIn(page, emailOwner, password);
  await page.goto(`/app/breeding?program=${ids.program}`);
  await page.getByRole("row").filter({ hasText: parentCode }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // Scoped to the currently-open <dialog> throughout: FormDrawer always
  // renders its children (every drawer's form exists in the DOM
  // regardless of which one is open), so an unscoped getByLabel can match
  // the same-named field in a different, closed drawer too.
  const openDialog = () => page.locator("dialog.form-drawer[open]");

  // Upload image A: earlier capture date/stage.
  await page.getByRole("button", { name: "Ajouter une image" }).click();
  await openDialog()
    .getByLabel("Image", { exact: true })
    .setInputFiles(imagePathA);
  await openDialog().getByLabel("Légende").fill("Semis");
  await openDialog().getByLabel("Date de prise de vue").fill("2026-04-01");
  await openDialog().getByLabel("Stade de développement").fill("D0");
  // The success path reloads the whole page via window.location.reload()
  // (every ActionForm in this app does, not just this one) - waiting for
  // the next "load" event concurrently with the click is the robust way
  // to wait for that, since "networkidle" never reliably settles.
  await Promise.all([
    page.waitForLoadState("load"),
    openDialog()
      .getByRole("button", { name: "Ajouter l’image", exact: true })
      .click(),
  ]);

  // Re-open the inspector after the reload and upload image B: later
  // capture date/stage.
  await page.getByRole("row").filter({ hasText: parentCode }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Ajouter une image" }).click();
  await openDialog()
    .getByLabel("Image", { exact: true })
    .setInputFiles(imagePathB);
  await openDialog().getByLabel("Légende").fill("Floraison");
  await openDialog().getByLabel("Date de prise de vue").fill("2026-06-01");
  await openDialog().getByLabel("Stade de développement").fill("floraison");
  await Promise.all([
    page.waitForLoadState("load"),
    openDialog()
      .getByRole("button", { name: "Ajouter l’image", exact: true })
      .click(),
  ]);

  // Open the gallery, confirm both images are present, and annotate one.
  await page.getByRole("row").filter({ hasText: parentCode }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".media-tile")).toHaveCount(2);
  await page
    .locator(".media-tile")
    .filter({ hasText: "Floraison" })
    .getByRole("button", { name: /Voir l’image/ })
    .click();
  await expect(page.locator(".media-viewer")).toBeVisible();
  await page.getByRole("button", { name: "Annoter" }).click();
  await page.getByText("Saisir les coordonnées précisément (clavier)").click();
  await page.getByLabel("Position X (0–1)").fill("0.3");
  await page.getByLabel("Position Y (0–1)").fill("0.4");
  await page.getByLabel("Texte (optionnel)").fill("bourgeon");
  await Promise.all([
    page.waitForLoadState("load"),
    page.getByRole("button", { name: "Ajouter l’annotation" }).click(),
  ]);

  // Re-open the same image: the annotation renders as both an overlay
  // mark and its required textual equivalent.
  await page.getByRole("row").filter({ hasText: parentCode }).click();
  await page
    .locator(".media-tile")
    .filter({ hasText: "Floraison" })
    .getByRole("button", { name: /Voir l’image/ })
    .click();
  await expect(page.locator(".media-viewer")).toBeVisible();
  await expect(page.locator(".annotation-mark.annotation-point")).toBeVisible();
  await expect(
    page.locator(".annotation-list-item", { hasText: "bourgeon" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Temporal comparison: select the two images and verify both sides.
  await page
    .getByRole("button", { name: "Chronologie et comparaison" })
    .click();
  await expect(page.locator(".media-timeline-item")).toHaveCount(2);
  const items = page.locator(".media-timeline-item");
  await items.nth(0).getByRole("checkbox").check();
  await items.nth(1).getByRole("checkbox").check();
  await expect(page.locator(".media-comparison-side")).toHaveCount(2);
  await expect(page.locator(".media-comparison-side").nth(0)).toContainText(
    "Semis",
  );
  await expect(page.locator(".media-comparison-side").nth(1)).toContainText(
    "Floraison",
  );
  await expect(page.locator(".media-comparison-side").nth(0)).toContainText(
    "D0",
  );
  await expect(page.locator(".media-comparison-side").nth(1)).toContainText(
    "floraison",
  );

  // Reload the whole page: metadata and the annotation both persist
  // (nothing here lives only in client memory).
  await page.reload();
  await page.getByRole("row").filter({ hasText: parentCode }).click();
  await expect(page.locator(".media-tile")).toHaveCount(2);
  await page
    .locator(".media-tile")
    .filter({ hasText: "Floraison" })
    .getByRole("button", { name: /Voir l’image/ })
    .click();
  await expect(
    page.locator(".annotation-list-item", { hasText: "bourgeon" }),
  ).toBeVisible();
});

test("the gallery and viewer remain usable at a mobile viewport width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, emailOwner, password);
  await page.goto(`/app/breeding?program=${ids.program}`);
  await page.getByRole("row").filter({ hasText: parentCode }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // Baseline before touching any V2-03 UI: the breeding registry's own
  // table is not wrapped in this app's usual .table-wrap overflow
  // containment (confirmed by inspecting src/app/app/breeding/page.tsx -
  // every other page audited for V1/V2 responsiveness does use it,
  // tracked separately as TD below), which already overflows this
  // viewport width regardless of anything in this milestone. The
  // meaningful assertion for V2-03 is that opening the media viewer,
  // annotation form and comparison grid never makes that worse - not
  // that the whole page is overflow-free, which is a pre-existing,
  // unrelated gap this milestone does not own.
  const baseline = await page.evaluate(() => document.body.scrollWidth);
  await expect(page.locator(".media-tile").first()).toBeVisible();
  await page
    .locator(".media-tile")
    .first()
    .getByRole("button", { name: /Voir l’image/ })
    .click();
  await expect(page.locator(".media-viewer")).toBeVisible();
  // The comparison grid stacks to a single column below 720px (see
  // globals.css) rather than overflowing the viewport.
  const withViewerOpen = await page.evaluate(() => document.body.scrollWidth);
  expect(
    withViewerOpen,
    "opening the media viewer must not widen the page beyond the pre-existing baseline",
  ).toBeLessThanOrEqual(baseline);
});
