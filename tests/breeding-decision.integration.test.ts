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

async function submitAction(
  pageUrl: string,
  actionName: string,
  fields: Record<string, string>,
) {
  const pageHtml = await (await request(pageUrl)).text();
  const body = new FormData();
  appendServerActionFields(body, pageHtml, actionName);
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const postUrl = pageUrl.split("?")[0];
  const response = await request(postUrl, { method: "POST", body });
  expect(response.status).toBe(200);
  return response;
}

async function insertPhenotypeValue(params: {
  programId: string;
  phenotypeCode: string;
  environmentId: string;
  trialEntryId: string;
  evaluationDate: string;
  block?: string;
  values: { traitId: string; value: number }[];
}) {
  const pheno = await admin
    .from("phenotypes")
    .insert({
      program_id: params.programId,
      phenotype_code: params.phenotypeCode,
      environment_id: params.environmentId,
      trial_entry_id: params.trialEntryId,
      block: params.block ?? null,
    })
    .select("id")
    .single();
  if (pheno.error) throw pheno.error;
  const evalRow = await admin
    .from("phenotype_evaluations")
    .insert({
      phenotype_id: pheno.data.id,
      evaluation_date: params.evaluationDate,
    })
    .select("id")
    .single();
  if (evalRow.error) throw evalRow.error;
  for (const { traitId, value } of params.values) {
    const tv = await admin.from("phenotype_trait_values").insert({
      phenotype_evaluation_id: evalRow.data.id,
      trait_id: traitId,
      numeric_value: value,
    });
    if (tv.error) throw tv.error;
  }
}

const password = `${randomUUID()}Aa9!`;
const emailOwner = `bd-owner-${marker}@example.test`;
const programCode = `BD${marker.toUpperCase()}`;

