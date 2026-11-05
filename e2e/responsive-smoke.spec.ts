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
  { width: 320, height: 844, label: "mobile-narrow" },
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
const programCode = `RESPE2E${marker.toUpperCase()}`;
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  // Intentionally long team/program/display names throughout this fixture:
  // a short synthetic name can pass by accident even when the underlying
  // layout isn't genuinely responsive (see task review: the previous
  // program-selector-only fix was never exercised against a long user
  // display name or team name, nor against the popovers' own positioning).
  const team = await admin
    .from("organizations")
    .insert({
      name: "Coopérative expérimentale agro-biologique du Plateau central",
      slug: `responsive-${marker}`,
    })
    .select("id")
    .single();
  if (team.error) throw team.error;
  ids.team = team.data.id;
  // A realistically long program name exercises the app-header's
  // program selector, which is the element this suite's mobile check
  // (below) found overflowing the 390px viewport (header elements
  // collapsing to the header-team fallback never triggered it).
  const program = await admin
    .from("programs")
    .insert({
      organization_id: ids.team,
      code: programCode,
      name: "Programme de sélection tomate ancienne de montagne à haute valeur patrimoniale régionale",
      species: "Synthetic species",
    })
    .select("id")
    .single();
  if (program.error) throw program.error;
  ids.program = program.data.id;
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
    display_name: "Marie-Alexandrine de Montmorency-Beauharnais-Lafayette",
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
    expect(
      overflow,
      "document.body.scrollWidth should not exceed the viewport",
    ).toBe(false);
  });
}

// Regression check: the app-header (program selector, notification bell,
// user menu) previously didn't shrink and dragged document.body wide at
// mobile widths, even though document.body.scrollWidth checks scoped to
// main.app-content never caught it, since the overflowing elements belong
// to the shell, not to any one page. Covers widths below the AppShell's
// mobile breakpoint (960px) plus the full 320-1440px matrix, with the
// header's popovers open, since that's the realistic worst case. Runs on
// /app/phenotypes (a program-scoped page distinct from the dashboard
// tested above) per the task's explicit ask to cover more than one route.
for (const width of [320, 390, 480, 640, 768, 1024, 1440]) {
  test(`app-header and its popovers do not overflow the viewport at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await Promise.all([
      page.waitForURL(/\/app/),
      page.click('button[type="submit"]'),
    ]);
    await page.goto(`/app/phenotypes?program=${ids.program}`);

    const header = page.locator(".app-header");
    const headerBox = await header.boundingBox();
    expect(headerBox, "app-header should be rendered").not.toBeNull();
    expect(
      headerBox!.x + headerBox!.width,
      "app-header should not extend past the viewport width",
    ).toBeLessThanOrEqual(width + 1);

    // Each of the three header popovers, opened one at a time: program
    // selector, notification center, user menu. A regression here is a
    // popover whose own bounding box runs off either edge of the
    // viewport - the kind of overflow document.body.scrollWidth alone
    // does not reliably catch for an absolutely/fixed-positioned element
    // (see the CSS fix's own comment in globals.css).
    for (const [trigger, popover] of [
      [".program-selector-trigger", ".program-selector-menu"],
      [".notification-center summary", ".notification-popover"],
      [".user-menu summary", ".user-popover"],
    ] as const) {
      const triggerLocator = page.locator(trigger);
      const ariaExpandedBefore = await triggerLocator
        .getAttribute("aria-expanded")
        .catch(() => null);
      await triggerLocator.click();
      const box = await page.locator(popover).boundingBox();
      expect(
        box,
        `${popover} should be visible once its trigger is clicked`,
      ).not.toBeNull();
      expect(
        box!.x,
        `${popover} left edge at ${width}px`,
      ).toBeGreaterThanOrEqual(-1);
      expect(
        box!.x + box!.width,
        `${popover} right edge at ${width}px`,
      ).toBeLessThanOrEqual(width + 1);
      // Only the program selector exposes aria-expanded today (native
      // <details>/<summary> communicates its own open state to assistive
      // technology without it) - toggling must not silently break that.
      if (ariaExpandedBefore !== null) {
        await expect(triggerLocator).toHaveAttribute("aria-expanded", "true");
      }
      await triggerLocator.click();

      const bodyOverflow = await page.evaluate(
        () => document.body.scrollWidth > window.innerWidth + 1,
      );
      expect(
        bodyOverflow,
        `no document body overflow with ${popover} open at ${width}px`,
      ).toBe(false);
    }
  });
}
