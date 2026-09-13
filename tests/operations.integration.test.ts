import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const backend = JSON.parse(readFileSync(".local/test-backend.json", "utf8"));
if (backend.API_URL !== "http://127.0.0.1:55421")
  throw new Error("Tests require isolated local Supabase");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const base = "http://localhost:3107",
  marker = randomUUID().slice(0, 8),
  email = `operations-${marker}@example.test`,
  password = randomUUID() + "Aa9!";
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
        const i = entry.indexOf("=");
        return [entry.slice(0, i), entry.slice(i + 1)];
      }),
  );
  for (const item of response.headers.getSetCookie()) {
    const pair = item.split(";")[0],
      i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  cookies = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  return response;
}
function actionFor(html: string, name: string) {
  const form = [...html.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)]
    .map((m) => m[0])
    .find((v) => v.includes(`data-action="${name}"`));
  const action = form?.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
  if (!action) throw new Error(`Action ${name} not found`);
  return action;
}
async function submit(
  html: string,
  name: string,
  values: Record<string, string>,
) {
  const body = new FormData();
  body.set(actionFor(html, name), "");
  Object.entries(values).forEach(([k, v]) => body.set(k, v));
  expect(
    (
      await request(`/app/operations?program=${ids.program}`, {
        method: "POST",
        headers: { origin: base },
        body,
      })
    ).status,
  ).toBe(200);
}

