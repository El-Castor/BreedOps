import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hardDeleteOrganization } from "./db-cleanup";
import { currentProfile } from "../scripts/lib/stack-identity.mjs";
import { computePayloadHash } from "../src/lib/offline/payload-hash";

const profile = currentProfile();
const backend = JSON.parse(readFileSync(profile.backendFile, "utf8"));
if (backend.API_URL !== profile.apiUrl)
  throw new Error("Tests require isolated local Supabase");
const admin = createClient(backend.API_URL, backend.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const userClient = createClient(backend.API_URL, backend.ANON_KEY, {
  auth: { persistSession: false },
});
const base = profile.appOrigin;
const marker = randomUUID().slice(0, 8);
const email = `offline-sync-${marker}@example.test`;
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

async function syncOne(cookieHeader: string | undefined, operation: unknown) {
  const response = await fetch(base + "/api/offline-sync", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookieHeader !== undefined
        ? { cookie: cookieHeader }
        : { cookie: cookies }),
    },
    body: JSON.stringify({ operations: [operation] }),
  });
  const body = (await response.json()) as {
    results?: {
      operationId: string;
      resultCode: string;
      evaluationId?: string;
      replay?: boolean;
    }[];
    error?: string;
  };
  return { status: response.status, body };
}

async function currentConfigFingerprint(): Promise<string> {
  const { data, error } = await userClient.rpc(
    "offline_sync_program_configuration",
    { p_program_id: ids.program },
  );

  if (error || !data) {
    throw error ?? new Error("Missing offline program configuration");
  }

  const fingerprint = (data as unknown as { fingerprint?: unknown })
    .fingerprint;

  if (typeof fingerprint !== "string" || fingerprint.length === 0) {
    throw new Error("Invalid offline configuration fingerprint");
  }

  return fingerprint;
}

