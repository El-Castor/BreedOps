import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const backend = JSON.parse(readFileSync(".local/test-backend.json", "utf8"));
if (backend.API_URL !== "http://127.0.0.1:55421")
  throw new Error("Tests require isolated local Supabase");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const base = "http://localhost:3107";
const marker = randomUUID().slice(0, 8);
const email = `breeding-${marker}@example.test`;
const password = randomUUID() + "Aa9!";
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

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function actionFields(html: string, marker: string) {
  const form = [...html.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((value) => value.includes(`data-action="${marker}"`));
  if (!form) throw new Error(`Form for ${marker} not found`);
  const fields = [...form.matchAll(/<input\b[^>]*>/g)]
    .map(([input]) => ({
      name: input.match(/\bname="([^"]+)"/)?.[1],
      value: input.match(/\bvalue="([^"]*)"/)?.[1] ?? "",
    }))
    .filter((field): field is { name: string; value: string } =>
      Boolean(field.name?.startsWith("$ACTION_")),
    );
  if (fields.length === 0)
    throw new Error(`Server Action fields for ${marker} not found`);
  return fields;
}

async function submit(
  html: string,
  marker: string,
  values: Record<string, string>,
) {
  const body = new FormData();
  actionFields(html, marker).forEach(({ name, value }) =>
    body.set(decodeHtml(name), decodeHtml(value)),
  );
  Object.entries(values).forEach(([key, value]) => body.set(key, value));
  const response = await request(
    marker === "program" ? "/app" : "/app/breeding",
    {
      method: "POST",
      headers: { origin: base },
      body,
    },
  );
  expect(response.status).toBe(200);
}

async function inProgram(table: string, filters: Record<string, string>) {
  let query = admin.from(table).select("*").eq("program_id", ids.program);
  for (const [column, value] of Object.entries(filters))
    query = query.eq(column, value);
  const { data, error } = await query.single();
  if (error) throw error;
  return data;
}

const codePattern = (type: string) =>
  new RegExp(`^P${marker.toUpperCase()}-${type}-\\d{4}$`);

async function one(table: string, column: string, value: string) {
  const { data, error } = await admin
    .from(table)
    .select("*")
    .eq(column, value)
    .single();
  if (error) throw error;
  return data;
}

