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

/** Builds one full parent_line -> cross -> family -> seed_lot -> phenotype
 * -> phenotype_evaluation chain plus a media_assets row on that
 * evaluation, exactly mirroring tests/plant-media.sql's own fixture
 * shape. A phenotype_evaluation is used (not a parent_line) because,
 * unlike the breeding-registry entity inspector (a single shared client
 * dialog that renders no entity's detail at all - EntityInspector
 * returns null - until a row is actually clicked), the Phenotypes page's
 * "Mesures récentes" list renders every evaluation's MediaGalleryDrawer
 * unconditionally in the server-rendered HTML, which is what lets a
 * headless HTTP test discover the real Server Action reference fields
 * the same way tests/phenotypes.integration.test.ts already does for
 * this page. */
async function buildChain(
  suffix: string,
  organizationId: string,
  programId: string,
) {
  const parent = await admin
    .from("parent_lines")
    .insert({ program_id: programId, line_name: `AdvMedia F ${suffix}` })
    .select("id")
    .single();
  if (parent.error) throw parent.error;
  const parent2 = await admin
    .from("parent_lines")
    .insert({ program_id: programId, line_name: `AdvMedia M ${suffix}` })
    .select("id")
    .single();
  if (parent2.error) throw parent2.error;
  const cross = await admin
    .from("crosses")
    .insert({
      program_id: programId,
      female_parent_id: parent.data.id,
      male_parent_id: parent2.data.id,
    })
    .select("id")
    .single();
  if (cross.error) throw cross.error;
  const family = await admin
    .from("families")
    .insert({ program_id: programId, cross_id: cross.data.id })
    .select("id")
    .single();
  if (family.error) throw family.error;
  const seedLot = await admin
    .from("seed_lots")
    .insert({
      program_id: programId,
      cross_id: cross.data.id,
      family_id: family.data.id,
    })
    .select("id")
    .single();
  if (seedLot.error) throw seedLot.error;
  const phenotype = await admin
    .from("phenotypes")
    .insert({
      program_id: programId,
      family_id: family.data.id,
      seed_lot_id: seedLot.data.id,
    })
    .select("id")
    .single();
  if (phenotype.error) throw phenotype.error;
  const evaluation = await admin
    .from("phenotype_evaluations")
    .insert({ phenotype_id: phenotype.data.id, evaluation_date: "2026-05-01" })
    .select("id")
    .single();
  if (evaluation.error) throw evaluation.error;
  const storagePath = `org/${organizationId}/phenotype-evaluation/${evaluation.data.id}/${marker}-${suffix}.jpg`;
  const media = await admin
    .from("media_assets")
    .insert({
      phenotype_evaluation_id: evaluation.data.id,
      storage_path: storagePath,
      original_filename: "seed.jpg",
      mime_type: "image/jpeg",
      byte_size: 1000,
    })
    .select("id")
    .single();
  if (media.error) throw media.error;
  return {
    evaluationId: evaluation.data.id as string,
    mediaId: media.data.id as string,
    storagePath,
  };
}

const password = `${randomUUID()}Aa9!`;
const emailOwner = `advmedia-owner-${marker}@example.test`;
const emailOther = `advmedia-other-${marker}@example.test`;
const programCode = `ADVM${marker.toUpperCase()}`;

