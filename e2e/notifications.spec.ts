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
const emailOwner = `notif-e2e-${marker}@example.test`;
const programCode = `NOTIFE2E${marker.toUpperCase()}`;
const ids: Record<string, string> = {};

async function signIn(page: Page, email: string, pass: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(pass);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

test.beforeAll(async () => {
  const team = await admin
    .from("organizations")
    .insert({ name: "Notif e2e team", slug: `notif-e2e-${marker}` })
    .select("id")
    .single();
  if (team.error) throw team.error;
  ids.team = team.data.id;

  const program = await admin
    .from("programs")
    .insert({
      organization_id: ids.team,
      code: programCode,
      name: "Notif e2e program",
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
      display_name: "Notif e2e owner",
    })
    .select("id")
    .single();
  if (ownerProfile.error) throw ownerProfile.error;
  ids.profile = ownerProfile.data.id;

  const cycle = await admin
    .from("experimental_cycles")
    .insert({
      program_id: ids.program,
      name: "Notif e2e cycle",
      start_date: new Date().toISOString().slice(0, 10),
      status: "active",
    })
    .select("id")
    .single();
  if (cycle.error) throw cycle.error;
  ids.cycle = cycle.data.id;

  const yesterday = new Date(Date.now() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const task = await admin
    .from("tasks")
    .insert({
      experimental_cycle_id: ids.cycle,
      program_id: ids.program,
      title: "Notif e2e overdue task",
      planned_date: yesterday,
      due_date: yesterday,
      status: "not_started",
      assigned_to: ids.profile,
    })
    .select("id")
    .single();
  if (task.error) throw task.error;
  ids.task = task.data.id;
});

test.afterAll(async () => {
  if (ids.owner) await admin.auth.admin.deleteUser(ids.owner);
  if (ids.team) hardDeleteOrganization(ids.team);
});

test("the notification bell surfaces a real overdue-task alert and its deep link navigates to Operations", async ({
  page,
}) => {
  await signIn(page, emailOwner, password);
  await page.waitForURL(/\/app$/);

  // The bell shows an unread badge and the generated overdue notification,
  // not a placeholder - this is the exact row sync_notifications_for_team
  // generated server-side on this page load.
  const bell = page.locator(".notification-center summary");
  await expect(page.locator(".notification-badge")).toBeVisible();
  await bell.click();
  const item = page
    .locator(".notification-item")
    .filter({ hasText: "Notif e2e overdue task" });
  await expect(item).toBeVisible();
  await expect(item).toContainText("Tâche en retard");

  // Clicking it marks it read and navigates through its deep link to the
  // Operations tasks tab - the exact page the underlying task lives on.
  await Promise.all([
    page.waitForURL(/\/app\/operations/),
    item.getByRole("button").click(),
  ]);
  await expect(
    page.getByRole("row").filter({ hasText: "Notif e2e overdue task" }),
  ).toBeVisible();

  // A reload no longer shows it as unread, and the generator never
  // duplicates it on this second page load.
  await page.goto("/app");
  await bell.click();
  await expect(
    page
      .locator(".notification-item")
      .filter({ hasText: "Notif e2e overdue task" }),
  ).not.toHaveClass(/unread/);
  await expect(
    page.locator(".notification-item", {
      hasText: "Notif e2e overdue task",
    }),
  ).toHaveCount(1);
});
