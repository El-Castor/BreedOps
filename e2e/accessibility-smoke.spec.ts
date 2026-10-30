import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { hardDeleteOrganization } from "../tests/db-cleanup";

// WCAG 2.2 AA pragmatic smoke coverage, automated via axe-core (already a
// transitive dependency through eslint-plugin-jsx-a11y - read its bundled
// script directly rather than adding a new package for the same library).
// This is deliberately a smoke test, not a certification: it catches
// regressions on the pages it covers, it does not prove every page or
// every interaction pattern is fully WCAG 2.2 AA compliant.
const axeSource = readFileSync(
  path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js"),
  "utf8",
);

const backend = JSON.parse(readFileSync(".local/test-backend.json", "utf8"));
if (backend.API_URL !== "http://127.0.0.1:55421")
  throw new Error("E2E requires isolated local Supabase");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const marker = randomUUID().slice(0, 8);
const email = `a11y-${marker}@example.test`;
const password = `${randomUUID()}Aa9!`;
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  const team = await admin
    .from("organizations")
    .insert({ name: "Synthetic a11y team", slug: `a11y-${marker}` })
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
    role: "team_admin",
    display_name: "Synthetic a11y operator",
  });
  if (profile.error) throw profile.error;
});

test.afterAll(async () => {
  if (ids.user) await admin.auth.admin.deleteUser(ids.user);
  if (ids.team) hardDeleteOrganization(ids.team);
});

type AxeResults = {
  violations: { id: string; impact: string; help: string; nodes: unknown[] }[];
};

async function runAxe(page: import("@playwright/test").Page): Promise<AxeResults> {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const globalAxe = (globalThis as unknown as { axe: { run: (context: Document, options: unknown) => Promise<AxeResults> } }).axe;
    return await globalAxe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
  });
}

function describeViolations(results: AxeResults) {
  return results.violations
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join("\n");
}

test("login page has no automated accessibility violations", async ({ page }) => {
  await page.goto("/login");
  const results = await runAxe(page);
  expect(results.violations, describeViolations(results)).toHaveLength(0);
});

test("dashboard has no automated accessibility violations", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL(/\/app/),
    page.click('button[type="submit"]'),
  ]);
  const results = await runAxe(page);
  expect(results.violations, describeViolations(results)).toHaveLength(0);
});
