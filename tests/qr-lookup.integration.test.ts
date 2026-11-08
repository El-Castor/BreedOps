import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hardDeleteOrganization } from "./db-cleanup";
import { currentProfile } from "../scripts/lib/stack-identity.mjs";

const profile = currentProfile();
const backend = JSON.parse(readFileSync(profile.backendFile, "utf8"));
if (backend.API_URL !== profile.apiUrl)
  throw new Error("Tests require isolated local Supabase");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const base = profile.appOrigin;
const marker = randomUUID().slice(0, 8);
const ids: Record<string, string> = {};
let cookies = "";

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(base + path, {
    ...options,
    redirect: "manual",
    headers: { cookie: cookies, ...options.headers },
  });
  const jar = new Map(
    cookies
      .split("; ")
      .filter(Boolean)
      .map((entry) => {
        const index = entry.indexOf("=");
        return [entry.slice(0, index), entry.slice(index + 1)];
      }),
  );
  for (const item of response.headers.getSetCookie()) {
    const pair = item.split(";")[0];
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  cookies = [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  return response;
}

async function signIn(email: string, password: string) {
  cookies = "";
  const response = await request("/auth/login", {
    method: "POST",
    headers: { origin: base },
    body: new URLSearchParams({ email, password }),
  });
  expect(response.status).toBe(303);
}

const password = `${randomUUID()}Aa9!`;
const emailA = `qr-a-${marker}@example.test`;
const emailB = `qr-b-${marker}@example.test`;
const programCode = `QR${marker.toUpperCase()}`;
const parentCode = `${programCode}-P-0001`;
const archivedParentCode = `${programCode}-P-0002`;

// Covers the V2-01 (QR codes & scientific labeling) authorization surface:
// /app/lookup is the only authenticated destination a scanned QR ever
// resolves through (src/app/app/lookup/page.tsx), using the exact same
// RLS-scoped client every other page uses. A damaged/unreadable QR falls
// back to a manual business-code search on the same page.
describe.sequential("QR lookup authorization (/app/lookup)", () => {
  beforeAll(async () => {
    const teamA = await admin
      .from("organizations")
      .insert({ name: "QR team A", slug: `qr-a-${marker}` })
      .select("id")
      .single();
    if (teamA.error) throw teamA.error;
    ids.teamA = teamA.data.id;
    const teamB = await admin
      .from("organizations")
      .insert({ name: "QR team B", slug: `qr-b-${marker}` })
      .select("id")
      .single();
    if (teamB.error) throw teamB.error;
    ids.teamB = teamB.data.id;

    const programA = await admin
      .from("programs")
      .insert({
        organization_id: ids.teamA,
        code: programCode,
        name: "QR program A",
        species: "Test species",
      })
      .select("id")
      .single();
    if (programA.error) throw programA.error;
    ids.programA = programA.data.id;

    const userA = await admin.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
    });
    if (userA.error) throw userA.error;
    ids.userA = userA.data.user.id;
    const profileA = await admin
      .from("profiles")
      .insert({ user_id: ids.userA, organization_id: ids.teamA, role: "user" })
      .select("id")
      .single();
    if (profileA.error) throw profileA.error;

    const userB = await admin.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
    });
    if (userB.error) throw userB.error;
    ids.userB = userB.data.user.id;
    const profileB = await admin
      .from("profiles")
      .insert({ user_id: ids.userB, organization_id: ids.teamB, role: "user" })
      .select("id")
      .single();
    if (profileB.error) throw profileB.error;

    const parent = await admin
      .from("parent_lines")
      .insert({
        program_id: ids.programA,
        parent_code: parentCode,
        line_name: "QR test parent",
      })
      .select("id")
      .single();
    if (parent.error) throw parent.error;
    ids.parent = parent.data.id;

    const archivedParent = await admin
      .from("parent_lines")
      .insert({
        program_id: ids.programA,
        parent_code: archivedParentCode,
        line_name: "QR archived parent",
        deleted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (archivedParent.error) throw archivedParent.error;
    ids.archivedParent = archivedParent.data.id;

    const item = await admin
      .from("inventory_items")
      .insert({
        organization_id: ids.teamA,
        name: "QR test reagent",
        category: "reagent",
      })
      .select("id")
      .single();
    if (item.error) throw item.error;
    ids.item = item.data.id;

    const archivedItem = await admin
      .from("inventory_items")
      .insert({
        organization_id: ids.teamA,
        name: "QR archived reagent",
        category: "reagent",
        deleted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (archivedItem.error) throw archivedItem.error;
    ids.archivedItem = archivedItem.data.id;
  }, 30000);

  afterAll(async () => {
    for (const key of ["userA", "userB"])
      if (ids[key]) await admin.auth.admin.deleteUser(ids[key]);
    for (const key of ["teamA", "teamB"])
      if (ids[key]) hardDeleteOrganization(ids[key]);
  });

  it("resolves an entity the caller is actually authorized to see", async () => {
    await signIn(emailA, password);
    const html = await (
      await request(`/app/lookup?type=parent&id=${ids.parent}`)
    ).text();
    expect(html).toContain(parentCode);
    expect(html).not.toContain("Aucune entité correspondante");
  });

  it("denies a cross-team lookup of the exact same entity id", async () => {
    await signIn(emailB, password);
    const html = await (
      await request(`/app/lookup?type=parent&id=${ids.parent}`)
    ).text();
    expect(html).toContain("Aucune entité correspondante");
    expect(html).not.toContain(parentCode);
    expect(html).not.toContain("QR test parent");
  });

  it("surfaces an archived breeding entity as archived, never as missing (matches the registry's own archived-row policy)", async () => {
    await signIn(emailA, password);
    const html = await (
      await request(`/app/lookup?type=parent&id=${ids.archivedParent}`)
    ).text();
    expect(html).toContain(archivedParentCode);
    expect(html).toContain("Archivé");
  });

  it("treats an archived inventory item exactly like a missing one, matching the Inventory page's own lack of a 'show archived' toggle", async () => {
    await signIn(emailA, password);
    const html = await (
      await request(`/app/lookup?type=inventory_item&id=${ids.archivedItem}`)
    ).text();
    expect(html).toContain("Aucune entité correspondante");
  });

  it("rejects an unsupported entity type as a plain not-found, never an error", async () => {
    await signIn(emailA, password);
    const response = await request(
      `/app/lookup?type=location&id=${ids.parent}`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Aucune entité correspondante");
  });

  it("rejects a malformed UUID as a plain not-found, never an error", async () => {
    await signIn(emailA, password);
    const response = await request(
      "/app/lookup?type=parent&id=not-a-real-uuid",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Aucune entité correspondante");
  });

  it("resolves by business code through the manual fallback, for when the QR itself is unreadable", async () => {
    await signIn(emailA, password);
    const html = await (
      await request(`/app/lookup?code=${encodeURIComponent(parentCode)}`)
    ).text();
    expect(html).toContain("QR test parent");
  });

  it("never grants access by itself - an unauthenticated request is redirected to login, not shown the entity", async () => {
    cookies = "";
    const response = await request(`/app/lookup?type=parent&id=${ids.parent}`);
    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain(
      encodeURIComponent(`/app/lookup?type=parent&id=${ids.parent}`),
    );
  });
});
