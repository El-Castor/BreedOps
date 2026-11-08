import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendServerActionFields } from "./server-action";
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
const emailAdmin = `notif-admin-${marker}@example.test`;
const emailMember = `notif-member-${marker}@example.test`;
const emailOther = `notif-other-${marker}@example.test`;
const programCode = `NOTIF${marker.toUpperCase()}`;

// Covers the V2-02 (notifications & reminders) authorization and UX
// surface: internal notification center, generation on page load (no
// cron/scheduler exists yet - see migration 000025), deep links, read
// state, and cross-team isolation.
describe.sequential("notification center", () => {
  beforeAll(async () => {
    const team = await admin
      .from("organizations")
      .insert({ name: "Notif team", slug: `notif-${marker}` })
      .select("id")
      .single();
    if (team.error) throw team.error;
    ids.team = team.data.id;
    const otherTeam = await admin
      .from("organizations")
      .insert({ name: "Notif other team", slug: `notif-other-${marker}` })
      .select("id")
      .single();
    if (otherTeam.error) throw otherTeam.error;
    ids.otherTeam = otherTeam.data.id;

    const program = await admin
      .from("programs")
      .insert({
        organization_id: ids.team,
        code: programCode,
        name: "Notif program",
        species: "Test species",
      })
      .select("id")
      .single();
    if (program.error) throw program.error;
    ids.program = program.data.id;

    const adminUser = await admin.auth.admin.createUser({
      email: emailAdmin,
      password,
      email_confirm: true,
    });
    if (adminUser.error) throw adminUser.error;
    ids.userAdmin = adminUser.data.user.id;
    const adminProfile = await admin
      .from("profiles")
      .insert({
        user_id: ids.userAdmin,
        organization_id: ids.team,
        role: "team_admin",
      })
      .select("id")
      .single();
    if (adminProfile.error) throw adminProfile.error;
    ids.profileAdmin = adminProfile.data.id;

    const memberUser = await admin.auth.admin.createUser({
      email: emailMember,
      password,
      email_confirm: true,
    });
    if (memberUser.error) throw memberUser.error;
    ids.userMember = memberUser.data.user.id;
    const memberProfile = await admin
      .from("profiles")
      .insert({
        user_id: ids.userMember,
        organization_id: ids.team,
        role: "user",
      })
      .select("id")
      .single();
    if (memberProfile.error) throw memberProfile.error;
    ids.profileMember = memberProfile.data.id;

    const otherUser = await admin.auth.admin.createUser({
      email: emailOther,
      password,
      email_confirm: true,
    });
    if (otherUser.error) throw otherUser.error;
    ids.userOther = otherUser.data.user.id;
    const otherProfile = await admin
      .from("profiles")
      .insert({
        user_id: ids.userOther,
        organization_id: ids.otherTeam,
        role: "user",
      })
      .select("id")
      .single();
    if (otherProfile.error) throw otherProfile.error;

    const cycle = await admin
      .from("experimental_cycles")
      .insert({
        program_id: ids.program,
        name: "Notif cycle",
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
        title: "Notif overdue task",
        planned_date: yesterday,
        due_date: yesterday,
        status: "not_started",
        assigned_to: ids.profileMember,
      })
      .select("id")
      .single();
    if (task.error) throw task.error;
    ids.task = task.data.id;

    const item = await admin
      .from("inventory_items")
      .insert({
        organization_id: ids.team,
        name: "Notif low-stock reagent",
        default_unit: "kg",
        minimum_stock: 10,
      })
      .select("id")
      .single();
    if (item.error) throw item.error;
    ids.item = item.data.id;
    const lot = await admin
      .from("inventory_lots")
      .insert({
        inventory_item_id: ids.item,
        batch_number: `NOTIF-LOT-${marker}`,
        initial_quantity: 5,
        current_quantity: 5,
      })
      .select("id")
      .single();
    if (lot.error) throw lot.error;
  }, 30000);

  afterAll(async () => {
    for (const key of ["userAdmin", "userMember", "userOther"])
      if (ids[key]) await admin.auth.admin.deleteUser(ids[key]);
    for (const key of ["team", "otherTeam"])
      if (ids[key]) hardDeleteOrganization(ids[key]);
  });

  it("generates an overdue-task notification for the assignee on page load (no cron exists yet - see migration 000025)", async () => {
    await signIn(emailMember, password);
    const html = await (await request("/app")).text();
    expect(html).toContain("Tâche en retard");
    expect(html).toContain("Notif overdue task");
  });

  it("generates a team-wide low-stock notification visible to every active member", async () => {
    await signIn(emailAdmin, password);
    const html = await (await request("/app")).text();
    expect(html).toContain("Stock faible");
    expect(html).toContain("Notif low-stock reagent");
  });

  it("a repeat page load never creates a duplicate - the unread count stays stable", async () => {
    await signIn(emailAdmin, password);
    await request("/app");
    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_profile_id", ids.profileAdmin)
      .is("resolved_at", null);
    await request("/app");
    const second = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_profile_id", ids.profileAdmin)
      .is("resolved_at", null);
    expect(second.count).toBe(count);
  });

  it("marking a notification read navigates to its deep link and clears it from the unread count", async () => {
    await signIn(emailAdmin, password);
    const before = await (await request("/app")).text();
    expect(before).toContain('class="notification-badge"');

    const notification = await admin
      .from("notifications")
      .select("id,link_path")
      .eq("recipient_profile_id", ids.profileAdmin)
      .eq("category", "stock_low")
      .single();
    expect(notification.error).toBeNull();

    const body = new FormData();
    appendServerActionFields(body, before, "mark-notification-read");
    body.set("id", notification.data!.id);
    body.set("next", notification.data!.link_path);
    const response = await request("/app", {
      method: "POST",
      headers: { origin: base },
      body,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      notification.data!.link_path,
    );

    const after = await admin
      .from("notifications")
      .select("read_at")
      .eq("id", notification.data!.id)
      .single();
    expect(after.data!.read_at).not.toBeNull();
  });

  it("a user in a different organization never sees this team's notifications", async () => {
    await signIn(emailOther, password);
    const html = await (await request("/app")).text();
    expect(html).not.toContain("Notif overdue task");
    expect(html).not.toContain("Notif low-stock reagent");
    expect(html).not.toContain('class="notification-badge"');
  });

  it("never leaks the service-role key or any server secret into the rendered page", async () => {
    await signIn(emailAdmin, password);
    const html = await (await request("/app")).text();
    expect(html).not.toContain(backend.SERVICE_ROLE_KEY);
    expect(html.toLowerCase()).not.toContain("service_role");
  });

  it("an archived (deleted) task never generates a notification", async () => {
    const archivedTask = await admin
      .from("tasks")
      .insert({
        experimental_cycle_id: ids.cycle,
        program_id: ids.program,
        title: "Notif archived overdue task",
        planned_date: new Date(Date.now() - 86_400_000)
          .toISOString()
          .slice(0, 10),
        due_date: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
        status: "not_started",
        assigned_to: ids.profileMember,
        deleted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (archivedTask.error) throw archivedTask.error;
    await signIn(emailMember, password);
    const html = await (await request("/app")).text();
    expect(html).not.toContain("Notif archived overdue task");
  });
});
