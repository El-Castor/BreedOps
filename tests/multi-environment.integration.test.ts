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
const emailOwner = `met-owner-${marker}@example.test`;
const programCode = `MET${marker.toUpperCase()}`;

// Covers V2-05 end-to-end over real HTTP: the design-diagnostics page for
// a genuinely eligible trial, the NOT_ESTIMABLE demonstration for an
// insufficient one (B45-B49's explicit requirement), saving a reproducible
// multi_environment analytics_run via a real form POST (spawning the real
// R engine, not a mock), and the MET export route returning the same
// dataset. Mirrors tests/trait-analytics.integration.test.ts's own
// architecture note: src/app/app/analytics/multi-environment/page.tsx is a
// plain Server Component reading searchParams, so every read-only view
// here is reachable through a real HTTP GET with a real session cookie.
describe.sequential("multi-environment analytics", () => {
  beforeAll(async () => {
    const team = await admin
      .from("organizations")
      .insert({ name: "MET integration team", slug: `met-${marker}` })
      .select("id")
      .single();
    if (team.error) throw team.error;
    ids.team = team.data.id;

    const program = await admin
      .from("programs")
      .insert({
        organization_id: ids.team,
        code: programCode,
        name: "MET integration program",
        species: "Test species",
      })
      .select("id")
      .single();
    if (program.error) throw program.error;
    ids.program = program.data.id;

    const owner = await admin.auth.admin.createUser({
      email: emailOwner,
      password,
      email_confirm: true,
    });
    if (owner.error) throw owner.error;
    ids.owner = owner.data.user.id;
    const ownerProfile = await admin
      .from("profiles")
      .insert({
        user_id: ids.owner,
        organization_id: ids.team,
        role: "team_admin",
        display_name: "MET integration owner",
      })
      .select("id")
      .single();
    if (ownerProfile.error) throw ownerProfile.error;

    const trait = await admin
      .from("phenotype_traits")
      .insert({
        organization_id: ids.team,
        code: "yield_met_it",
        name: "Rendement (test intégration)",
        data_type: "numeric",
      })
      .select("id")
      .single();
    if (trait.error) throw trait.error;
    ids.trait = trait.data.id;

    // program_active_traits (what listTrialTraits reuses) requires the
    // trait to be part of an active phenotyping module - same established
    // V2-04 mechanism, not MET-specific.
    const module_ = await admin
      .from("phenotyping_modules")
      .insert({ organization_id: ids.team, name: `Module MET ${marker}` })
      .select("id")
      .single();
    if (module_.error) throw module_.error;
    const linkModule = await admin
      .from("program_phenotyping_modules")
      .insert({ program_id: ids.program, module_id: module_.data.id });
    if (linkModule.error) throw linkModule.error;
    const linkTrait = await admin.from("phenotyping_module_traits").insert({
      module_id: module_.data.id,
      trait_id: ids.trait,
      display_order: 0,
    });
    if (linkTrait.error) throw linkTrait.error;

    const site = await admin
      .from("sites")
      .insert({
        organization_id: ids.team,
        code: `SITE-${marker}`,
        name: "Integration site",
      })
      .select("id")
      .single();
    if (site.error) throw site.error;
    ids.site = site.data.id;

    // ───────── Eligible trial: 2 environments, 6 entries, 3 reps each ─────────
    const env1 = await admin
      .from("environments")
      .insert({
        program_id: ids.program,
        site_id: ids.site,
        code: `ENV1-${marker}`,
        name: "Env 1",
      })
      .select("id")
      .single();
    if (env1.error) throw env1.error;
    ids.env1 = env1.data.id;
    const env2 = await admin
      .from("environments")
      .insert({
        program_id: ids.program,
        site_id: ids.site,
        code: `ENV2-${marker}`,
        name: "Env 2",
      })
      .select("id")
      .single();
    if (env2.error) throw env2.error;
    ids.env2 = env2.data.id;

    const trial = await admin
      .from("trials")
      .insert({
        program_id: ids.program,
        code: `TRIAL-${marker}`,
        name: "Integration trial",
      })
      .select("id")
      .single();
    if (trial.error) throw trial.error;
    ids.trial = trial.data.id;

    const linkEnvs = await admin.from("trial_environments").insert([
      { trial_id: ids.trial, environment_id: ids.env1 },
      { trial_id: ids.trial, environment_id: ids.env2 },
    ]);
    if (linkEnvs.error) throw linkEnvs.error;

    const entryCodes = ["E1", "E2", "E3", "E4", "E5", "E6"];
    const entryIds: string[] = [];
    for (const code of entryCodes) {
      const entry = await admin
        .from("trial_entries")
        .insert({
          trial_id: ids.trial,
          code,
          label: `Entry ${code}`,
          scientific_role: "other",
        })
        .select("id")
        .single();
      if (entry.error) throw entry.error;
      entryIds.push(entry.data.id);
    }

    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let nObservations = 0;
    for (const environmentId of [ids.env1, ids.env2]) {
      for (const entryId of entryIds) {
        for (let rep = 1; rep <= 3; rep++) {
          const pheno = await admin
            .from("phenotypes")
            .insert({
              program_id: ids.program,
              phenotype_code: `MET-${marker}-${environmentId.slice(0, 4)}-${entryId.slice(0, 4)}-${rep}`,
              environment_id: environmentId,
              trial_entry_id: entryId,
              block: String(rep),
            })
            .select("id")
            .single();
          if (pheno.error) throw pheno.error;
          const evalRow = await admin
            .from("phenotype_evaluations")
            .insert({
              phenotype_id: pheno.data.id,
              evaluation_date: "2026-03-01",
            })
            .select("id")
            .single();
          if (evalRow.error) throw evalRow.error;
          const tv = await admin.from("phenotype_trait_values").insert({
            phenotype_evaluation_id: evalRow.data.id,
            trait_id: ids.trait,
            numeric_value: 50 + rand() * 10,
          });
          if (tv.error) throw tv.error;
          nObservations++;
        }
      }
    }
    ids.nObservations = String(nObservations);

    // ───────── Sparse trial: 1 environment only -> NOT_ESTIMABLE ─────────
    const sparseTrial = await admin
      .from("trials")
      .insert({
        program_id: ids.program,
        code: `SPARSE-${marker}`,
        name: "Sparse trial",
      })
      .select("id")
      .single();
    if (sparseTrial.error) throw sparseTrial.error;
    ids.sparseTrial = sparseTrial.data.id;
    const linkSparseEnv = await admin
      .from("trial_environments")
      .insert({ trial_id: ids.sparseTrial, environment_id: ids.env1 });
    if (linkSparseEnv.error) throw linkSparseEnv.error;
    const sparseEntry = await admin
      .from("trial_entries")
      .insert({
        trial_id: ids.sparseTrial,
        code: "S1",
        label: "Sparse entry",
        scientific_role: "other",
      })
      .select("id")
      .single();
    if (sparseEntry.error) throw sparseEntry.error;
    const sparsePheno = await admin
      .from("phenotypes")
      .insert({
        program_id: ids.program,
        phenotype_code: `MET-SPARSE-${marker}`,
        environment_id: ids.env1,
        trial_entry_id: sparseEntry.data.id,
      })
      .select("id")
      .single();
    if (sparsePheno.error) throw sparsePheno.error;
    const sparseEval = await admin
      .from("phenotype_evaluations")
      .insert({
        phenotype_id: sparsePheno.data.id,
        evaluation_date: "2026-03-01",
      })
      .select("id")
      .single();
    if (sparseEval.error) throw sparseEval.error;
    const sparseTv = await admin.from("phenotype_trait_values").insert({
      phenotype_evaluation_id: sparseEval.data.id,
      trait_id: ids.trait,
      numeric_value: 10,
    });
    if (sparseTv.error) throw sparseTv.error;
  });

  afterAll(async () => {
    if (ids.owner) await admin.auth.admin.deleteUser(ids.owner);
    if (ids.team) hardDeleteOrganization(ids.team);
  });

  it("shows the design-diagnostics overview and heatmap for a genuinely eligible trial, over real HTTP", async () => {
    await signIn(emailOwner, password);
    const html = await (
      await request(
        `/app/analytics/multi-environment?program=${ids.program}&trial=${ids.trial}&trait=${ids.trait}`,
      )
    ).text();
    expect(html).toContain("Éligible pour une analyse Entrée × Environnement");
    expect(html).toContain("Carte de chaleur Entrée");
    expect(html).toMatch(/Observations<\/dt>\s*<dd>36<\/dd>/);
  });

  it("demonstrates NOT_ESTIMABLE for a trial with only one environment, with a precise reason - never a fabricated result", async () => {
    await signIn(emailOwner, password);
    const html = await (
      await request(
        `/app/analytics/multi-environment?program=${ids.program}&trial=${ids.sparseTrial}&trait=${ids.trait}`,
      )
    ).text();
    expect(html).toContain("NOT_ESTIMABLE");
    expect(html).toMatch(/environnements distincts sont nécessaires/);
  });

  it("saves a reproducible met_base_v1 analysis run via a real HTTP form post (spawning the real R engine), then export returns the same dataset", async () => {
    await signIn(emailOwner, password);
    const pageHtml = await (
      await request(
        `/app/analytics/multi-environment?program=${ids.program}&trial=${ids.trial}&trait=${ids.trait}`,
      )
    ).text();
    const body = new FormData();
    appendServerActionFields(body, pageHtml, "met-run-analysis");
    body.set("program_id", ids.program);
    body.set("trial_id", ids.trial);
    body.set("trait_id", ids.trait);
    body.set("model_type", "met_base_v1");
    const response = await request("/app/analytics/multi-environment", {
      method: "POST",
      body,
    });
    expect(response.status).toBe(200);

    const runs = await admin
      .from("analytics_runs")
      .select("id,status,n_observations,dataset_fingerprint,result")
      .eq("program_id", ids.program)
      .eq("trial_id", ids.trial)
      .eq("analysis_type", "multi_environment");
    if (runs.error) throw runs.error;
    expect(runs.data.length).toBe(1);
    expect(runs.data[0].status).toBe("completed");
    expect(runs.data[0].n_observations).toBe(36);
    expect(runs.data[0].result.model_type).toBe("met_base_v1");
    expect(runs.data[0].result.variance_components).toBeTruthy();

    const csv = await (
      await request(
        `/app/analytics/multi-environment/export?trial=${ids.trial}&trait=${ids.trait}&format=csv`,
      )
    ).text();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("entry_code");
    expect(lines.length).toBe(37); // header + 36 observations
  }, 60_000);
});
