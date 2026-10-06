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
        parent_code: `${suffix}-${marker}`,
        line_name: `Synthetic ${suffix}`,
        generation: "4",
      });
      ids[`parent${suffix}`] = (
        await one("parent_lines", "parent_code", `${suffix}-${marker}`)
      ).id;
    }
  });
  it("creates and updates a cross with database-derived yield inputs", async () => {
    let html = await (
      await request(`/app/breeding?program=${ids.program}`)
    ).text();
    await submit(html, "cross", {
      program_id: ids.program,
      cross_code: `X-${marker}`,
      female_parent_id: ids.parentF,
      male_parent_id: ids.parentM,
      pollination_date: "2026-09-01",
      pollinated_units: "10",
      established_units: "8",
      total_seeds: "480",
    });
    const row = await one("crosses", "cross_code", `X-${marker}`);
    ids.cross = row.id;
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
      family_code: `FAM-${marker}`,
      generation: "1",
    });
    const family = await one("families", "family_code", `FAM-${marker}`);
    ids.family = family.id;
    expect(family.cross_id).toBe(ids.cross);
    html = await (await request(`/app/breeding?program=${ids.program}`)).text();
    await submit(html, "seed-lot", {
      program_id: ids.program,
      cross_id: ids.cross,
      family_id: ids.family,
      seed_lot_code: `LOT-${marker}`,
      harvest_date: "2026-09-10",
      total_quantity: "480",
      storage_location: "Synthetic shelf",
    });
    const lot = await one("seed_lots", "seed_lot_code", `LOT-${marker}`);
    ids.lot = lot.id;
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
    expect(rendered).toContain(`LOT-${marker}`);
  });
  it("filters crosses by code", async () => {
    const html = await (
      await request(`/app/breeding?program=${ids.program}&q=X-${marker}`)
    ).text();
    expect(html).toContain(`X-${marker}`);
    const empty = await (
      await request(`/app/breeding?program=${ids.program}&q=NO-MATCH`)
    ).text();
    expect(empty).toContain("Aucun croisement");
  });
});
