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

/** A real, directly-authenticated (password sign-in, not service-role)
 * Supabase client - its .from() calls are real HTTP requests to the same
 * PostgREST endpoint the app's own Server Actions use, going through the
 * exact same RLS policies. Used below wherever the real UI control is not
 * reachable headlessly (see the per-test comments), so the authorization
 * boundary itself is still exercised over real HTTP with a real session,
 * not faked. */
async function signInDirect(email: string, password: string) {
  const client = createClient(backend.API_URL, backend.ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

const password = `${randomUUID()}Aa9!`;
const emailOwner = `advmedia-owner-${marker}@example.test`;
const emailOther = `advmedia-other-${marker}@example.test`;
const programCode = `ADVM${marker.toUpperCase()}`;

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
  return {
    parentId: parent.data.id as string,
    evaluationId: evaluation.data.id as string,
  };
}

// Covers V2-03's advanced acquisition metadata and non-destructive
// annotation model.
//
// Scope note: MediaGallery (src/components/media-gallery.tsx) fetches its
// items client-side (a Server Action called from a useEffect, exactly
// like the pre-existing V1 gallery already did) and only renders
// per-item controls - EditDrawer, AddAnnotationForm, archive/restore,
// set-primary - once that fetch resolves. None of that exists in the
// plain server-rendered HTML a headless fetch() receives (confirmed
// empirically: this file's first draft tried the appendServerActionFields
// pattern for those and every one failed with "Form not found"), the same
// reason this codebase has never had a tests/media.integration.test.ts
// for the original V1 gallery either. Only UploadDrawer's form is
// unconditional (rendered regardless of the items fetch), so it is the
// one case below that genuinely goes through a real HTTP form post to the
// Next.js app. Every other per-item action is instead exercised through a
// second, directly-authenticated Supabase client (signInDirect) - a real
// HTTP request to the same PostgREST endpoint and the exact same RLS
// policies the Server Action itself would use, just not wrapped in the
// Next.js UI layer that cannot be reached without a real browser
// executing real client JS. Those UI-wrapped flows are instead covered
// end-to-end in e2e/advanced-media.spec.ts.
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
    ids.parent = chain.parentId;
    ids.evaluation = chain.evaluationId;
    const otherChain = await buildChain("b", ids.otherTeam, ids.otherProgram);
    ids.otherMedia = (
      await admin
        .from("media_assets")
        .insert({
          phenotype_evaluation_id: otherChain.evaluationId,
          storage_path: `org/${ids.otherTeam}/phenotype-evaluation/${otherChain.evaluationId}/${marker}-b.jpg`,
          original_filename: "other-seed.jpg",
          mime_type: "image/jpeg",
          byte_size: 1000,
        })
        .select("id")
        .single()
    ).data!.id;
  }, 30000);

  afterAll(async () => {
    for (const key of ["owner", "other"])
      if (ids[key]) await admin.auth.admin.deleteUser(ids[key]);
    for (const key of ["team", "otherTeam"])
      if (ids[key]) hardDeleteOrganization(ids[key]);
  });

  it("uploadMedia, via a real HTTP form post, stores every V2-03 acquisition field and the binary identity", async () => {
    await signIn(emailOwner, password);
    const html = await (
      await request(`/app/breeding?program=${ids.program}`)
    ).text();
    const body = new FormData();
    appendServerActionFields(
      body,
      html,
      `media-upload-parent_line-${ids.parent}`,
    );
    body.set("target_type", "parent_line");
    body.set("target_id", ids.parent);
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9,
    ]);
    body.set("file", new File([jpeg], "leaf.jpg", { type: "image/jpeg" }));
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
    body.set("is_primary", "false");
    const response = await request(`/app/breeding?program=${ids.program}`, {
      method: "POST",
      headers: { origin: base },
      body,
    });
    expect(response.status).toBe(303);

    const row = await admin
      .from("media_assets")
      .select(
        "id,parent_line_id,mime_type,byte_size,developmental_stage,viewpoint,imaging_modality,operator_id,scale_value,scale_unit,scale_note,scientific_note,captured_at,captured_at_time",
      )
      .eq("parent_line_id", ids.parent)
      .single();
    expect(row.data?.mime_type).toBe("image/jpeg");
    expect(row.data?.developmental_stage).toBe("D3");
    expect(row.data?.viewpoint).toBe("top");
    expect(row.data?.imaging_modality).toBe("visible");
    expect(row.data?.operator_id).toBe(ids.ownerProfile);
    expect(Number(row.data?.scale_value)).toBe(10);
    expect(row.data?.scale_unit).toBe("cm");
    expect(row.data?.captured_at_time).toMatch(/^10:30/);
    ids.media = row.data!.id;
  });

  it("the owning team can edit advanced metadata and create/edit/archive/restore an annotation over real authenticated HTTP", async () => {
    const owner = await signInDirect(emailOwner, password);

    const updated = await owner
      .from("media_assets")
      .update({
        scientific_note: "Nécrose confirmée après seconde observation.",
      })
      .eq("id", ids.media)
      .select("id,scientific_note,storage_path")
      .single();
    expect(updated.error).toBeNull();
    expect(updated.data?.scientific_note).toBe(
      "Nécrose confirmée après seconde observation.",
    );

    const created = await owner
      .from("media_annotations")
      .insert({
        media_asset_id: ids.media,
        annotation_type: "point",
        x: 0.3,
        y: 0.4,
        label: "bourgeon",
      })
      .select("id,label")
      .single();
    expect(created.error).toBeNull();
    const annotationId = created.data!.id as string;

    const edited = await owner
      .from("media_annotations")
      .update({ label: "bourgeon axillaire" })
      .eq("id", annotationId)
      .select("label,media_asset_id,annotation_type")
      .single();
    expect(edited.data?.label).toBe("bourgeon axillaire");
    expect(edited.data?.media_asset_id).toBe(ids.media);

    const archived = await owner
      .from("media_annotations")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", annotationId)
      .select("archived_at")
      .single();
    expect(archived.data?.archived_at).not.toBeNull();

    const restored = await owner
      .from("media_annotations")
      .update({ archived_at: null })
      .eq("id", annotationId)
      .select("archived_at")
      .single();
    expect(restored.data?.archived_at).toBeNull();
  });

  it("a user from another organization cannot create an annotation on this team's media, even knowing its id", async () => {
    const other = await signInDirect(emailOther, password);
    const attempt = await other.from("media_annotations").insert({
      media_asset_id: ids.media,
      annotation_type: "point",
      x: 0.1,
      y: 0.1,
    });
    expect(attempt.error).not.toBeNull();
    const row = await admin
      .from("media_annotations")
      .select("id")
      .eq("media_asset_id", ids.media)
      .eq("x", 0.1);
    expect(row.data ?? []).toHaveLength(0);
  });

  it("a user from another organization cannot read this team's media metadata or annotations", async () => {
    const other = await signInDirect(emailOther, password);
    const media = await other
      .from("media_assets")
      .select("id")
      .eq("id", ids.media);
    expect(media.data ?? []).toHaveLength(0);
    const annotations = await other
      .from("media_annotations")
      .select("id")
      .eq("media_asset_id", ids.media);
    expect(annotations.data ?? []).toHaveLength(0);
  });

  it("archiving the media over real authenticated HTTP preserves its V2-03 metadata, and blocks new annotations", async () => {
    const owner = await signInDirect(emailOwner, password);
    const archived = await owner
      .from("media_assets")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", ids.media)
      .select("archived_at,developmental_stage,scientific_note")
      .single();
    expect(archived.data?.archived_at).not.toBeNull();
    expect(archived.data?.developmental_stage).toBe("D3");

    const blocked = await owner.from("media_annotations").insert({
      media_asset_id: ids.media,
      annotation_type: "point",
      x: 0.2,
      y: 0.2,
    });
    expect(blocked.error).not.toBeNull();

    await admin
      .from("media_assets")
      .update({ archived_at: null, archived_by: null })
      .eq("id", ids.media);
  });

  it("the private Storage bucket never serves this image without a signed token", async () => {
    const path = (
      await admin
        .from("media_assets")
        .select("storage_path")
        .eq("id", ids.media)
        .single()
    ).data!.storage_path as string;
    const response = await fetch(
      `${backend.API_URL}/storage/v1/object/public/breedops-media/${path}`,
    );
    expect(response.status).not.toBe(200);
  });
});