describe.sequential("experimental operations and database dashboard", () => {
  beforeAll(async () => {
    const team = await admin
      .from("organizations")
      .insert({
        name: "Synthetic operations test",
        slug: `operations-${marker}`,
      })
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
    const profile = await admin
      .from("profiles")
      .insert({
        user_id: ids.user,
        organization_id: ids.team,
        role: "user",
        display_name: "Synthetic operator",
      })
      .select("id")
      .single();
    if (profile.error) throw profile.error;
    ids.profile = profile.data.id;
    const program = await admin
      .from("programs")
      .insert({
        organization_id: ids.team,
        code: `OP-${marker}`,
        name: "Synthetic operations program",
      })
      .select("id")
      .single();
    if (program.error) throw program.error;
    ids.program = program.data.id;
    const parents = await admin
      .from("parent_lines")
      .insert([
        { program_id: ids.program, parent_code: `OPA-${marker}` },
        { program_id: ids.program, parent_code: `OPB-${marker}` },
      ])
      .select("id");
    if (parents.error) throw parents.error;
    const cross = await admin
      .from("crosses")
      .insert({
        program_id: ids.program,
        cross_code: `OPX-${marker}`,
        female_parent_id: parents.data[0].id,
        male_parent_id: parents.data[1].id,
      })
      .select("id")
      .single();
    if (cross.error) throw cross.error;
    const family = await admin
      .from("families")
      .insert({
        program_id: ids.program,
        cross_id: cross.data.id,
        family_code: `OPF-${marker}`,
      })
      .select("id")
      .single();
    if (family.error) throw family.error;
    const lot = await admin
      .from("seed_lots")
      .insert({
        program_id: ids.program,
        cross_id: cross.data.id,
        family_id: family.data.id,
        seed_lot_code: `OPL-${marker}`,
      })
      .select("id")
      .single();
    if (lot.error) throw lot.error;
    const germ = await admin
      .from("germination_tests")
      .insert({
        seed_lot_id: lot.data.id,
        test_date: "2026-09-01",
        seeds_tested: 100,
        seeds_germinated: 88,
      });
    if (germ.error) throw germ.error;
    const phenotype = await admin
      .from("phenotypes")
      .insert({
        program_id: ids.program,
        family_id: family.data.id,
        seed_lot_id: lot.data.id,
        phenotype_code: `OPPH-${marker}`,
      })
      .select("id")
      .single();
    if (phenotype.error) throw phenotype.error;
    const model = await admin
      .from("selection_models")
      .insert({
        program_id: ids.program,
        name: "Synthetic KPI model",
        maximum_score: 130,
      })
      .select("id")
      .single();
    if (model.error) throw model.error;
    const evaluation = await admin
      .from("phenotype_evaluations")
      .insert({
        phenotype_id: phenotype.data.id,
        selection_model_id: model.data.id,
        evaluator_id: ids.profile,
        evaluation_date: "2026-09-13",
        weighted_score: 120,
        normalized_score: 92.31,
        automatic_decision: "elite",
      });
    if (evaluation.error) throw evaluation.error;
    const item = await admin
      .from("inventory_items")
      .insert({
        organization_id: ids.team,
        name: "Synthetic low stock",
        minimum_stock: 5,
      })
      .select("id")
      .single();
    if (item.error) throw item.error;
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 10);
    const inventoryLot = await admin
      .from("inventory_lots")
      .insert({
        inventory_item_id: item.data.id,
        batch_number: `EXP-${marker}`,
        expiration_date: expiry.toISOString().slice(0, 10),
        initial_quantity: 0,
        current_quantity: 0,
      });
    if (inventoryLot.error) throw inventoryLot.error;
    expect(
      (
        await request("/auth/login", {
          method: "POST",
          headers: { origin: base },
          body: new URLSearchParams({ email, password }),
        })
      ).status,
    ).toBe(303);
  }, 30000);
  afterAll(async () => {
    if (ids.user) await admin.auth.admin.deleteUser(ids.user);
    if (ids.team) await admin.from("organizations").delete().eq("id", ids.team);
  });
  it("renders all persisted KPI categories", async () => {
    const html = await (
      await request(`/app/operations?program=${ids.program}`)
    ).text();
    for (const value of [
      "Croisements",
      "Lots de graines",
      "88 %",
      "Phénotypes évalués",
      "Phénotypes Elite",
      "Articles sous seuil",
      "Lots bientôt périmés",
      "Tâches en retard",
      "Tâches terminées",
    ])
      expect(html).toContain(value);
  });
  it("creates a cycle and assigned overdue task", async () => {
    let html = await (
      await request(`/app/operations?program=${ids.program}`)
    ).text();
    await submit(html, "cycle", {
      program_id: ids.program,
      name: "Synthetic 2026 cycle",
      start_date: "2026-09-01",
      end_date: "2026-12-31",
    });
    const cycle = await admin
      .from("experimental_cycles")
      .select("id")
      .eq("program_id", ids.program)
      .single();
    if (cycle.error) throw cycle.error;
    ids.cycle = cycle.data.id;
    html = await (
      await request(`/app/operations?program=${ids.program}`)
    ).text();
    await submit(html, "task", {
      program_id: ids.program,
      experimental_cycle_id: ids.cycle,
      title: "Synthetic overdue task",
      description: "fixture",
      planned_date: "2026-09-01",
      due_date: "2026-09-12",
      assigned_to: ids.profile,
      priority: "high",
      zone: "Z1",
    });
    const task = await admin
      .from("tasks")
      .select("id,status,assigned_to")
      .eq("program_id", ids.program)
      .single();
    if (task.error) throw task.error;
    ids.task = task.data.id;
    expect(task.data).toMatchObject({
      status: "not_started",
      assigned_to: ids.profile,
    });
    const rendered = await (
      await request(`/app/operations?program=${ids.program}`)
    ).text();
    expect(rendered).toContain("En retard");
    expect(rendered).toContain("Synthetic operator");
  });
  it("completes the task consistently and updates dashboard and calendar", async () => {
    let html = await (
      await request(`/app/operations?program=${ids.program}`)
    ).text();
    await submit(html, `task-status-${ids.task}`, {
      task_id: ids.task,
      status: "completed",
    });
    const task = await admin
      .from("tasks")
      .select("status,completed_at")
      .eq("id", ids.task)
      .single();
    if (task.error) throw task.error;
    expect(task.data.status).toBe("completed");
    expect(task.data.completed_at).not.toBeNull();
    html = await (
      await request(`/app/operations?program=${ids.program}`)
    ).text();
    expect(html).toContain("100 %");
    expect(
      await (
        await request(`/app/operations?program=${ids.program}&view=calendar`)
      ).text(),
    ).toContain("Synthetic overdue task");
  });
});
