import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendServerActionFields } from "./server-action";
import { hardDeleteOrganization } from "./db-cleanup";
const backend = JSON.parse(readFileSync(".local/test-backend.json", "utf8"));
if (backend.API_URL !== "http://127.0.0.1:55421")
  throw new Error("Tests require isolated local Supabase");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const base = "http://localhost:3107",
  marker = randomUUID().slice(0, 8),
  email = `workflow-${marker}@example.test`,
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
async function submit(
  html: string,
  name: string,
  values: Record<string, string>,
) {
  const body = new FormData();
  appendServerActionFields(body, html, name);
  Object.entries(values).forEach(([k, v]) => body.set(k, v));
  const response = await request(
    `/app/operations?program=${ids.program}&tab=templates`,
    { method: "POST", headers: { origin: base }, body },
  );
  expect(response.status).toBe(200);
  return response;
}

describe.sequential("experimental workflows: templates, scheduling, Gantt", () => {
  beforeAll(async () => {
    const team = await admin
      .from("organizations")
      .insert({ name: "Synthetic workflow test", slug: `workflow-${marker}` })
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
        display_name: "Synthetic workflow operator",
      })
      .select("id")
      .single();
    if (profile.error) throw profile.error;
    ids.profile = profile.data.id;
    const program = await admin
      .from("programs")
      .insert({
        organization_id: ids.team,
        code: `WF-${marker}`,
        name: "Synthetic workflow program",
      })
      .select("id")
      .single();
    if (program.error) throw program.error;
    ids.program = program.data.id;
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
    if (ids.team) hardDeleteOrganization(ids.team);
  });

  it("creates two task templates with a required checklist item", async () => {
    const html = await (
      await request(`/app/operations?program=${ids.program}&tab=templates`)
    ).text();
    await submit(html, "task-template-create", {
      program_id: ids.program,
      code: `TA-${marker}`,
      name: "Semis",
      description: "",
      zone: "Zone 1",
      priority: "medium",
      sop_code: "",
      expected_deliverable: "",
    });
    await submit(html, "task-template-create", {
      program_id: ids.program,
      code: `TB-${marker}`,
      name: "Récolte",
      description: "",
      zone: "Zone 1",
      priority: "high",
      sop_code: "",
      expected_deliverable: "",
    });
    const templates = await admin
      .from("task_templates")
      .select("id,name")
      .eq("program_id", ids.program)
      .order("name");
    if (templates.error) throw templates.error;
    expect(templates.data).toHaveLength(2);
    ids.taskTemplateA = templates.data.find((t) => t.name === "Semis")!.id;
    ids.taskTemplateB = templates.data.find((t) => t.name === "Récolte")!.id;

    const checklistAdd = await request(
      `/app/operations?program=${ids.program}&tab=templates`,
    ).then((r) => r.text());
    await submit(checklistAdd, `template-checklist-add-${ids.taskTemplateB}`, {
      task_template_id: ids.taskTemplateB,
      label: "Contrôle qualité final",
      is_required: "true",
    });
    const checklist = await admin
      .from("task_template_checklist_items")
      .select("id")
      .eq("task_template_id", ids.taskTemplateB);
    if (checklist.error) throw checklist.error;
    expect(checklist.data).toHaveLength(1);
  }, 15000);

  it("builds a cycle template with a finish-to-start dependency", async () => {
    const html = await (
      await request(`/app/operations?program=${ids.program}&tab=templates`)
    ).text();
    await submit(html, "cycle-template-create", {
      program_id: ids.program,
      code: `WF-${marker}`,
      name: "Workflow UAT",
      description: "",
    });
    const template = await admin
      .from("experimental_cycle_templates")
      .select("id")
      .eq("program_id", ids.program)
      .single();
    if (template.error) throw template.error;
    ids.cycleTemplate = template.data.id;

    const builderUrl = `/app/operations?program=${ids.program}&tab=templates&template=${ids.cycleTemplate}`;
    let builderHtml = await (await request(builderUrl)).text();
    await submitAt(builderUrl, builderHtml, `step-add-${ids.cycleTemplate}`, {
      cycle_template_id: ids.cycleTemplate,
      task_template_id: ids.taskTemplateA,
      start_offset_days: "0",
      duration_days: "2",
      default_assigned_to: "",
    });
    builderHtml = await (await request(builderUrl)).text();
    await submitAt(builderUrl, builderHtml, `step-add-${ids.cycleTemplate}`, {
      cycle_template_id: ids.cycleTemplate,
      task_template_id: ids.taskTemplateB,
      start_offset_days: "0",
      duration_days: "1",
      default_assigned_to: ids.profile,
    });
    const steps = await admin
      .from("experimental_cycle_template_tasks")
      .select("id,task_template_id")
      .eq("cycle_template_id", ids.cycleTemplate)
      .order("sort_order");
    if (steps.error) throw steps.error;
    expect(steps.data).toHaveLength(2);
    const stepA = steps.data.find((s) => s.task_template_id === ids.taskTemplateA)!;
    const stepB = steps.data.find((s) => s.task_template_id === ids.taskTemplateB)!;

    builderHtml = await (await request(builderUrl)).text();
    await submitAt(builderUrl, builderHtml, `dependency-add-${ids.cycleTemplate}`, {
      cycle_template_id: ids.cycleTemplate,
      predecessor_template_task_id: stepA.id,
      successor_template_task_id: stepB.id,
      lag_days: "0",
    });
    const dependencies = await admin
      .from("experimental_cycle_template_dependencies")
      .select("id")
      .eq("cycle_template_id", ids.cycleTemplate);
    if (dependencies.error) throw dependencies.error;
    expect(dependencies.data).toHaveLength(1);
  }, 15000);

  it("previews the generated schedule without persisting anything", async () => {
    const before = await admin
      .from("experimental_cycles")
      .select("id", { count: "exact", head: true })
      .eq("program_id", ids.program);
    const previewHtml = await (
      await request(
        `/app/operations?program=${ids.program}&tab=templates&template=${ids.cycleTemplate}&start=2026-04-06`,
      )
    ).text();
    expect(previewHtml).toContain("Semis");
    expect(previewHtml).toContain("Récolte");
    expect(previewHtml).toContain("08/04");
    const after = await admin
      .from("experimental_cycles")
      .select("id", { count: "exact", head: true })
      .eq("program_id", ids.program);
    expect(after.count ?? 0).toBe(before.count ?? 0);
  }, 15000);

  it("instantiates the cycle atomically with dependency-aware dates", async () => {
    const url = `/app/operations?program=${ids.program}&tab=templates&template=${ids.cycleTemplate}&start=2026-04-06`;
    const html = await (await request(url)).text();
    await submitAt(url, html, `instantiate-${ids.cycleTemplate}`, {
      cycle_template_id: ids.cycleTemplate,
      start_date: "2026-04-06",
      cycle_name: "Cycle UAT généré",
    });
    const cycle = await admin
      .from("experimental_cycles")
      .select("id,end_date,source_template_id")
      .eq("program_id", ids.program)
      .eq("name", "Cycle UAT généré")
      .single();
    if (cycle.error) throw cycle.error;
    ids.cycle = cycle.data.id;
    expect(cycle.data.source_template_id).toBe(ids.cycleTemplate);
    expect(cycle.data.end_date).toBe("2026-04-08");
    const tasks = await admin
      .from("tasks")
      .select("id,title,planned_date,due_date")
      .eq("experimental_cycle_id", ids.cycle)
      .order("planned_date");
    if (tasks.error) throw tasks.error;
    expect(tasks.data).toHaveLength(2);
    ids.taskA = tasks.data.find((t) => t.title === "Semis")!.id;
    ids.taskB = tasks.data.find((t) => t.title === "Récolte")!.id;
    expect(tasks.data.find((t) => t.title === "Récolte")?.planned_date).toBe(
      "2026-04-08",
    );
    const checklist = await admin
      .from("task_checklist_items")
      .select("id,is_completed")
      .eq("task_id", ids.taskB);
    if (checklist.error) throw checklist.error;
    expect(checklist.data).toHaveLength(1);
    ids.checklistItem = checklist.data[0].id;
  }, 15000);

  it("lists generated tasks and renders the Gantt timeline", async () => {
    const tasksHtml = await (
      await request(`/app/operations?program=${ids.program}&tab=tasks`)
    ).text();
    expect(tasksHtml).toContain("Semis");
    expect(tasksHtml).toContain("Récolte");
    const filteredHtml = await (
      await request(
        `/app/operations?program=${ids.program}&tab=tasks&priority=high`,
      )
    ).text();
    expect(filteredHtml).toContain("Récolte");
    // "Semis" legitimately still appears inside Récolte's own dependency
    // text ("Dépend de : Semis"); only its own row must be filtered out.
    expect(filteredHtml).not.toContain("<strong>Semis</strong>");
    const ganttHtml = await (
      await request(`/app/operations?program=${ids.program}&tab=gantt`)
    ).text();
    expect(ganttHtml).toContain("Semis");
    expect(ganttHtml).toContain("Récolte");
    expect(ganttHtml).toContain("gantt-bar");
  }, 15000);

  it("blocks completion until the required checklist item is done, then allows it", async () => {
    const url = `/app/operations?program=${ids.program}&tab=tasks`;
    const html = await (await request(url)).text();
    // The exact French rejection message is verified at the database layer
    // (tests/experimental-workflows.sql); without JS this POST is a plain
    // navigation and the ActionState message never reaches the response
    // body, so what matters here is the side effect: the task stays open.
    await submitAt(url, html, `task-status-${ids.taskB}`, {
      task_id: ids.taskB,
      status: "completed",
    });
    const stillOpen = await admin
      .from("tasks")
      .select("status")
      .eq("id", ids.taskB)
      .single();
    if (stillOpen.error) throw stillOpen.error;
    expect(stillOpen.data.status).not.toBe("completed");

    await submitAt(url, html, `checklist-${ids.checklistItem}`, {
      item_id: ids.checklistItem,
      completed: "true",
      comment: "",
    });
    const completedItem = await admin
      .from("task_checklist_items")
      .select("is_completed,completed_by")
      .eq("id", ids.checklistItem)
      .single();
    if (completedItem.error) throw completedItem.error;
    expect(completedItem.data.is_completed).toBe(true);
    expect(completedItem.data.completed_by).toBe(ids.profile);

    await submitAt(url, html, `task-status-${ids.taskB}`, {
      task_id: ids.taskB,
      status: "completed",
    });
    const completedTask = await admin
      .from("tasks")
      .select("status,completed_at")
      .eq("id", ids.taskB)
      .single();
    if (completedTask.error) throw completedTask.error;
    expect(completedTask.data.status).toBe("completed");
    expect(completedTask.data.completed_at).not.toBeNull();
  }, 15000);
});

async function submitAt(
  path: string,
  html: string,
  name: string,
  values: Record<string, string>,
) {
  const body = new FormData();
  appendServerActionFields(body, html, name);
  Object.entries(values).forEach(([k, v]) => body.set(k, v));
  const response = await request(path, {
    method: "POST",
    headers: { origin: base },
    body,
  });
  expect(response.status).toBe(200);
  return response;
}