// Covers V2-03's advanced acquisition metadata and non-destructive
// annotation model. Temporal ordering/comparison retrieval and the
// annotation overlay are exercised in e2e/advanced-media.spec.ts instead:
// listComparableMedia/listMediaAnnotations are read-only Server Actions
// invoked directly by client-side JS (never bound to a plain <form>, the
// same way the pre-existing listMedia already is), so - exactly like the
// rest of the Plant Media gallery - they are not reachable by a headless
// HTTP fetch() the way a real <form action=...> mutation is; only a real
// browser executes the client code that calls them.
describe.sequential("advanced media metadata and annotations", () => {
  beforeAll(async () => {
    const team = await admin
      .from("organizations")
      .insert({ name: "AdvMedia team", slug: `advmedia-${marker}` })
      .select("id")
      .single();
    if (team.error) throw team.error;
    ids.team = team.data.id;
    const otherTeam = await admin
      .from("organizations")
      .insert({ name: "AdvMedia other team", slug: `advmedia-other-${marker}` })
      .select("id")
      .single();
    if (otherTeam.error) throw otherTeam.error;
    ids.otherTeam = otherTeam.data.id;

    const program = await admin
      .from("programs")
      .insert({
        organization_id: ids.team,
        code: programCode,
        name: "AdvMedia program",
        species: "Test species",
      })
      .select("id")
      .single();
    if (program.error) throw program.error;
    ids.program = program.data.id;
    const otherProgram = await admin
      .from("programs")
      .insert({
        organization_id: ids.otherTeam,
        code: `${programCode}O`,
        name: "AdvMedia other program",
        species: "Test species",
      })
      .select("id")
      .single();
    if (otherProgram.error) throw otherProgram.error;
    ids.otherProgram = otherProgram.data.id;

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
        display_name: "AdvMedia owner",
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
        display_name: "AdvMedia other",
      })
      .select("id")
      .single();
    if (otherProfile.error) throw otherProfile.error;

    const chain = await buildChain("a", ids.team, ids.program);
    ids.evaluation = chain.evaluationId;
    ids.media = chain.mediaId;
    ids.storagePath = chain.storagePath;

    const otherChain = await buildChain("b", ids.otherTeam, ids.otherProgram);
    ids.otherEvaluation = otherChain.evaluationId;
    ids.otherMedia = otherChain.mediaId;
  }, 30000);

  afterAll(async () => {
    for (const key of ["owner", "other"])
      if (ids[key]) await admin.auth.admin.deleteUser(ids[key]);
    for (const key of ["team", "otherTeam"])
      if (ids[key]) hardDeleteOrganization(ids[key]);
  });

  const phenotypesUrl = () =>
    `/app/phenotypes?program=${ids.program}&tab=evaluations`;
  const otherPhenotypesUrl = () =>
    `/app/phenotypes?program=${ids.otherProgram}&tab=evaluations`;

  it("updateMediaMetadata persists every V2-03 acquisition field without touching storage/target identity", async () => {
    await signIn(emailOwner, password);
    const html = await (await request(phenotypesUrl())).text();
    const body = new FormData();
    appendServerActionFields(body, html, "media-edit-" + ids.media);
    body.set("media_id", ids.media);
    body.set("caption", "Feuille jaunie");
    body.set("media_kind", "symptom");
    body.set("captured_at", "2026-05-01");
    body.set("captured_at_time", "10:30");
    body.set("developmental_stage", "D3");
    body.set("viewpoint", "top");
    body.set("imaging_modality", "visible");
    body.set("operator_id", ids.ownerProfile);
    body.set("scale_value", "10");
    body.set("scale_unit", "cm");
    body.set("scale_note", "règle 10cm");
    body.set("scientific_note", "Nécrose observée au bord du limbe.");
    const response = await request(phenotypesUrl(), {
      method: "POST",
      headers: { origin: base },
      body,
    });
    expect(response.status).toBe(303);

    const row = await admin
      .from("media_assets")
      .select(
        "caption,media_kind,captured_at,captured_at_time,developmental_stage,viewpoint,imaging_modality,operator_id,scale_value,scale_unit,scale_note,scientific_note,storage_path,phenotype_evaluation_id",
      )
      .eq("id", ids.media)
      .single();
    expect(row.data?.developmental_stage).toBe("D3");
    expect(row.data?.viewpoint).toBe("top");
    expect(row.data?.imaging_modality).toBe("visible");
    expect(row.data?.operator_id).toBe(ids.ownerProfile);
    expect(Number(row.data?.scale_value)).toBe(10);
    expect(row.data?.scale_unit).toBe("cm");
    expect(row.data?.scale_note).toBe("règle 10cm");
    expect(row.data?.scientific_note).toBe(
      "Nécrose observée au bord du limbe.",
    );
    expect(row.data?.captured_at_time).toMatch(/^10:30/);
    // Identity untouched by a metadata edit.
    expect(row.data?.storage_path).toBe(ids.storagePath);
    expect(row.data?.phenotype_evaluation_id).toBe(ids.evaluation);
  });

  it("createAnnotationAction creates a point annotation owned by the caller's team", async () => {
    await signIn(emailOwner, password);
    const html = await (await request(phenotypesUrl())).text();
    const body = new FormData();
    appendServerActionFields(body, html, "annotation-create-" + ids.media);
    body.set("media_id", ids.media);
    body.set("annotation_type", "point");
    body.set("x", "0.3");
    body.set("y", "0.4");
    body.set("label", "bourgeon");
    const response = await request(phenotypesUrl(), {
      method: "POST",
      headers: { origin: base },
      body,
    });
    expect(response.status).toBe(303);

    const row = await admin
      .from("media_annotations")
      .select("id,annotation_type,x,y,label")
      .eq("media_asset_id", ids.media)
      .eq("annotation_type", "point")
      .single();
    expect(row.data?.label).toBe("bourgeon");
    expect(Number(row.data?.x)).toBeCloseTo(0.3);
    ids.annotation = row.data!.id;
  });

  it("updateAnnotationAction edits the label without changing its identity", async () => {
    await signIn(emailOwner, password);
    const html = await (await request(phenotypesUrl())).text();
    const body = new FormData();
    appendServerActionFields(body, html, "annotation-edit-" + ids.annotation);
    body.set("annotation_id", ids.annotation);
    body.set("label", "bourgeon axillaire");
    const response = await request(phenotypesUrl(), {
      method: "POST",
      headers: { origin: base },
      body,
    });
    expect(response.status).toBe(303);
    const row = await admin
      .from("media_annotations")
      .select("label,media_asset_id,annotation_type")
      .eq("id", ids.annotation)
      .single();
    expect(row.data?.label).toBe("bourgeon axillaire");
    expect(row.data?.media_asset_id).toBe(ids.media);
    expect(row.data?.annotation_type).toBe("point");
  });

  it("archiveAnnotationAction then restoreAnnotationAction round-trips archived_at", async () => {
    await signIn(emailOwner, password);
    let html = await (await request(phenotypesUrl())).text();
    let body = new FormData();
    appendServerActionFields(
      body,
      html,
      "annotation-archive-" + ids.annotation,
    );
    body.set("annotation_id", ids.annotation);
    let response = await request(phenotypesUrl(), {
      method: "POST",
      headers: { origin: base },
      body,
    });
    expect(response.status).toBe(303);
    let row = await admin
      .from("media_annotations")
      .select("archived_at")
      .eq("id", ids.annotation)
      .single();
    expect(row.data?.archived_at).not.toBeNull();

    html = await (await request(phenotypesUrl())).text();
    body = new FormData();
    appendServerActionFields(
      body,
      html,
      "annotation-restore-" + ids.annotation,
    );
    body.set("annotation_id", ids.annotation);
    response = await request(phenotypesUrl(), {
      method: "POST",
      headers: { origin: base },
      body,
    });
    expect(response.status).toBe(303);
    row = await admin
      .from("media_annotations")
      .select("archived_at")
      .eq("id", ids.annotation)
      .single();
    expect(row.data?.archived_at).toBeNull();
  });

  it("a user from another organization cannot create an annotation on this team's media, even by forging the media_id field", async () => {
    await signIn(emailOther, password);
    // Renders the other team's OWN phenotypes page to obtain a legitimate
    // createAnnotationAction reference, then substitutes this team's
    // media id as the plain form value - exactly the forged-reference
    // scenario RLS (not the UI) must reject.
    const html = await (await request(otherPhenotypesUrl())).text();
    const body = new FormData();
    appendServerActionFields(body, html, "annotation-create-" + ids.otherMedia);
    body.set("media_id", ids.media);
    body.set("annotation_type", "point");
    body.set("x", "0.1");
    body.set("y", "0.1");
    await request(otherPhenotypesUrl(), {
      method: "POST",
      headers: { origin: base },
      body,
    });
    const row = await admin
      .from("media_annotations")
      .select("id")
      .eq("media_asset_id", ids.media)
      .eq("x", 0.1);
    expect(row.data ?? []).toHaveLength(0);
  });

  it("the private Storage bucket never serves this image without a signed token", async () => {
    const response = await fetch(
      `${backend.API_URL}/storage/v1/object/public/breedops-media/${ids.storagePath}`,
    );
    expect(response.status).not.toBe(200);
  });

  it("archiving the media preserves its V2-03 metadata", async () => {
    await signIn(emailOwner, password);
    const html = await (await request(phenotypesUrl())).text();
    const body = new FormData();
    appendServerActionFields(body, html, "media-lifecycle-" + ids.media);
    body.set("media_id", ids.media);
    const response = await request(phenotypesUrl(), {
      method: "POST",
      headers: { origin: base },
      body,
    });
    expect(response.status).toBe(303);
    const row = await admin
      .from("media_assets")
      .select("archived_at,developmental_stage,scientific_note")
      .eq("id", ids.media)
      .single();
    expect(row.data?.archived_at).not.toBeNull();
    expect(row.data?.developmental_stage).toBe("D3");
    expect(row.data?.scientific_note).toBe(
      "Nécrose observée au bord du limbe.",
    );
  });
});
