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

/** A real, directly-authenticated Supabase client (password sign-in, not
 * service-role) - used for cross-team RLS verification, exactly like
 * tests/advanced-media.integration.test.ts: the UI itself always defaults
 * safely to the caller's own program list, so proving a cross-team denial
 * requires calling the RLS-scoped RPCs/tables directly, the same boundary
 * the UI's own Server Actions go through. */
async function signInDirect(email: string, password: string) {
  const client = createClient(backend.API_URL, backend.ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

const password = `${randomUUID()}Aa9!`;
const emailOwner = `trait-analytics-owner-${marker}@example.test`;
const emailOther = `trait-analytics-other-${marker}@example.test`;
const programCode = `TA${marker.toUpperCase()}`;

const RICH_TRAIT_N_PHENOTYPES = 10;
const RICH_TRAIT_DATES = ["2026-01-01", "2026-02-01", "2026-03-01"];

// Covers V2-04's trait-analytics dataset builder, descriptive/longitudinal
// computation, analytics-run provenance, stale detection, cross-team
// denial, and CSV export.
//
// Architecture note: unlike MediaGallery (V2-03), src/app/app/analytics/
// page.tsx is a plain Server Component reading searchParams - there is no
// client-side useEffect fetch gating its content, so (unlike the media
// integration suite) every read-only view here IS reachable through a
// real, plain HTTP GET with a real session cookie. Only the cross-team
// RLS boundary itself is instead verified with a second,
// directly-authenticated Supabase client, since the UI's own program
// picker safely defaults away from a foreign program rather than ever
// requesting it.
describe.sequential("trait analytics", () => {
  beforeAll(async () => {
    const team = await admin
      .from("organizations")
      .insert({
        name: "TraitAnalytics team",
        slug: `trait-analytics-${marker}`,
      })
      .select("id")
      .single();
    if (team.error) throw team.error;
    ids.team = team.data.id;
    const otherTeam = await admin
      .from("organizations")
      .insert({
        name: "TraitAnalytics other team",
        slug: `trait-analytics-other-${marker}`,
      })
      .select("id")
      .single();
    if (otherTeam.error) throw otherTeam.error;
    ids.otherTeam = otherTeam.data.id;

    const program = await admin
      .from("programs")
      .insert({
        organization_id: ids.team,
        code: programCode,
        name: "TraitAnalytics program",
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
        role: "user",
        display_name: "TraitAnalytics owner",
      })
      .select("id")
      .single();
    if (ownerProfile.error) throw ownerProfile.error;
    ids.ownerProfile = ownerProfile.data.id;

    const other = await admin.auth.admin.createUser({
      email: emailOther,
      password,
      email_confirm: true,
    });
    if (other.error) throw other.error;
    ids.other = other.data.user.id;
    const otherProfile = await admin
      .from("profiles")
      .insert({
        user_id: ids.other,
        organization_id: ids.otherTeam,
        role: "user",
        display_name: "TraitAnalytics other",
      })
      .select("id")
      .single();
    if (otherProfile.error) throw otherProfile.error;

    // A numeric trait with enough entities/observations/timepoints to be
    // eligible for repeatability (>=5 entities) and rank stability (>=8
    // paired entities), active for the program via a module.
    const traitRich = await admin
      .from("phenotype_traits")
      .insert({
        organization_id: ids.team,
        code: "vigor_rich",
        name: "Vigueur (riche)",
        category: "development",
        data_type: "numeric",
        direction: "higher_is_better",
      })
      .select("id")
      .single();
    if (traitRich.error) throw traitRich.error;
    ids.traitRich = traitRich.data.id;

    // A second numeric trait with too few entities to support repeatability
    // - this is the required NOT_ESTIMABLE demonstration.
    const traitSparse = await admin
      .from("phenotype_traits")
      .insert({
        organization_id: ids.team,
        code: "height_sparse",
        name: "Hauteur (clairsemée)",
        category: "morphology",
        data_type: "numeric",
        direction: "higher_is_better",
      })
      .select("id")
      .single();
    if (traitSparse.error) throw traitSparse.error;
    ids.traitSparse = traitSparse.data.id;

    const phenotypingModule = await admin
      .from("phenotyping_modules")
      .insert({ organization_id: ids.team, name: "Module analytique" })
      .select("id")
      .single();
    if (phenotypingModule.error) throw phenotypingModule.error;
    await admin.from("phenotyping_module_traits").insert([
      {
        module_id: phenotypingModule.data.id,
        trait_id: ids.traitRich,
        display_order: 1,
      },
      {
        module_id: phenotypingModule.data.id,
        trait_id: ids.traitSparse,
        display_order: 2,
      },
    ]);
    await admin
      .from("program_phenotyping_modules")
      .insert({
        program_id: ids.program,
        module_id: phenotypingModule.data.id,
        is_active: true,
      });

    const parent = await admin
      .from("parent_lines")
      .insert({ program_id: ids.program, line_name: "TraitAnalytics F" })
      .select("id")
      .single();
    if (parent.error) throw parent.error;
    const parent2 = await admin
      .from("parent_lines")
      .insert({ program_id: ids.program, line_name: "TraitAnalytics M" })
      .select("id")
      .single();
    if (parent2.error) throw parent2.error;
    const cross = await admin
      .from("crosses")
      .insert({
        program_id: ids.program,
        female_parent_id: parent.data.id,
        male_parent_id: parent2.data.id,
      })
      .select("id")
      .single();
    if (cross.error) throw cross.error;
    const family = await admin
      .from("families")
      .insert({ program_id: ids.program, cross_id: cross.data.id })
      .select("id")
      .single();
    if (family.error) throw family.error;

    const phenotypeIds: string[] = [];
    for (let i = 0; i < RICH_TRAIT_N_PHENOTYPES; i++) {
      const phenotype = await admin
        .from("phenotypes")
        .insert({
          program_id: ids.program,
          family_id: family.data.id,
          phenotype_code: `${programCode}-P-${String(i).padStart(3, "0")}`,
          block: i % 2 === 0 ? "A" : "B",
          replicate: (i % 3) + 1,
          location: "Serre 1",
        })
        .select("id")
        .single();
      if (phenotype.error) throw phenotype.error;
      phenotypeIds.push(phenotype.data.id);
    }
    ids.phenotypeFirst = phenotypeIds[0];

    for (const phenotypeId of phenotypeIds) {
      for (const date of RICH_TRAIT_DATES) {
        const evaluation = await admin
          .from("phenotype_evaluations")
          .insert({ phenotype_id: phenotypeId, evaluation_date: date })
          .select("id")
          .single();
        if (evaluation.error) throw evaluation.error;
        const value =
          10 +
          phenotypeIds.indexOf(phenotypeId) +
          RICH_TRAIT_DATES.indexOf(date) * 5;
        const insertValue = await admin
          .from("phenotype_trait_values")
          .insert({
            phenotype_evaluation_id: evaluation.data.id,
            trait_id: ids.traitRich,
            numeric_value: value,
          });
        if (insertValue.error) throw insertValue.error;
      }
    }

    // Sparse trait: only 2 phenotypes, 2 observations each - well below the
    // 5-entity repeatability threshold.
    for (let i = 0; i < 2; i++) {
      const evaluation1 = await admin
        .from("phenotype_evaluations")
        .insert({
          phenotype_id: phenotypeIds[i],
          evaluation_date: "2026-01-15",
        })
        .select("id")
        .single();
      if (evaluation1.error) throw evaluation1.error;
      await admin
        .from("phenotype_trait_values")
        .insert({
          phenotype_evaluation_id: evaluation1.data.id,
          trait_id: ids.traitSparse,
          numeric_value: 5 + i,
        });
    }
  }, 30000);

  afterAll(async () => {
    for (const key of ["owner", "other"])
      if (ids[key]) await admin.auth.admin.deleteUser(ids[key]);
    for (const key of ["team", "otherTeam"])
      if (ids[key]) hardDeleteOrganization(ids[key]);
  });

  it("shows correct observation counts and descriptive statistics over real HTTP, scoped by date filters", async () => {
    await signIn(emailOwner, password);
    const fullPage = await (
      await request(
        `/app/analytics?program=${ids.program}&trait=${ids.traitRich}`,
      )
    ).text();
    expect(fullPage).toMatch(/Observations<\/dt>\s*<dd>30<\/dd>/);

    const filtered = await (
      await request(
        `/app/analytics?program=${ids.program}&trait=${ids.traitRich}&date_from=2026-01-01&date_to=2026-01-31`,
      )
    ).text();
    expect(filtered).toMatch(/Observations<\/dt>\s*<dd>10<\/dd>/);
  });

  it("reports repeatability as eligible for the rich trait and NOT_ESTIMABLE for the sparse trait", async () => {
    await signIn(emailOwner, password);
    const richPage = await (
      await request(
        `/app/analytics?program=${ids.program}&trait=${ids.traitRich}`,
      )
    ).text();
    expect(richPage).toContain("eligibility-panel eligible");

    const sparsePage = await (
      await request(
        `/app/analytics?program=${ids.program}&trait=${ids.traitSparse}`,
      )
    ).text();
    expect(sparsePage).toContain("NON ESTIMABLE");
    expect(sparsePage).toMatch(/entités mesurées/);
  });

  it("always reports heritability as NOT_ESTIMABLE, regardless of trait", async () => {
    await signIn(emailOwner, password);
    const html = await (
      await request(
        `/app/analytics?program=${ids.program}&trait=${ids.traitRich}`,
      )
    ).text();
    expect(html).toContain("NON ESTIMABLE À PARTIR DU MODÈLE ACTUEL");
  });

  it("saves a reproducible analysis run via a real HTTP form post, then export returns the same tidy dataset", async () => {
    await signIn(emailOwner, password);
    const pageHtml = await (
      await request(
        `/app/analytics?program=${ids.program}&trait=${ids.traitRich}`,
      )
    ).text();
    const body = new FormData();
    appendServerActionFields(body, pageHtml, "analytics-save-run");
    body.set("program_id", ids.program);
    body.set("trait_id", ids.traitRich);
    body.set("date_from", "");
    body.set("date_to", "");
    body.set("include_archived", "0");
    const response = await request("/app/analytics", { method: "POST", body });
    expect(response.status).toBe(200);

    const runs = await admin
      .from("analytics_runs")
      .select("id,trait_id,n_observations,dataset_fingerprint,status")
      .eq("program_id", ids.program)
      .eq("trait_id", ids.traitRich);
    if (runs.error) throw runs.error;
    expect(runs.data.length).toBe(1);
    expect(runs.data[0].n_observations).toBe(30);
    expect(runs.data[0].status).toBe("completed");
    ids.savedRunId = runs.data[0].id;

    const csv = await (
      await request(
        `/app/analytics/export?program_id=${ids.program}&trait_id=${ids.traitRich}&format=csv`,
      )
    ).text();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("trait_code");
    expect(lines.length - 1).toBe(30);
  });

  it("marks a saved run as stale once a new observation is added for the same specification", async () => {
    await signIn(emailOwner, password);
    const beforeHtml = await (
      await request(
        `/app/analytics?program=${ids.program}&trait=${ids.traitRich}`,
      )
    ).text();
    expect(beforeHtml).not.toContain("PÉRIMÉE");

    const newEvaluation = await admin
      .from("phenotype_evaluations")
      .insert({
        phenotype_id: ids.phenotypeFirst,
        evaluation_date: "2026-04-01",
      })
      .select("id")
      .single();
    if (newEvaluation.error) throw newEvaluation.error;
    await admin
      .from("phenotype_trait_values")
      .insert({
        phenotype_evaluation_id: newEvaluation.data.id,
        trait_id: ids.traitRich,
        numeric_value: 99,
      });

    const afterHtml = await (
      await request(
        `/app/analytics?program=${ids.program}&trait=${ids.traitRich}`,
      )
    ).text();
    expect(afterHtml).toContain("PÉRIMÉE");
  });

  it("denies a cross-team user both the dataset RPC and analytics_runs, even knowing the exact ids", async () => {
    const other = await signInDirect(emailOther, password);
    const dataset = await other.rpc("trait_observation_dataset", {
      target_program_id: ids.program,
      target_trait_id: ids.traitRich,
    });
    expect(dataset.error).toBeNull();
    expect(dataset.data).toEqual([]);

    const runs = await other
      .from("analytics_runs")
      .select("id")
      .eq("program_id", ids.program);
    expect(runs.error).toBeNull();
    expect(runs.data).toEqual([]);

    const insertAttempt = await other.from("analytics_runs").insert({
      organization_id: ids.team,
      program_id: ids.program,
      trait_id: ids.traitRich,
      specification: {},
      dataset_fingerprint: "0".repeat(64),
      status: "completed",
      engine_name: "breedops-ts-stats",
      engine_version: "1.0.0",
    });
    expect(insertAttempt.error).not.toBeNull();
    expect(insertAttempt.error?.code).toBe("42501");
  });
});
