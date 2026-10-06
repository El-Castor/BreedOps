import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const backend = JSON.parse(readFileSync(".local/test-backend.json", "utf8"));
if (backend.API_URL !== "http://127.0.0.1:55421") throw new Error("E2E requires isolated local Supabase");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const marker = randomUUID().slice(0, 8);
const systemEmail = `system-${marker}@example.test`;
const systemPassword = `${randomUUID()}Aa9!`;
const memberEmail = `member-${marker}@example.test`;
const oldPassword = `${randomUUID()}Bb8!`;
const newPassword = `${randomUUID()}Cc7!`;
const inviteEmail = `invite-${marker}@example.test`;
const invitePassword = `${randomUUID()}Dd6!`;
const recoveredPassword = `${randomUUID()}Ee5!`;
const ids: Record<string, string> = {};

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

async function signOut(page: Page) {
  await page.locator("header details > summary").click();
  await Promise.all([
    page.waitForURL(/\/login/),
    page.getByRole("button", { name: "Déconnexion" }).click(),
  ]);
}

async function emailLink(recipient: string, subject: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const listing = await (await fetch("http://127.0.0.1:55424/api/v1/messages")).json();
    const summary = listing.messages.find((message: { Subject: string; To?: { Address: string }[] }) =>
      message.Subject === subject && message.To?.some((entry: { Address: string }) => entry.Address === recipient),
    );
    if (summary) {
      const message = await (await fetch(`http://127.0.0.1:55424/api/v1/message/${summary.ID}`)).json();
      const match = String(message.HTML || message.Text).replace(/&amp;/g, "&").match(/https?:\/\/[^"'<>\s]+/);
      if (match) return match[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Expected local email was not delivered to ${recipient}`);
}

test.beforeAll(async () => {
  for (const suffix of ["a", "b"]) {
    const team = await admin.from("organizations").insert({ name: `Synthetic auth ${suffix}`, slug: `auth-${marker}-${suffix}` }).select("id").single();
    if (team.error) throw team.error; ids[`team${suffix}`] = team.data.id;
  }
  const account = await admin.auth.admin.createUser({ email: systemEmail, password: systemPassword, email_confirm: true });
  if (account.error) throw account.error; ids.system = account.data.user.id;
  const profile = await admin.from("profiles").insert({ user_id: ids.system, organization_id: ids.teama, role: "system_admin", display_name: "Synthetic system admin" });
  if (profile.error) throw profile.error;
  const foreign = await admin.auth.admin.createUser({ email: `foreign-${marker}@example.test`, password: systemPassword, email_confirm: true });
  if (foreign.error) throw foreign.error; ids.foreign = foreign.data.user.id;
  const foreignProfile = await admin.from("profiles").insert({ user_id: ids.foreign, organization_id: ids.teamb, role: "user", display_name: "Foreign member" });
  if (foreignProfile.error) throw foreignProfile.error;
});

test.afterAll(async () => {
  await admin.from("audit_logs").delete().in("entity_id", Object.values(ids));
  for (const key of ["member", "invited", "teamAdmin", "foreign", "system"]) if (ids[key]) await admin.auth.admin.deleteUser(ids[key]);
  for (const key of ["teama", "teamb"]) if (ids[key]) await admin.from("organizations").delete().eq("id", ids[key]);
});

test("AUTH-01..15 real administration, reset, status, and scope journey", async ({ page, request, browser }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?error=expired/);

  const foreignOrigin = await request.post("/auth/login", { headers: { origin: "https://attacker.example" }, form: { email: systemEmail, password: systemPassword }, maxRedirects: 0 });
  expect(foreignOrigin.status()).toBe(303);
  expect(foreignOrigin.headers().location).toBe("http://localhost:3107/login?error=unexpected");

  await signIn(page, systemEmail, "incorrect-password");
  await expect(page).toHaveURL(/error=invalid/);
  await expect(page.getByText("Email ou mot de passe incorrect.", { exact: true })).toBeVisible();
  await signIn(page, systemEmail, systemPassword);
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/admin/users");
  const create = page.locator('form[data-action="create-user"]');
  await create.getByLabel("Email").fill(memberEmail);
  await create.getByLabel("Nom affiché").fill("Synthetic managed member");
  await create.getByLabel("Rôle").selectOption("user");
  await create.locator('select[name="organization_id"]').selectOption(ids.teama);
  await create.getByLabel("Mot de passe temporaire").fill(oldPassword);
  await create.getByRole("button", { name: "Créer l’utilisateur" }).click();
  await expect(page.getByRole("status")).toContainText("Utilisateur créé");
  const created = await admin.auth.admin.listUsers();
  ids.member = created.data.users.find((user) => user.email === memberEmail)!.id;

  const invite = page.locator('form[data-action="invite-user"]');
  await invite.getByLabel("Email").fill(inviteEmail);
  await invite.getByLabel("Nom affiché").fill("Synthetic invited member");
  await invite.getByLabel("Rôle").selectOption("user");
  await invite.locator('select[name="organization_id"]').selectOption(ids.teama);
  await invite.getByRole("button", { name: "Inviter l’utilisateur" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation envoyée");
  const invited = await admin.auth.admin.listUsers();
  ids.invited = invited.data.users.find((user) => user.email === inviteEmail)!.id;
  const invitationLink = await emailLink(inviteEmail, "Your BreedOps invitation");
  const invitedContext = await browser.newContext();
  const invitedPage = await invitedContext.newPage();
  await invitedPage.goto(invitationLink);
  await expect(invitedPage).toHaveURL(/\/reset-password/);
  await invitedPage.getByLabel("Nouveau mot de passe").fill(invitePassword);
  await invitedPage.getByLabel("Confirmation").fill(invitePassword);
  await invitedPage.getByRole("button", { name: "Enregistrer" }).click();
  await signIn(invitedPage, inviteEmail, invitePassword);
  await expect(invitedPage).toHaveURL(/\/app$/);
  await invitedContext.close();

  let row = page.getByRole("row").filter({ hasText: memberEmail });
  await row.locator("summary").click();
  const reset = row.locator('form[data-action^="reset-user-password-"]');
  await reset.getByLabel("Nouveau mot de passe").fill(newPassword);
  await reset
    .getByRole("button", { name: "Réinitialiser le mot de passe" })
    .click();
  await expect(page.getByRole("status")).toContainText("Mot de passe réinitialisé");

  await signOut(page);
  await signIn(page, memberEmail, oldPassword);
  await expect(page).toHaveURL(/error=invalid/);
  await signIn(page, memberEmail, newPassword);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("link", { name: "Utilisateurs" })).toHaveCount(0);
  await page.goto("/app/admin/users");
  await expect(page).toHaveURL(/\/app\?error=forbidden/);
  await signOut(page);

  await signIn(page, systemEmail, systemPassword);
  await page.goto("/app/admin/users");
  row = page.getByRole("row").filter({ hasText: memberEmail });
  await row.locator("summary").click();
  const update = row.locator('form[data-action^="update-user-"]');
  await update.locator('select[name="is_active"]').selectOption("false");
  await update.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status")).toContainText("Utilisateur mis à jour");
  await signOut(page);
  await signIn(page, memberEmail, newPassword);
  await expect(page).toHaveURL(/error=disabled/);

  await signIn(page, systemEmail, systemPassword);
  await page.goto("/app/admin/users");
  row = page.getByRole("row").filter({ hasText: memberEmail });
  await row.locator("summary").click();
  await row.locator('select[name="is_active"]').selectOption("true");
  await row.locator('select[name="role"]').selectOption("team_admin");
  await Promise.all([
    page.waitForNavigation(),
    row.getByRole("button", { name: "Enregistrer" }).click(),
  ]);
  await signOut(page);

  await signIn(page, memberEmail, newPassword);
  await page.goto("/app/admin/users");
  await expect(page.getByText(`foreign-${marker}@example.test`)).toHaveCount(0);
  await expect(page.locator('select[name="role"]').first()).toHaveValue("user");
  await signOut(page);
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(memberEmail);
  await page.getByRole("button", { name: "Envoyer les instructions" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
  const recoveryLink = await emailLink(memberEmail, "Reset your BreedOps password");
  await page.goto(recoveryLink);
  await expect(page).toHaveURL(/\/reset-password/);
  await page.getByLabel("Nouveau mot de passe").fill(recoveredPassword);
  await page.getByLabel("Confirmation").fill(recoveredPassword);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await signIn(page, memberEmail, recoveredPassword);
  await expect(page).toHaveURL(/\/app$/);

  const { data: audits } = await admin.from("audit_logs").select("action").in("entity_id", [ids.member, ids.invited]);
  const actions = new Set((audits ?? []).map((entry) => entry.action));
  for (const action of ["user_created", "user_invited", "admin_password_reset", "user_deactivated", "user_activated", "user_role_changed"])
    expect(actions.has(action), `missing audit ${action}`).toBe(true);
});