// Covers V2-06 end-to-end over real HTTP: a genuinely eligible MGIDI
// scenario (real metan::mgidi() round trip), the NOT_ESTIMABLE
// demonstration when candidates <= traits (task review §13's eligibility
// rule, never fabricated), a genuinely eligible MTSI scenario chained onto
// two real V2-05 met_waasb_v1 runs (the first real end-to-end proof of the
// TS -> R round trip for both implemented methods through the actual
// running app, not just direct R script invocation / pure-TS unit tests),
// and the export route returning the same persisted run. Mirrors
// tests/multi-environment.integration.test.ts's architecture.
//
// What this file deliberately does NOT cover (left to the pgTap suite in
// tests/breeding-decision.sql and the pure-TS unit tests in
// tests/breeding-decision-*.test.ts): dataset.ts's own candidate-alignment
// validation branches (different candidate populations between source
// runs, a stale/wrong-trial source run, a different measurement occasion,
// a different scientific_role, no cross-population mixing) are exercised
// here only through the one path a breeder can actually reach from the UI
// (a source_run_id that is valid for a DIFFERENT trait or in progress is
// never offered by listCompletedMetRunsForTrial in the first place); a
// forged source_run_id for the wrong trial is instead covered as a direct
// resolveBreedingTraitValues() scenario, since dataset.ts carries
// "server-only" and cannot be imported from vitest at all (see
// src/lib/breeding-decision/dataset.ts's own header comment) - this file
// is the one place it can be exercised, by going through the real HTTP
// server action instead of importing the module.
describe.sequential("breeding-decision analytics", () => {
  beforeAll(async () => {
    const team = await admin
      .from("organizations")
      .insert({ name: "BreedingDecision IT team", slug: `bd-${marker}` })
      .select("id")
      .single();
    if (team.error) throw team.error;
    ids.team = team.data.id;

    const program = await admin
      .from("programs")
      .insert({
        organization_id: ids.team,
        code: programCode,
        name: "Breeding decision integration program",
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
        display_name: "Breeding decision IT owner",
      })
      .select("id")
      .single();
    if (ownerProfile.error) throw ownerProfile.error;

    const module_ = await admin
      .from("phenotyping_modules")
      .insert({ organization_id: ids.team, name: `Module BD ${marker}` })
      .select("id")
      .single();
    if (module_.error) throw module_.error;
    const linkModule = await admin
      .from("program_phenotyping_modules")
      .insert({ program_id: ids.program, module_id: module_.data.id });
    if (linkModule.error) throw linkModule.error;

    const traitYield = await admin
      .from("phenotype_traits")
      .insert({
        organization_id: ids.team,
        code: `yld${marker}`,
        name: "Rendement (BD IT)",
        data_type: "numeric",
      })
      .select("id")
      .single();
    if (traitYield.error) throw traitYield.error;
    ids.traitYield = traitYield.data.id;

    const traitHeight = await admin
      .from("phenotype_traits")
      .insert({
        organization_id: ids.team,
        code: `hgt${marker}`,
        name: "Hauteur (BD IT)",
        data_type: "numeric",
      })
      .select("id")
      .single();
    if (traitHeight.error) throw traitHeight.error;
    ids.traitHeight = traitHeight.data.id;

    for (const [traitId, order] of [
      [ids.traitYield, 0],
      [ids.traitHeight, 1],
    ] as const) {
      const linkTrait = await admin.from("phenotyping_module_traits").insert({
        module_id: module_.data.id,
        trait_id: traitId,
        display_order: order,
      });
      if (linkTrait.error) throw linkTrait.error;
    }

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

    // ───────── Trial A: 6 genotype-role entries, 1 environment -> MGIDI
    // eligible (6 candidates > 2 traits). ─────────
    const envA = await admin
      .from("environments")
      .insert({
        program_id: ids.program,
        site_id: ids.site,
        code: `ENVA-${marker}`,
        name: "Env A",
      })
      .select("id")
      .single();
    if (envA.error) throw envA.error;
    ids.envA = envA.data.id;

    const trialA = await admin
      .from("trials")
      .insert({
        program_id: ids.program,
        code: `TRIALA-${marker}`,
        name: "MGIDI eligible trial",
      })
      .select("id")
      .single();
    if (trialA.error) throw trialA.error;
    ids.trialA = trialA.data.id;
    const linkEnvA = await admin
      .from("trial_environments")
      .insert({ trial_id: ids.trialA, environment_id: ids.envA });
    if (linkEnvA.error) throw linkEnvA.error;

    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    const entryCodesA = ["A1", "A2", "A3", "A4", "A5", "A6"];
    for (const code of entryCodesA) {
      const entry = await admin
        .from("trial_entries")
        .insert({
          trial_id: ids.trialA,
          code,
          label: `Entry ${code}`,
          scientific_role: "genotype",
        })
        .select("id")
        .single();
      if (entry.error) throw entry.error;
      await insertPhenotypeValue({
        programId: ids.program,
        phenotypeCode: `BD-A-${marker}-${code}`,
        environmentId: ids.envA,
        trialEntryId: entry.data.id,
        evaluationDate: "2026-04-01",
        values: [
          { traitId: ids.traitYield, value: 50 + rand() * 10 },
          { traitId: ids.traitHeight, value: 100 + rand() * 20 },
        ],
      });
    }

    // ───────── Trial B: 2 entries, same 2 traits -> MGIDI NOT_ESTIMABLE
    // (candidates=2 is not strictly more than traits=2). ─────────
    const envB = await admin
      .from("environments")
      .insert({
        program_id: ids.program,
        site_id: ids.site,
        code: `ENVB-${marker}`,
        name: "Env B",
      })
      .select("id")
      .single();
    if (envB.error) throw envB.error;
    ids.envB = envB.data.id;
    const trialB = await admin
      .from("trials")
      .insert({
        program_id: ids.program,
        code: `TRIALB-${marker}`,
        name: "MGIDI sparse trial",
      })
      .select("id")
      .single();
    if (trialB.error) throw trialB.error;
    ids.trialB = trialB.data.id;
    const linkEnvB = await admin
      .from("trial_environments")
      .insert({ trial_id: ids.trialB, environment_id: ids.envB });
    if (linkEnvB.error) throw linkEnvB.error;
    for (const code of ["B1", "B2"]) {
      const entry = await admin
        .from("trial_entries")
        .insert({
          trial_id: ids.trialB,
          code,
          label: `Entry ${code}`,
          scientific_role: "genotype",
        })
        .select("id")
        .single();
      if (entry.error) throw entry.error;
      await insertPhenotypeValue({
        programId: ids.program,
        phenotypeCode: `BD-B-${marker}-${code}`,
        environmentId: ids.envB,
        trialEntryId: entry.data.id,
        evaluationDate: "2026-04-01",
        values: [
          { traitId: ids.traitYield, value: 50 + rand() * 10 },
          { traitId: ids.traitHeight, value: 100 + rand() * 20 },
        ],
      });
    }

    // ───────── Trial C: 6 genotype-role entries, 3 environments, 3 reps
    // per cell -> met_waasb_v1 eligible (6 entries > 2, 3 environments >
    // 2), so MTSI's own source runs are genuinely estimable, never
    // fabricated. ─────────
    const trialC = await admin
      .from("trials")
      .insert({
        program_id: ids.program,
        code: `TRIALC-${marker}`,
        name: "MTSI MET trial",
      })
      .select("id")
      .single();
    if (trialC.error) throw trialC.error;
    ids.trialC = trialC.data.id;

    const envCIds: string[] = [];
    for (const suffix of ["C1", "C2", "C3"]) {
      const env = await admin
        .from("environments")
        .insert({
          program_id: ids.program,
          site_id: ids.site,
          code: `ENV${suffix}-${marker}`,
          name: `Env ${suffix}`,
        })
        .select("id")
        .single();
      if (env.error) throw env.error;
      envCIds.push(env.data.id);
      const link = await admin
        .from("trial_environments")
        .insert({ trial_id: ids.trialC, environment_id: env.data.id });
      if (link.error) throw link.error;
    }

    const entryCIds: string[] = [];
    for (const code of ["C1", "C2", "C3", "C4", "C5", "C6"]) {
      const entry = await admin
        .from("trial_entries")
        .insert({
          trial_id: ids.trialC,
          code,
          label: `Entry ${code}`,
          scientific_role: "genotype",
        })
        .select("id")
        .single();
      if (entry.error) throw entry.error;
      entryCIds.push(entry.data.id);
    }

    // A genuine (deterministic) entry x environment interaction term is
    // required, not just additive noise: with a purely additive
    // entry+environment model, metan::waasb()'s AMMI/WAASB stability
    // component has nothing to estimate and can return WAASB=NA for some
    // entries (confirmed empirically - see analytics-r/tests/ for the
    // production model's own documented guards). The crossover pattern
    // below (entryIndex * envIndex, alternating sign) guarantees real
    // rank-changing G x E structure for both traits.
    for (const [envIndex, environmentId] of envCIds.entries()) {
      for (const [entryIndex, entryId] of entryCIds.entries()) {
        const interaction =
          (entryIndex - 2.5) * (envIndex - 1) * (entryIndex % 2 === 0 ? 1 : -1);
        for (let rep = 1; rep <= 3; rep++) {
          await insertPhenotypeValue({
            programId: ids.program,
            phenotypeCode: `BD-C-${marker}-${environmentId.slice(0, 4)}-${entryId.slice(0, 4)}-${rep}`,
            environmentId,
            trialEntryId: entryId,
            evaluationDate: "2026-04-01",
            block: String(rep),
            values: [
              {
                traitId: ids.traitYield,
                value: 50 + entryIndex * 2 + interaction * 4 + rand() * 3,
              },
              {
                traitId: ids.traitHeight,
                value: 100 + entryIndex * 3 + interaction * 6 + rand() * 5,
              },
            ],
          });
        }
      }
    }
  });

  afterAll(async () => {
    if (ids.owner) await admin.auth.admin.deleteUser(ids.owner);
    if (ids.team) hardDeleteOrganization(ids.team);
  });

  it("runs MGIDI end to end over real HTTP (real metan::mgidi() round trip) and exports the saved run", async () => {
    await signIn(emailOwner, password);
    const pageUrl = `/app/analytics/breeding-decision?program=${ids.program}&trial=${ids.trialA}`;
    await submitAction(pageUrl, "create-breeding-decision-scenario", {
      program_id: ids.program,
      trial_id: ids.trialA,
      name: `Scenario A ${marker}`,
      description: "",
      candidate_eligibility: "all",
      selection_proportion: "30",
    });

    const scenario = await admin
      .from("breeding_decision_scenarios")
      .select("id")
      .eq("trial_id", ids.trialA)
      .eq("name", `Scenario A ${marker}`)
      .single();
    if (scenario.error) throw scenario.error;
    ids.scenarioA = scenario.data.id;

    const scenarioUrl = `${pageUrl}&scenario=${ids.scenarioA}`;
    await submitAction(scenarioUrl, "add-breeding-decision-scenario-trait", {
      scenario_id: ids.scenarioA,
      trait_id: ids.traitYield,
      direction: "higher_is_better",
      target_value: "",
      weight: "",
      economic_weight: "",
      source_type: "RAW_PHENOTYPIC",
      source_run_id: "",
      evaluation_date: "",
    });
    await submitAction(scenarioUrl, "add-breeding-decision-scenario-trait", {
      scenario_id: ids.scenarioA,
      trait_id: ids.traitHeight,
      direction: "higher_is_better",
      target_value: "",
      weight: "",
      economic_weight: "",
      source_type: "RAW_PHENOTYPIC",
      source_run_id: "",
      evaluation_date: "",
    });

    await submitAction(scenarioUrl, "create-breeding-decision-run", {
      program_id: ids.program,
      scenario_id: ids.scenarioA,
      method: "selection_mgidi_v1",
    });

    const runs = await admin
      .from("analytics_runs")
      .select("id,status,n_observations,result")
      .eq("scenario_id", ids.scenarioA)
      .eq("analysis_type", "breeding_decision");
    if (runs.error) throw runs.error;
    expect(runs.data.length).toBe(1);
    const run = runs.data[0];
    expect(run.status).toBe("completed");
    expect(run.result.method).toBe("selection_mgidi_v1");
    expect(Array.isArray(run.result.candidates)).toBe(true);
    expect(run.result.candidates.length).toBe(6);
    expect(
      run.result.candidates.some((c: { selected: boolean }) => c.selected),
    ).toBe(true);
    expect(Array.isArray(run.result.selection_differentials)).toBe(true);
    expect(run.result.selection_differentials.length).toBe(2);
    expect(run.result.genetic_validity_panel.additiveBreedingValue.status).toBe(
      "NOT_ESTIMABLE",
    );

    const csv = await (
      await request(
        `/app/analytics/breeding-decision/export?program=${ids.program}&trial=${ids.trialA}&format=csv`,
      )
    ).text();
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("candidate_id,rank,index,selected");
    expect(lines.length).toBe(7); // header + 6 candidates

    const json = await (
      await request(
        `/app/analytics/breeding-decision/export?program=${ids.program}&trial=${ids.trialA}&format=json`,
      )
    ).json();
    expect(json.scenarioId).toBe(ids.scenarioA);
    expect(json.result.method).toBe("selection_mgidi_v1");

    // Re-running the same scenario produces a second completed run -
    // comparing the two (task review §29/§30: rank correlation/overlap
    // between two recorded runs, never an automated parameter sweep)
    // should show perfect agreement, since the underlying data and
    // configuration are identical.
    await submitAction(scenarioUrl, "create-breeding-decision-run", {
      program_id: ids.program,
      scenario_id: ids.scenarioA,
      method: "selection_mgidi_v1",
    });
    const rerun = await admin
      .from("analytics_runs")
      .select("id,created_at")
      .eq("scenario_id", ids.scenarioA)
      .eq("analysis_type", "breeding_decision")
      .order("created_at", { ascending: true });
    if (rerun.error) throw rerun.error;
    expect(rerun.data.length).toBe(2);
    const [firstRunId, secondRunId] = rerun.data.map((r) => r.id as string);

    const comparisonHtml = await (
      await request(
        `${scenarioUrl}&compareA=${firstRunId}&compareB=${secondRunId}`,
      )
    ).text();
    expect(comparisonHtml).toContain("Corrélation de rang (Spearman)");
    expect(comparisonHtml).toMatch(
      /Chevauchement des ensembles sélectionnés[\s\S]*?100 %/,
    );
  }, 60_000);

  it("saves NOT_ESTIMABLE (never a fabricated ranking) when candidates do not strictly exceed the trait count", async () => {
    await signIn(emailOwner, password);
    const pageUrl = `/app/analytics/breeding-decision?program=${ids.program}&trial=${ids.trialB}`;
    await submitAction(pageUrl, "create-breeding-decision-scenario", {
      program_id: ids.program,
      trial_id: ids.trialB,
      name: `Scenario B ${marker}`,
      description: "",
      candidate_eligibility: "all",
      selection_proportion: "50",
    });
    const scenario = await admin
      .from("breeding_decision_scenarios")
      .select("id")
      .eq("trial_id", ids.trialB)
      .eq("name", `Scenario B ${marker}`)
      .single();
    if (scenario.error) throw scenario.error;
    ids.scenarioB = scenario.data.id;

    const scenarioUrl = `${pageUrl}&scenario=${ids.scenarioB}`;
    await submitAction(scenarioUrl, "add-breeding-decision-scenario-trait", {
      scenario_id: ids.scenarioB,
      trait_id: ids.traitYield,
      direction: "higher_is_better",
      target_value: "",
      weight: "",
      economic_weight: "",
      source_type: "RAW_PHENOTYPIC",
      source_run_id: "",
      evaluation_date: "",
    });
    await submitAction(scenarioUrl, "add-breeding-decision-scenario-trait", {
      scenario_id: ids.scenarioB,
      trait_id: ids.traitHeight,
      direction: "higher_is_better",
      target_value: "",
      weight: "",
      economic_weight: "",
      source_type: "RAW_PHENOTYPIC",
      source_run_id: "",
      evaluation_date: "",
    });
    await submitAction(scenarioUrl, "create-breeding-decision-run", {
      program_id: ids.program,
      scenario_id: ids.scenarioB,
      method: "selection_mgidi_v1",
    });

    const runs = await admin
      .from("analytics_runs")
      .select("id,status,result")
      .eq("scenario_id", ids.scenarioB)
      .eq("analysis_type", "breeding_decision");
    if (runs.error) throw runs.error;
    expect(runs.data.length).toBe(1);
    expect(runs.data[0].status).toBe("not_estimable");
    expect(runs.data[0].result.candidates).toBeUndefined();
    expect(runs.data[0].result.eligibility.eligible).toBe(false);
    expect(runs.data[0].result.eligibility.reasons.length).toBeGreaterThan(0);

    const html = await (
      await request(
        `/app/analytics/breeding-decision?program=${ids.program}&trial=${ids.trialB}&scenario=${ids.scenarioB}`,
      )
    ).text();
    expect(html).toContain("NOT_ESTIMABLE");
  }, 60_000);

  it("runs MTSI end to end over real HTTP, chained onto two genuinely estimable met_waasb_v1 runs (real TS -> R round trip for both implemented methods)", async () => {
    await signIn(emailOwner, password);
    const metPageUrl = `/app/analytics/multi-environment?program=${ids.program}&trial=${ids.trialC}&trait=${ids.traitYield}`;
    const metPageHtml = await (await request(metPageUrl)).text();
    const yieldBody = new FormData();
    appendServerActionFields(yieldBody, metPageHtml, "met-run-analysis");
    yieldBody.set("program_id", ids.program);
    yieldBody.set("trial_id", ids.trialC);
    yieldBody.set("trait_id", ids.traitYield);
    yieldBody.set("model_type", "met_waasb_v1");
    yieldBody.set("performance_weight", "0.5");
    const yieldResponse = await request("/app/analytics/multi-environment", {
      method: "POST",
      body: yieldBody,
    });
    expect(yieldResponse.status).toBe(200);

    const heightPageUrl = `/app/analytics/multi-environment?program=${ids.program}&trial=${ids.trialC}&trait=${ids.traitHeight}`;
    const heightPageHtml = await (await request(heightPageUrl)).text();
    const heightBody = new FormData();
    appendServerActionFields(heightBody, heightPageHtml, "met-run-analysis");
    heightBody.set("program_id", ids.program);
    heightBody.set("trial_id", ids.trialC);
    heightBody.set("trait_id", ids.traitHeight);
    heightBody.set("model_type", "met_waasb_v1");
    heightBody.set("performance_weight", "0.5");
    const heightResponse = await request("/app/analytics/multi-environment", {
      method: "POST",
      body: heightBody,
    });
    expect(heightResponse.status).toBe(200);

    const waasbRuns = await admin
      .from("analytics_runs")
      .select("id,trait_id,status,result")
      .eq("trial_id", ids.trialC)
      .eq("analysis_type", "multi_environment");
    if (waasbRuns.error) throw waasbRuns.error;
    const yieldRun = waasbRuns.data.find(
      (r: { trait_id: string }) => r.trait_id === ids.traitYield,
    );
    const heightRun = waasbRuns.data.find(
      (r: { trait_id: string }) => r.trait_id === ids.traitHeight,
    );
    expect(yieldRun?.status).toBe("completed");
    expect(yieldRun?.result.model_type).toBe("met_waasb_v1");
    expect(heightRun?.status).toBe("completed");
    ids.waasbYieldRun = yieldRun!.id;
    ids.waasbHeightRun = heightRun!.id;

    const pageUrl = `/app/analytics/breeding-decision?program=${ids.program}&trial=${ids.trialC}`;
    await submitAction(pageUrl, "create-breeding-decision-scenario", {
      program_id: ids.program,
      trial_id: ids.trialC,
      name: `Scenario C ${marker}`,
      description: "",
      candidate_eligibility: "all",
      selection_proportion: "40",
    });
    const scenario = await admin
      .from("breeding_decision_scenarios")
      .select("id")
      .eq("trial_id", ids.trialC)
      .eq("name", `Scenario C ${marker}`)
      .single();
    if (scenario.error) throw scenario.error;
    ids.scenarioC = scenario.data.id;

    const scenarioUrl = `${pageUrl}&scenario=${ids.scenarioC}`;
    await submitAction(scenarioUrl, "add-breeding-decision-scenario-trait", {
      scenario_id: ids.scenarioC,
      trait_id: ids.traitYield,
      direction: "higher_is_better",
      target_value: "",
      weight: "",
      economic_weight: "",
      source_type: "WAASBY_STABILITY_PERFORMANCE",
      source_run_id: ids.waasbYieldRun,
      evaluation_date: "",
    });
    await submitAction(scenarioUrl, "add-breeding-decision-scenario-trait", {
      scenario_id: ids.scenarioC,
      trait_id: ids.traitHeight,
      direction: "higher_is_better",
      target_value: "",
      weight: "",
      economic_weight: "",
      source_type: "WAASBY_STABILITY_PERFORMANCE",
      source_run_id: ids.waasbHeightRun,
      evaluation_date: "",
    });

    await submitAction(scenarioUrl, "create-breeding-decision-run", {
      program_id: ids.program,
      scenario_id: ids.scenarioC,
      method: "selection_mtsi_v1",
    });

    const runs = await admin
      .from("analytics_runs")
      .select("id,status,n_observations,result")
      .eq("scenario_id", ids.scenarioC)
      .eq("analysis_type", "breeding_decision");
    if (runs.error) throw runs.error;
    expect(runs.data.length).toBe(1);
    const run = runs.data[0];
    expect(run.status).toBe("completed");
    expect(run.result.method).toBe("selection_mtsi_v1");
    expect(run.result.evidence_level).toBe("ADJUSTED_ENTRY");
    expect(Array.isArray(run.result.candidates)).toBe(true);
    expect(run.result.candidates.length).toBe(6);
    expect(
      run.result.candidates.some((c: { selected: boolean }) => c.selected),
    ).toBe(true);
    // Hardening #5: MTSI now also persists a per-trait selection
    // differential, computed from the candidate-level mean performance
    // in its own raw rows - never left absent the way it was before
    // this hardening pass.
    expect(Array.isArray(run.result.selection_differentials)).toBe(true);
    expect(run.result.selection_differentials.length).toBe(2);
  }, 180_000);

  it("rejects WAASBY_STABILITY_PERFORMANCE as an MGIDI source (hardening #7) - valid for MTSI only", async () => {
    await signIn(emailOwner, password);
    const pageUrl = `/app/analytics/breeding-decision?program=${ids.program}&trial=${ids.trialC}`;
    const scenarioUrl = `${pageUrl}&scenario=${ids.scenarioC}`;
    await submitAction(scenarioUrl, "create-breeding-decision-run", {
      program_id: ids.program,
      scenario_id: ids.scenarioC,
      method: "selection_mgidi_v1",
    });
    const runs = await admin
      .from("analytics_runs")
      .select("id,status,result,created_at")
      .eq("scenario_id", ids.scenarioC)
      .eq("analysis_type", "breeding_decision")
      .order("created_at", { ascending: false })
      .limit(1);
    if (runs.error) throw runs.error;
    expect(runs.data[0].status).toBe("not_estimable");
    expect(runs.data[0].result.eligibility.reasons.join(" ")).toContain(
      "WAASBY_STABILITY_PERFORMANCE",
    );
  }, 60_000);

  it("rejects a scenario trait's evaluation_date that does not match its WAASB source run's own measurement occasion (hardening #2)", async () => {
    await signIn(emailOwner, password);
    const pageUrl = `/app/analytics/breeding-decision?program=${ids.program}&trial=${ids.trialC}`;
    await submitAction(pageUrl, "create-breeding-decision-scenario", {
      program_id: ids.program,
      trial_id: ids.trialC,
      name: `Scenario C occasion ${marker}`,
      description: "",
      candidate_eligibility: "all",
      selection_proportion: "40",
    });
    const scenario = await admin
      .from("breeding_decision_scenarios")
      .select("id")
      .eq("trial_id", ids.trialC)
      .eq("name", `Scenario C occasion ${marker}`)
      .single();
    if (scenario.error) throw scenario.error;
    const scenarioId = scenario.data.id as string;
    const scenarioUrl = `${pageUrl}&scenario=${scenarioId}`;

    // The WAASB source runs were computed with no evaluation_date filter
    // (specification.evaluationDate = null). Pinning a non-null date on
    // the scenario trait itself must be rejected: MTSI would otherwise
    // refit raw observations for a DIFFERENT occasion than the one the
    // WAASB source run's own eligibility was proven against.
    await submitAction(scenarioUrl, "add-breeding-decision-scenario-trait", {
      scenario_id: scenarioId,
      trait_id: ids.traitYield,
      direction: "higher_is_better",
      target_value: "",
      weight: "",
      economic_weight: "",
      source_type: "WAASBY_STABILITY_PERFORMANCE",
      source_run_id: ids.waasbYieldRun,
      evaluation_date: "2026-04-01",
    });
    await submitAction(scenarioUrl, "add-breeding-decision-scenario-trait", {
      scenario_id: scenarioId,
      trait_id: ids.traitHeight,
      direction: "higher_is_better",
      target_value: "",
      weight: "",
      economic_weight: "",
      source_type: "WAASBY_STABILITY_PERFORMANCE",
      source_run_id: ids.waasbHeightRun,
      evaluation_date: "2026-04-01",
    });
    await submitAction(scenarioUrl, "create-breeding-decision-run", {
      program_id: ids.program,
      scenario_id: scenarioId,
      method: "selection_mtsi_v1",
    });

    const runs = await admin
      .from("analytics_runs")
      .select("id,status,result")
      .eq("scenario_id", scenarioId)
      .eq("analysis_type", "breeding_decision");
    if (runs.error) throw runs.error;
    expect(runs.data.length).toBe(1);
    expect(runs.data[0].status).toBe("not_estimable");
    expect(runs.data[0].result.eligibility.reasons.join(" ")).toMatch(
      /occasion de mesure/,
    );
  }, 60_000);

  it("excludes an operationally-eliminated candidate from MTSI's input and output, with exclusion provenance (hardening #4)", async () => {
    await signIn(emailOwner, password);
    // Mark trialC's entry C1 operationally eliminated under the EXISTING
    // scoring workflow (phenotype_evaluations.is_eliminated on its most
    // recent evaluation) - breeding_candidate_pool() aggregates this via
    // bool_or across every phenotype of the entry.
    const c1Entry = await admin
      .from("trial_entries")
      .select("id")
      .eq("trial_id", ids.trialC)
      .eq("code", "C1")
      .single();
    if (c1Entry.error) throw c1Entry.error;
    const c1Phenotype = await admin
      .from("phenotypes")
      .select("id")
      .eq("trial_entry_id", c1Entry.data.id)
      .limit(1)
      .single();
    if (c1Phenotype.error) throw c1Phenotype.error;
    const update = await admin
      .from("phenotype_evaluations")
      .update({ is_eliminated: true })
      .eq("phenotype_id", c1Phenotype.data.id);
    if (update.error) throw update.error;

    const pageUrl = `/app/analytics/breeding-decision?program=${ids.program}&trial=${ids.trialC}`;
    await submitAction(pageUrl, "create-breeding-decision-scenario", {
      program_id: ids.program,
      trial_id: ids.trialC,
      name: `Scenario C exclude ${marker}`,
      description: "",
      candidate_eligibility: "exclude_operationally_eliminated",
      selection_proportion: "40",
    });
    const scenario = await admin
      .from("breeding_decision_scenarios")
      .select("id")
      .eq("trial_id", ids.trialC)
      .eq("name", `Scenario C exclude ${marker}`)
      .single();
    if (scenario.error) throw scenario.error;
    const scenarioId = scenario.data.id as string;
    const scenarioUrl = `${pageUrl}&scenario=${scenarioId}`;

    await submitAction(scenarioUrl, "add-breeding-decision-scenario-trait", {
      scenario_id: scenarioId,
      trait_id: ids.traitYield,
      direction: "higher_is_better",
      target_value: "",
      weight: "",
      economic_weight: "",
      source_type: "WAASBY_STABILITY_PERFORMANCE",
      source_run_id: ids.waasbYieldRun,
      evaluation_date: "",
    });
    await submitAction(scenarioUrl, "add-breeding-decision-scenario-trait", {
      scenario_id: scenarioId,
      trait_id: ids.traitHeight,
      direction: "higher_is_better",
      target_value: "",
      weight: "",
      economic_weight: "",
      source_type: "WAASBY_STABILITY_PERFORMANCE",
      source_run_id: ids.waasbHeightRun,
      evaluation_date: "",
    });
    await submitAction(scenarioUrl, "create-breeding-decision-run", {
      program_id: ids.program,
      scenario_id: scenarioId,
      method: "selection_mtsi_v1",
    });

    const runs = await admin
      .from("analytics_runs")
      .select("id,status,result")
      .eq("scenario_id", scenarioId)
      .eq("analysis_type", "breeding_decision");
    if (runs.error) throw runs.error;
    expect(runs.data.length).toBe(1);
    const run = runs.data[0];
    expect(run.status).toBe("completed");
    // 5 eligible candidates (6 minus the 1 excluded), never 6.
    expect(run.result.candidates.length).toBe(5);
    expect(
      run.result.candidates.some(
        (c: { candidate_id: string }) => c.candidate_id === c1Entry.data.id,
      ),
    ).toBe(false);
    expect(Array.isArray(run.result.excluded_candidates)).toBe(true);
    expect(
      run.result.excluded_candidates.some(
        (c: { candidate_id: string }) => c.candidate_id === c1Entry.data.id,
      ),
    ).toBe(true);
  }, 60_000);

  it("reports a saved run as ACTUELLE (CURRENT) until the scenario's configuration or its underlying raw observations change, then PÉRIMÉE (STALE) (hardening #3)", async () => {
    await signIn(emailOwner, password);
    const scenarioUrl = `/app/analytics/breeding-decision?program=${ids.program}&trial=${ids.trialA}&scenario=${ids.scenarioA}`;

    const freshHtml = await (await request(scenarioUrl)).text();
    expect(freshHtml).toContain("ACTUELLE");
    expect(freshHtml).not.toContain("PÉRIMÉE");

    // Scenario configuration drift: change the selection proportion
    // directly (any external change, not just through this UI) without
    // re-running the analysis.
    const proportionUpdate = await admin
      .from("breeding_decision_scenarios")
      .update({ selection_proportion: 55 })
      .eq("id", ids.scenarioA);
    if (proportionUpdate.error) throw proportionUpdate.error;

    const afterProportionChangeHtml = await (await request(scenarioUrl)).text();
    expect(afterProportionChangeHtml).toContain("PÉRIMÉE");

    // Restore the scenario's configuration, then prove the OTHER
    // staleness trigger independently: the underlying raw observation
    // itself changing, with the scenario configuration back to exactly
    // what the run was computed from.
    const restoreProportion = await admin
      .from("breeding_decision_scenarios")
      .update({ selection_proportion: 30 })
      .eq("id", ids.scenarioA);
    if (restoreProportion.error) throw restoreProportion.error;
    const restoredHtml = await (await request(scenarioUrl)).text();
    expect(restoredHtml).toContain("ACTUELLE");

    const yieldValue = await admin
      .from("phenotype_trait_values")
      .select("id,phenotype_evaluation_id,numeric_value")
      .eq("trait_id", ids.traitYield)
      .limit(1)
      .single();
    if (yieldValue.error) throw yieldValue.error;
    const evaluation = await admin
      .from("phenotype_evaluations")
      .select("phenotype_id")
      .eq("id", yieldValue.data.phenotype_evaluation_id)
      .single();
    if (evaluation.error) throw evaluation.error;
    const phenotype = await admin
      .from("phenotypes")
      .select("trial_entry_id")
      .eq("id", evaluation.data.phenotype_id)
      .single();
    if (phenotype.error) throw phenotype.error;
    const entry = await admin
      .from("trial_entries")
      .select("trial_id")
      .eq("id", phenotype.data.trial_entry_id)
      .single();
    if (entry.error) throw entry.error;
    expect(entry.data.trial_id).toBe(ids.trialA);

    const mutateValue = await admin
      .from("phenotype_trait_values")
      .update({ numeric_value: Number(yieldValue.data.numeric_value) + 1000 })
      .eq("id", yieldValue.data.id);
    if (mutateValue.error) throw mutateValue.error;

    const afterEvidenceChangeHtml = await (await request(scenarioUrl)).text();
    expect(afterEvidenceChangeHtml).toContain("PÉRIMÉE");
  }, 60_000);

  it("rejects a now-stale met_waasb_v1 source run (hardening #2) - never silently consumes a BLUP/WAASBY computed on since-changed observations", async () => {
    await signIn(emailOwner, password);
    // Mutate one of trialC's own raw yield observations WITHOUT
    // re-running met_waasb_v1 - ids.waasbYieldRun's own
    // dataset_fingerprint now disagrees with the live data. This is
    // intentionally the LAST test that touches trialC's raw data.
    const trialCYieldValue = await admin
      .from("phenotype_trait_values")
      .select("id,phenotype_evaluation_id,numeric_value")
      .eq("trait_id", ids.traitYield)
      .limit(50);
    if (trialCYieldValue.error) throw trialCYieldValue.error;
    // Pick one whose phenotype belongs to trialC specifically (traitYield
    // is shared across trials A/B/C in this fixture).
    let mutatedOne = false;
    for (const row of trialCYieldValue.data) {
      const evalRow = await admin
        .from("phenotype_evaluations")
        .select("phenotype_id")
        .eq("id", row.phenotype_evaluation_id)
        .single();
      if (evalRow.error) continue;
      const phenoRow = await admin
        .from("phenotypes")
        .select("trial_entry_id")
        .eq("id", evalRow.data.phenotype_id)
        .single();
      if (phenoRow.error) continue;
      const entryRow = await admin
        .from("trial_entries")
        .select("trial_id")
        .eq("id", phenoRow.data.trial_entry_id)
        .single();
      if (entryRow.error || entryRow.data.trial_id !== ids.trialC) continue;
      const mutate = await admin
        .from("phenotype_trait_values")
        .update({ numeric_value: Number(row.numeric_value) + 500 })
        .eq("id", row.id);
      if (mutate.error) throw mutate.error;
      mutatedOne = true;
      break;
    }
    expect(mutatedOne).toBe(true);

    const pageUrl = `/app/analytics/breeding-decision?program=${ids.program}&trial=${ids.trialC}`;
    await submitAction(pageUrl, "create-breeding-decision-scenario", {
      program_id: ids.program,
      trial_id: ids.trialC,
      name: `Scenario C stale ${marker}`,
      description: "",
      candidate_eligibility: "all",
      selection_proportion: "40",
    });
    const scenario = await admin
      .from("breeding_decision_scenarios")
      .select("id")
      .eq("trial_id", ids.trialC)
      .eq("name", `Scenario C stale ${marker}`)
      .single();
    if (scenario.error) throw scenario.error;
    const scenarioId = scenario.data.id as string;
    const scenarioUrl = `${pageUrl}&scenario=${scenarioId}`;

    await submitAction(scenarioUrl, "add-breeding-decision-scenario-trait", {
      scenario_id: scenarioId,
      trait_id: ids.traitYield,
      direction: "higher_is_better",
      target_value: "",
      weight: "",
      economic_weight: "",
      source_type: "WAASBY_STABILITY_PERFORMANCE",
      source_run_id: ids.waasbYieldRun,
      evaluation_date: "",
    });
    await submitAction(scenarioUrl, "add-breeding-decision-scenario-trait", {
      scenario_id: scenarioId,
      trait_id: ids.traitHeight,
      direction: "higher_is_better",
      target_value: "",
      weight: "",
      economic_weight: "",
      source_type: "WAASBY_STABILITY_PERFORMANCE",
      source_run_id: ids.waasbHeightRun,
      evaluation_date: "",
    });
    await submitAction(scenarioUrl, "create-breeding-decision-run", {
      program_id: ids.program,
      scenario_id: scenarioId,
      method: "selection_mtsi_v1",
    });

    const runs = await admin
      .from("analytics_runs")
      .select("id,status,result")
      .eq("scenario_id", scenarioId)
      .eq("analysis_type", "breeding_decision");
    if (runs.error) throw runs.error;
    expect(runs.data.length).toBe(1);
    expect(runs.data[0].status).toBe("not_estimable");
    expect(runs.data[0].result.eligibility.reasons.join(" ")).toMatch(
      /SOURCE_RUN_STALE/,
    );
  }, 60_000);
});
