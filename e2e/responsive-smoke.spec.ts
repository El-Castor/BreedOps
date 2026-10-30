import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { hardDeleteOrganization } from "../tests/db-cleanup";
import { currentProfile } from "../scripts/lib/stack-identity.mjs";

// Viewport smoke coverage at the 5 representative widths this milestone's
// manual responsive pass used. Asserts the page itself never scrolls
// horizontally (document.body.scrollWidth, not documentElement.scrollWidth
// - a correctly-contained overflow:auto region such as a wide data table
// or the sub-navigation tabs can legitimately make documentElement report
// a larger scrollWidth without the page actually scrolling; confirmed
// during this milestone by checking window.scrollX after a wheel event).
// Large tables are expected to scroll *within themselves* (.table-wrap),
// never the whole page.
const WIDTHS = [
  { width: 1440, height: 900, label: "desktop" },
  { width: 1280, height: 800, label: "laptop" },
  { width: 1024, height: 1366, label: "tablet-landscape" },
  { width: 768, height: 1024, label: "tablet-portrait" },
  { width: 390, height: 844, label: "mobile" },
];

const profile = currentProfile();
const backend = JSON.parse(readFileSync(profile.backendFile, "utf8"));
if (backend.API_URL !== profile.apiUrl)
  throw new Error("E2E requires isolated local Supabase");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const marker = randomUUID().slice(0, 8);
const email = `responsive-${marker}@example.test`;
const password = `${randomUUID()}Aa9!`;
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  const team = await admin
    .from("organizations")
    .insert({ name: "Synthetic responsive team", slug: `responsive-${marker}` })
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
    display_name: "Synthetic responsive operator",
  });
  if (profile.error) throw profile.error;
});

test.afterAll(async () => {
  if (ids.user) await admin.auth.admin.deleteUser(ids.user);
  if (ids.team) hardDeleteOrganization(ids.team);
});

for (const vp of WIDTHS) {
  test(`dashboard never scrolls the whole page horizontally at ${vp.label} (${vp.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await Promise.all([
      page.waitForURL(/\/app/),
      page.click('button[type="submit"]'),
    ]);
    const overflow = await page.evaluate(
      () => document.body.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, "document.body.scrollWidth should not exceed the viewport").toBe(false);
  });
}
