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
const email = `phenotype-${marker}@example.test`;
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
function actionFor(html: string, markerName: string) {
  const form = [...html.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((value) => value.includes(`data-action="${markerName}"`));
  const action = form?.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
  if (!action) throw new Error(`Action ${markerName} not found`);
  return action;
}
async function submit(
  html: string,
  markerName: string,
  values: Record<string, string>,
  expected = 200,
) {
  const body = new FormData();
  body.set(actionFor(html, markerName), "");
  Object.entries(values).forEach(([key, value]) => body.set(key, value));
  expect(
    (
      await request(`/app/phenotypes?program=${ids.program}`, {
        method: "POST",
        headers: { origin: base },
        body,
      })
    ).status,
  ).toBe(expected);
}

describe.sequential("configured phenotype scoring", () => {
  beforeAll(async () => {
    const team = await admin
      .from("organizations")
      .insert({ name: "Synthetic phenotype test", slug: `phenotype-${marker}` })
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
    const program = await admin
      .from("programs")
      .insert({
        organization_id: ids.team,
        code: `PP-${marker}`,
        name: "Synthetic phenotype program",
      })
      .select("id")
      .single();
    if (program.error) throw program.error;
    ids.program = program.data.id;
    const parentRows = [
      { program_id: ids.program, parent_code: `PF-${marker}` },
      { program_id: ids.program, parent_code: `PM-${marker}` },
    ];
    const parents = await admin
      .from("parent_lines")
      .insert(parentRows)
      .select("id");
    if (parents.error) throw parents.error;
    const cross = await admin
      .from("crosses")
      .insert({
        program_id: ids.program,
        cross_code: `PX-${marker}`,
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
        family_code: `PFAM-${marker}`,
      })
      .select("id")
      .single();
    if (family.error) throw family.error;
    ids.family = family.data.id;
    const lot = await admin
      .from("seed_lots")
      .insert({
        program_id: ids.program,
        cross_id: cross.data.id,
        family_id: ids.family,
        seed_lot_code: `PLOT-${marker}`,
      })
      .select("id")
      .single();
    if (lot.error) throw lot.error;
    ids.lot = lot.data.id;
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
  it("creates the configured initial model in one transaction", async () => {
    const html = await (
      await request(`/app/phenotypes?program=${ids.program}`)
    ).text();
    await submit(html, "model", {
      program_id: ids.program,
      name: "Synthetic selection model",
    });
    const model = await admin
      .from("selection_models")
      .select("id,maximum_score")
      .eq("program_id", ids.program)
      .single();
    if (model.error) throw model.error;
    ids.model = model.data.id;
    expect(Number(model.data.maximum_score)).toBe(130);
    const criteria = await admin
      .from("selection_criteria")
      .select("code,coefficient")
      .eq("selection_model_id", ids.model);
    expect(criteria.data).toHaveLength(6);
    const rules = await admin
      .from("selection_decision_rules")
      .select("decision")
      .eq("selection_model_id", ids.model);
    expect(rules.data?.map((x) => x.decision)).toEqual(
      expect.arrayContaining(["elite", "advance", "reserve", "eliminate"]),
    );
  });
  it("configures a coefficient and transactionally updates model maximum", async () => {
    let html = await (
      await request(`/app/phenotypes?program=${ids.program}&model=${ids.model}`)
    ).text();
    await submit(html, "criterion-vigor", {
      criterion_id: (
        await admin
          .from("selection_criteria")
          .select("id")
          .eq("selection_model_id", ids.model)
          .eq("code", "vigor")
          .single()
      ).data!.id,
      coefficient: "2",
    });
    expect(
      Number(
        (
          await admin
            .from("selection_models")
            .select("maximum_score")
            .eq("id", ids.model)
            .single()
        ).data?.maximum_score,
      ),
    ).toBe(140);
  });
  it("creates a phenotype linked to the family and lot", async () => {
    const html = await (
      await request(`/app/phenotypes?program=${ids.program}&model=${ids.model}`)
    ).text();
    await submit(html, "phenotype", {
      program_id: ids.program,
      family_id: ids.family,
      seed_lot_id: ids.lot,
      phenotype_code: `PH-${marker}`,
      block: "A",
      replicate: "1",
      location: "Synthetic greenhouse",
    });
    const row = await admin
      .from("phenotypes")
      .select("id,family_id,seed_lot_id")
      .eq("phenotype_code", `PH-${marker}`)
      .single();
    if (row.error) throw row.error;
    ids.phenotype = row.data.id;
    expect(row.data.seed_lot_id).toBe(ids.lot);
  });
  it("persists scores and PostgreSQL calculates ranking fields", async () => {
    const html = await (
      await request(`/app/phenotypes?program=${ids.program}&model=${ids.model}`)
    ).text();
    const values: Record<string, string> = {
      phenotype_id: ids.phenotype,
      model_id: ids.model,
      evaluation_date: "2026-09-13",
    };
    for (const code of [
      "vigor",
      "architecture",
      "yield",
      "sanitary_quality",
      "analytical_quality",
      "stability",
    ])
      values[`score:${code}`] = "9";
    await submit(html, "evaluation", values);
    const evaluation = await admin
      .from("phenotype_evaluations")
      .select("id,weighted_score,normalized_score,automatic_decision")
      .eq("phenotype_id", ids.phenotype)
      .single();
    if (evaluation.error) throw evaluation.error;
    expect(Number(evaluation.data.weighted_score)).toBe(126);
    expect(Number(evaluation.data.normalized_score)).toBe(90);
    expect(evaluation.data.automatic_decision).toBe("elite");
    const scores = await admin
      .from("phenotype_scores")
      .select("weighted_value")
      .eq("phenotype_evaluation_id", evaluation.data.id);
    expect(scores.data).toHaveLength(6);
    const rendered = await (
      await request(`/app/phenotypes?program=${ids.program}&model=${ids.model}`)
    ).text();
    expect(rendered).toContain("elite");
    expect(rendered).toContain("90");
  });
  it.each([
    ["8", 112, "advance"],
    ["7", 98, "reserve"],
    ["6", 84, "eliminate"],
  ])(
    "applies the configured %s-point decision threshold",
    async (score, weighted, decision) => {
      const html = await (
        await request(
          `/app/phenotypes?program=${ids.program}&model=${ids.model}`,
        )
      ).text();
      const values: Record<string, string> = {
        phenotype_id: ids.phenotype,
        model_id: ids.model,
        evaluation_date: "2026-09-13",
      };
      for (const code of [
        "vigor",
        "architecture",
        "yield",
        "sanitary_quality",
        "analytical_quality",
        "stability",
      ])
        values[`score:${code}`] = score;
      await submit(html, "evaluation", values);
      const result = await admin
        .from("phenotype_evaluations")
        .select("weighted_score,automatic_decision")
        .eq("phenotype_id", ids.phenotype)
        .eq("weighted_score", weighted)
        .single();
      if (result.error) throw result.error;
      expect(Number(result.data.weighted_score)).toBe(weighted);
      expect(result.data.automatic_decision).toBe(decision);
    },
  );
  it("rejects incomplete score submissions transactionally", async () => {
    const before = (
      await admin
        .from("phenotype_evaluations")
        .select("id", { count: "exact", head: true })
        .eq("phenotype_id", ids.phenotype)
    ).count;
    const html = await (
      await request(`/app/phenotypes?program=${ids.program}&model=${ids.model}`)
    ).text();
    await submit(
      html,
      "evaluation",
      {
        phenotype_id: ids.phenotype,
        model_id: ids.model,
        evaluation_date: "2026-09-13",
        "score:vigor": "5",
      },
      500,
    );
    const after = (
      await admin
        .from("phenotype_evaluations")
        .select("id", { count: "exact", head: true })
        .eq("phenotype_id", ids.phenotype)
    ).count;
    expect(after).toBe(before);
  });
});