describe.sequential(
  "offline sync endpoint (exact-once, idempotency, conflicts)",
  () => {
    beforeAll(async () => {
      const team = await admin
        .from("organizations")
        .insert({
          name: "Synthetic offline-sync test",
          slug: `offline-sync-${marker}`,
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
      const profileRow = await admin
        .from("profiles")
        .insert({ user_id: ids.user, organization_id: ids.team, role: "user" })
        .select("id")
        .single();
      if (profileRow.error) throw profileRow.error;
      ids.profile = profileRow.data.id;
      const program = await admin
        .from("programs")
        .insert({
          organization_id: ids.team,
          code: `OS-${marker}`,
          name: "Synthetic offline-sync program",
        })
        .select("id")
        .single();
      if (program.error) throw program.error;
      ids.program = program.data.id;

      const trait = await admin
        .from("phenotype_traits")
        .insert({
          organization_id: ids.team,
          code: "plant_height",
          name: "Hauteur",
          category: "morphology",
          data_type: "numeric",
          unit: "cm",
          minimum_value: 0,
          maximum_value: 300,
          decimal_places: 1,
        })
        .select("id")
        .single();
      if (trait.error) throw trait.error;
      ids.trait = trait.data.id;

      const module_ = await admin
        .from("phenotyping_modules")
        .insert({ organization_id: ids.team, name: "Agronomie" })
        .select("id")
        .single();
      if (module_.error) throw module_.error;
      ids.module = module_.data.id;

      const moduleTrait = await admin.from("phenotyping_module_traits").insert({
        module_id: ids.module,
        trait_id: ids.trait,
        display_order: 1,
      });
      if (moduleTrait.error) throw moduleTrait.error;

      const programModule = await admin
        .from("program_phenotyping_modules")
        .insert({ program_id: ids.program, module_id: ids.module });
      if (programModule.error) throw programModule.error;

      const parents = await admin
        .from("parent_lines")
        .insert([
          { program_id: ids.program, parent_code: `OSF-${marker}` },
          { program_id: ids.program, parent_code: `OSM-${marker}` },
        ])
        .select("id");
      if (parents.error) throw parents.error;
      const cross = await admin
        .from("crosses")
        .insert({
          program_id: ids.program,
          cross_code: `OSX-${marker}`,
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
          family_code: `OSFAM-${marker}`,
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
          seed_lot_code: `OSLOT-${marker}`,
        })
        .select("id")
        .single();
      if (lot.error) throw lot.error;
      const phenotype = await admin
        .from("phenotypes")
        .insert({
          program_id: ids.program,
          family_id: ids.family,
          seed_lot_id: lot.data.id,
          phenotype_code: `OSPH-${marker}`,
        })
        .select("id")
        .single();
      if (phenotype.error) throw phenotype.error;
      ids.phenotype = phenotype.data.id;
      const archivedPhenotype = await admin
        .from("phenotypes")
        .insert({
          program_id: ids.program,
          family_id: ids.family,
          seed_lot_id: lot.data.id,
          phenotype_code: `OSPH-ARCH-${marker}`,
        })
        .select("id")
        .single();
      if (archivedPhenotype.error) throw archivedPhenotype.error;
      ids.archivedPhenotype = archivedPhenotype.data.id;
      await admin
        .from("phenotypes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", ids.archivedPhenotype);

      const directLogin = await userClient.auth.signInWithPassword({
        email,
        password,
      });
      if (directLogin.error) throw directLogin.error;

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
      await userClient.auth.signOut();
      if (ids.user) await admin.auth.admin.deleteUser(ids.user);
      if (ids.team) hardDeleteOrganization(ids.team);
    });

    it("rejects an unauthenticated request with AUTH_REQUIRED", async () => {
      const { status, body } = await syncOne("", {});
      expect(status).toBe(401);
      expect(body.error).toBe("AUTH_REQUIRED");
    });

    it("synchronizes a fresh operation exactly once, and a retry never creates a second evaluation", async () => {
      const fingerprint = await currentConfigFingerprint();
      const payload = {
        phenotypeId: ids.phenotype,
        evaluationDate: "2026-11-06",
        values: { plant_height: 142.5 },
        notes: "Saisie terrain",
      };
      const payloadHash = await computePayloadHash(payload);
      const operationId = randomUUID();
      const operation = {
        operationId,
        operationType: "PHENOTYPE_TRAIT_EVALUATION",
        programId: ids.program,
        phenotypeId: payload.phenotypeId,
        evaluationDate: payload.evaluationDate,
        values: payload.values,
        notes: payload.notes,
        payloadHash,
        packConfigurationFingerprint: fingerprint,
      };

      const first = await syncOne(undefined, operation);
      expect(first.status).toBe(200);
      expect(first.body.results?.[0].resultCode).toBe("SYNCED");
      expect(first.body.results?.[0].replay).toBe(false);
      const evaluationId = first.body.results?.[0].evaluationId;
      expect(evaluationId).toBeTruthy();

      const afterFirst = await admin
        .from("phenotype_evaluations")
        .select("id")
        .eq("phenotype_id", payload.phenotypeId);
      expect(afterFirst.data).toHaveLength(1);

      // Exact retry: same operation_id, same payload (V2-07 §33).
      const retry = await syncOne(undefined, operation);
      expect(retry.status).toBe(200);
      expect(retry.body.results?.[0].resultCode).toBe("SYNCED");
      expect(retry.body.results?.[0].replay).toBe(true);
      expect(retry.body.results?.[0].evaluationId).toBe(evaluationId);

      const afterRetry = await admin
        .from("phenotype_evaluations")
        .select("id")
        .eq("phenotype_id", payload.phenotypeId);
      expect(afterRetry.data).toHaveLength(1);
    });

    it("rejects a reused operation_id carrying a different payload (V2-07 §34)", async () => {
      const fingerprint = await currentConfigFingerprint();
      const payloadA = {
        phenotypeId: ids.phenotype,
        evaluationDate: "2026-11-07",
        values: { plant_height: 100 },
        notes: null,
      };
      const operationId = randomUUID();
      const first = await syncOne(undefined, {
        operationId,
        operationType: "PHENOTYPE_TRAIT_EVALUATION",
        programId: ids.program,
        phenotypeId: payloadA.phenotypeId,
        evaluationDate: payloadA.evaluationDate,
        values: payloadA.values,
        notes: payloadA.notes,
        payloadHash: await computePayloadHash(payloadA),
        packConfigurationFingerprint: fingerprint,
      });
      expect(first.body.results?.[0].resultCode).toBe("SYNCED");

      const payloadB = { ...payloadA, values: { plant_height: 999 } };
      const second = await syncOne(undefined, {
        operationId,
        operationType: "PHENOTYPE_TRAIT_EVALUATION",
        programId: ids.program,
        phenotypeId: payloadB.phenotypeId,
        evaluationDate: payloadB.evaluationDate,
        values: payloadB.values,
        notes: payloadB.notes,
        payloadHash: await computePayloadHash(payloadB),
        packConfigurationFingerprint: fingerprint,
      });
      expect(second.body.results?.[0].resultCode).toBe(
        "IDEMPOTENCY_PAYLOAD_MISMATCH",
      );

      const rows = await admin
        .from("phenotype_evaluations")
        .select("id")
        .eq("evaluation_date", payloadA.evaluationDate)
        .eq("phenotype_id", ids.phenotype);
      expect(rows.data).toHaveLength(1);
    });

    it("rejects a forged client payload hash before any scientific write", async () => {
      const fingerprint = await currentConfigFingerprint();
      const payload = {
        phenotypeId: ids.phenotype,
        evaluationDate: "2026-11-12",
        values: { plant_height: 111 },
        notes: "Forged client hash",
      };

      const { body } = await syncOne(undefined, {
        operationId: randomUUID(),
        operationType: "PHENOTYPE_TRAIT_EVALUATION",
        programId: ids.program,
        phenotypeId: payload.phenotypeId,
        evaluationDate: payload.evaluationDate,
        values: payload.values,
        notes: payload.notes,
        payloadHash: "0".repeat(64),
        packConfigurationFingerprint: fingerprint,
      });

      expect(body.results?.[0].resultCode).toBe("IDEMPOTENCY_PAYLOAD_MISMATCH");

      const rows = await admin
        .from("phenotype_evaluations")
        .select("id")
        .eq("phenotype_id", ids.phenotype)
        .eq("evaluation_date", payload.evaluationDate);

      expect(rows.data).toHaveLength(0);
    });

    it("rejects a forged browser programId and trusts the phenotype-derived server program", async () => {
      const fingerprint = await currentConfigFingerprint();
      const payload = {
        phenotypeId: ids.phenotype,
        evaluationDate: "2026-11-13",
        values: { plant_height: 112 },
        notes: "Forged program scope",
      };

      const { body } = await syncOne(undefined, {
        operationId: randomUUID(),
        operationType: "PHENOTYPE_TRAIT_EVALUATION",
        programId: randomUUID(),
        phenotypeId: payload.phenotypeId,
        evaluationDate: payload.evaluationDate,
        values: payload.values,
        notes: payload.notes,
        payloadHash: await computePayloadHash(payload),
        packConfigurationFingerprint: fingerprint,
      });

      expect(body.results?.[0].resultCode).toBe("VALIDATION_REJECTED");

      const rows = await admin
        .from("phenotype_evaluations")
        .select("id")
        .eq("phenotype_id", ids.phenotype)
        .eq("evaluation_date", payload.evaluationDate);

      expect(rows.data).toHaveLength(0);
    });

    it("replays an already committed operation even when configuration changed after the commit", async () => {
      const fingerprint = await currentConfigFingerprint();
      const payload = {
        phenotypeId: ids.phenotype,
        evaluationDate: "2026-11-14",
        values: { plant_height: 120 },
        notes: "Commit acknowledged as lost by client",
      };
      const operation = {
        operationId: randomUUID(),
        operationType: "PHENOTYPE_TRAIT_EVALUATION",
        programId: ids.program,
        phenotypeId: payload.phenotypeId,
        evaluationDate: payload.evaluationDate,
        values: payload.values,
        notes: payload.notes,
        payloadHash: await computePayloadHash(payload),
        packConfigurationFingerprint: fingerprint,
      };

      const first = await syncOne(undefined, operation);
      expect(first.body.results?.[0].resultCode).toBe("SYNCED");
      expect(first.body.results?.[0].replay).toBe(false);

      const evaluationId = first.body.results?.[0].evaluationId;
      expect(evaluationId).toBeTruthy();

      const changed = await admin
        .from("phenotype_traits")
        .update({ maximum_value: 250 })
        .eq("id", ids.trait);

      if (changed.error) throw changed.error;

      try {
        // Simulates: server committed the first request, but the client lost
        // the acknowledgement and later retries its unchanged outbox item.
        // Current configuration is now different, but exact replay must win.
        const retry = await syncOne(undefined, operation);

        expect(retry.body.results?.[0].resultCode).toBe("SYNCED");
        expect(retry.body.results?.[0].replay).toBe(true);
        expect(retry.body.results?.[0].evaluationId).toBe(evaluationId);

        const rows = await admin
          .from("phenotype_evaluations")
          .select("id")
          .eq("phenotype_id", ids.phenotype)
          .eq("evaluation_date", payload.evaluationDate);

        expect(rows.data).toHaveLength(1);
        expect(rows.data?.[0].id).toBe(evaluationId);
      } finally {
        const restored = await admin
          .from("phenotype_traits")
          .update({ maximum_value: 300 })
          .eq("id", ids.trait);

        if (restored.error) throw restored.error;
      }
    });

    it("reports CONFIG_CHANGED when the server-side active-trait configuration no longer matches the pack's fingerprint", async () => {
      const staleFingerprint = await currentConfigFingerprint();

      const changed = await admin
        .from("phenotype_traits")
        .update({ maximum_value: 250 })
        .eq("id", ids.trait);
      if (changed.error) throw changed.error;

      const payload = {
        phenotypeId: ids.phenotype,
        evaluationDate: "2026-11-08",
        values: { plant_height: 110 },
        notes: null,
      };
      const { body } = await syncOne(undefined, {
        operationId: randomUUID(),
        operationType: "PHENOTYPE_TRAIT_EVALUATION",
        programId: ids.program,
        phenotypeId: payload.phenotypeId,
        evaluationDate: payload.evaluationDate,
        values: payload.values,
        notes: payload.notes,
        payloadHash: await computePayloadHash(payload),
        packConfigurationFingerprint: staleFingerprint,
      });
      expect(body.results?.[0].resultCode).toBe("CONFIG_CHANGED");

      const restored = await admin
        .from("phenotype_traits")
        .update({ maximum_value: 300 })
        .eq("id", ids.trait);
      if (restored.error) throw restored.error;
    });

    it("reports TARGET_ARCHIVED for a soft-deleted phenotype", async () => {
      const fingerprint = await currentConfigFingerprint();
      const payload = {
        phenotypeId: ids.archivedPhenotype,
        evaluationDate: "2026-11-09",
        values: { plant_height: 110 },
        notes: null,
      };
      const { body } = await syncOne(undefined, {
        operationId: randomUUID(),
        operationType: "PHENOTYPE_TRAIT_EVALUATION",
        programId: ids.program,
        phenotypeId: payload.phenotypeId,
        evaluationDate: payload.evaluationDate,
        values: payload.values,
        notes: payload.notes,
        payloadHash: await computePayloadHash(payload),
        packConfigurationFingerprint: fingerprint,
      });
      expect(body.results?.[0].resultCode).toBe("TARGET_ARCHIVED");
    });

    it("reports VALIDATION_REJECTED for an out-of-bounds trait value, end to end", async () => {
      const fingerprint = await currentConfigFingerprint();
      const payload = {
        phenotypeId: ids.phenotype,
        evaluationDate: "2026-11-10",
        values: { plant_height: 9999 },
        notes: null,
      };
      const { body } = await syncOne(undefined, {
        operationId: randomUUID(),
        operationType: "PHENOTYPE_TRAIT_EVALUATION",
        programId: ids.program,
        phenotypeId: payload.phenotypeId,
        evaluationDate: payload.evaluationDate,
        values: payload.values,
        notes: payload.notes,
        payloadHash: await computePayloadHash(payload),
        packConfigurationFingerprint: fingerprint,
      });
      expect(body.results?.[0].resultCode).toBe("VALIDATION_REJECTED");
    });

    it("rejects a batch exceeding the bounded operation count", async () => {
      const fingerprint = await currentConfigFingerprint();
      const operations = await Promise.all(
        Array.from({ length: 26 }, async (_, i) => {
          const payload = {
            phenotypeId: ids.phenotype,
            evaluationDate: "2026-11-11",
            values: { plant_height: 100 + i },
            notes: null,
          };
          return {
            operationId: randomUUID(),
            operationType: "PHENOTYPE_TRAIT_EVALUATION",
            programId: ids.program,
            phenotypeId: payload.phenotypeId,
            evaluationDate: payload.evaluationDate,
            values: payload.values,
            notes: payload.notes,
            payloadHash: await computePayloadHash(payload),
            packConfigurationFingerprint: fingerprint,
          };
        }),
      );
      const response = await fetch(base + "/api/offline-sync", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookies },
        body: JSON.stringify({ operations }),
      });
      expect(response.status).toBe(400);
    });
  },
);
