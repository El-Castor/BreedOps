import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const enabled = process.env.ALLOW_SELF_SIGNUP === "true";
const backend = JSON.parse(readFileSync(".local/test-backend.json", "utf8"));
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = `pending-${randomUUID()}@example.test`;
let userId: string | undefined;

test.afterAll(async () => { if (userId) await admin.auth.admin.deleteUser(userId); });

test("self signup is hidden and inaccessible by default", async ({ page }) => {
  test.skip(enabled, "enabled-mode assertion runs separately");
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Créer un compte" })).toHaveCount(0);
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/login$/);
});

test("enabled self signup creates only a pending identity without business access", async ({ page }) => {
  test.skip(!enabled, "requires explicit ALLOW_SELF_SIGNUP=true test run");
  await page.goto("/login");
  await page.getByRole("link", { name: "Créer un compte" }).click();
  await page.getByLabel("Nom affiché").fill("Synthetic pending account");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Demander un compte" }).click();
  await expect(page.getByRole("status")).toContainText("administrateur devra ensuite affecter votre équipe");
  const result = await admin.auth.admin.listUsers();
  userId = result.data.users.find((user) => user.email === email)?.id;
  expect(userId).toBeTruthy();
  const profile = await admin.from("profiles").select("id").eq("user_id", userId!).maybeSingle();
  expect(profile.error).toBeNull();
  expect(profile.data).toBeNull();
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
});