describe.sequential("persisted breeding workflow", () => {
  beforeAll(async () => {
    const team = await admin
      .from("organizations")
      .insert({ name: "Synthetic breeding test", slug: `breeding-${marker}` })
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
      .insert({ user_id: ids.user, organization_id: ids.team, role: "user" })
      .select("id")
      .single();
    if (profile.error) throw profile.error;
    ids.profile = profile.data.id;
    const login = await request("/auth/login", {
      method: "POST",
      headers: { origin: base },
      body: new URLSearchParams({ email, password }),
    });
    expect(login.status).toBe(303);
  }, 30000);
  afterAll(async () => {
    if (ids.user) await admin.auth.admin.deleteUser(ids.user);
    if (ids.team) await admin.from("organizations").delete().eq("id", ids.team);
  });
  it("creates a team-owned program", async () => {
    const html = await (await request("/app")).text();
    await submit(html, "program", {
      code: `P-${marker}`,
      name: "Synthetic program",
      species: "Test species",
      campaign: "2026",
    });
    const row = await one("programs", "code", `P-${marker}`);
    ids.program = row.id;
    expect(row.organization_id).toBe(ids.team);
  });
  it("creates two parent lines", async () => {
    for (const suffix of ["F", "M"]) {
      const html = await (
        await request(`/app/breeding?program=${ids.program}`)
      ).text();
      await submit(html, "parent", {
        program_id: ids.program,
        line_name: `Synthetic ${suffix}`,
        generation: "4",
      });
      const parent = await inProgram("parent_lines", {
        line_name: `Synthetic ${suffix}`,
      });
      expect(parent.parent_code).toMatch(codePattern("P"));
      ids[`parent${suffix}`] = parent.id;
      ids[`parentCode${suffix}`] = parent.parent_code;
    }
  });
  it("creates and updates a cross with database-derived yield inputs", async () => {
    let html = await (
      await request(`/app/breeding?program=${ids.program}`)
    ).text();
    await submit(html, "cross", {
      program_id: ids.program,
      female_parent_id: ids.parentF,
      male_parent_id: ids.parentM,
      pollination_date: "2026-09-01",
      pollinated_units: "10",
      established_units: "8",
      total_seeds: "480",
    });
    const row = await inProgram("crosses", {});
    expect(row.cross_code).toMatch(codePattern("X"));
    ids.cross = row.id;
    ids.crossCode = row.cross_code;
    expect(row.female_parent_id).toBe(ids.parentF);
    expect(row.male_parent_id).toBe(ids.parentM);
    html = await (await request(`/app/breeding?program=${ids.program}`)).text();
    await submit(html, "cross-update", {
      id: ids.cross,
      status: "completed",
      notes: "Synthetic validated update",
    });
    expect((await one("crosses", "id", ids.cross)).status).toBe("completed");
  });
  it("rejects invalid cross lineage in PostgreSQL", async () => {
    const result = await admin.from("crosses").insert({
      program_id: ids.program,
      cross_code: `BAD-${marker}`,
      female_parent_id: ids.parentF,
      male_parent_id: ids.parentF,
      pollination_date: "2026-09-01",
    });
    expect(result.error?.code).toBe("23514");
  });
  it("creates a linked family and seed lot", async () => {
    let html = await (
      await request(`/app/breeding?program=${ids.program}`)
    ).text();
    await submit(html, "family", {
      program_id: ids.program,
      cross_id: ids.cross,
      generation: "1",
    });
    const family = await inProgram("families", {});
    expect(family.family_code).toMatch(codePattern("F"));
    ids.family = family.id;
    expect(family.cross_id).toBe(ids.cross);
    html = await (await request(`/app/breeding?program=${ids.program}`)).text();
    await submit(html, "seed-lot", {
      program_id: ids.program,
      cross_id: ids.cross,
      family_id: ids.family,
      harvest_date: "2026-09-10",
      total_quantity: "480",
      storage_location: "Synthetic shelf",
    });
    const lot = await inProgram("seed_lots", {});
    expect(lot.seed_lot_code).toMatch(codePattern("L"));
    ids.lot = lot.id;
    ids.lotCode = lot.seed_lot_code;
    expect(lot.family_id).toBe(ids.family);
  });
  it("records and displays a generated germination rate", async () => {
    const html = await (
      await request(`/app/breeding?program=${ids.program}`)
    ).text();
    await submit(html, "germination", {
      seed_lot_id: ids.lot,
      test_date: "2026-09-12",
      evaluation_day: "10",
      seeds_tested: "100",
      seeds_germinated: "92",
      method: "Synthetic paper test",
    });
    const row = await one("germination_tests", "seed_lot_id", ids.lot);
    expect(Number(row.germination_rate)).toBe(92);
    const rendered = await (
      await request(`/app/breeding?program=${ids.program}`)
    ).text();
    expect(rendered).toContain("92.00");
    expect(rendered).toContain(ids.lotCode);
  });
  it("filters crosses by code", async () => {
    const html = await (
      await request(`/app/breeding?program=${ids.program}&q=${ids.crossCode}`)
    ).text();
    expect(html).toContain(ids.crossCode);
    const empty = await (
      await request(`/app/breeding?program=${ids.program}&q=NO-MATCH`)
    ).text();
    expect(empty).toContain("Aucun croisement");
  });
  it("archives and restores a parent without losing lineage", async () => {
    const option = `<option value="${ids.parentF}"`;
    let html = await (
      await request(`/app/breeding?program=${ids.program}`)
    ).text();
    expect(html).toContain(option);
    await submit(html, `lifecycle-parent-${ids.parentF}`, {
      entity: "parent_lines",
      id: ids.parentF,
      operation: "archive",
    });
    expect((await one("parent_lines", "id", ids.parentF)).deleted_at).not.toBe(
      null,
    );
    expect((await one("crosses", "id", ids.cross)).female_parent_id).toBe(
      ids.parentF,
    );
    html = await (await request(`/app/breeding?program=${ids.program}`)).text();
    expect(html).not.toContain(option);
    expect(html).not.toContain(`<strong>${ids.parentCodeF}</strong>`);
    html = await (
      await request(`/app/breeding?program=${ids.program}&archived=1`)
    ).text();
    expect(html).toContain(`<strong>${ids.parentCodeF}</strong>`);
    await submit(html, `lifecycle-parent-${ids.parentF}`, {
      entity: "parent_lines",
      id: ids.parentF,
      operation: "restore",
    });
    const restored = await one("parent_lines", "id", ids.parentF);
    expect(restored.deleted_at).toBe(null);
    expect(restored.parent_code).toBe(ids.parentCodeF);
    html = await (await request(`/app/breeding?program=${ids.program}`)).text();
    expect(html).toContain(option);
  });
});
