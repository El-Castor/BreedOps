import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveIdentity } from "@/lib/auth";
import { computePayloadHash } from "@/lib/offline/payload-hash";
import type { OfflineSyncResultCode } from "@/lib/offline/types";

// Narrow, authenticated offline-sync endpoint (V2-07 §18). Never executes
// arbitrary SQL/RPC: the only mutation it is capable of triggering is the
// single allowlisted operation type below, through
// submit_offline_phenotype_evaluation() (migration 000035) - itself a thin
// idempotent wrapper around the existing submit_trait_evaluation(), never a
// divergent validation copy (§14). Uses the caller's own authenticated
// session throughout (resolveIdentity() -> the cookie-scoped Supabase
// client, RLS-enforced); the Supabase service-role key is never touched
// here.

// Deliberately bounded (§18: "Bound operations per request, request size,
// payload size, trait count") - a device with a large backlog simply calls
// this endpoint more than once; there is no reason a single HTTP request
// needs to carry more than this.
const MAX_OPERATIONS_PER_REQUEST = 25;
const MAX_REQUEST_BYTES = 512_000;
const MAX_TRAIT_VALUES_PER_OPERATION = 200;

const traitValueSchema = z.union([
  z.string().max(1000),
  z.number(),
  z.boolean(),
]);

const operationSchema = z.object({
  operationId: z.string().uuid(),
  operationType: z.literal("PHENOTYPE_TRAIT_EVALUATION"),
  programId: z.string().uuid(),
  phenotypeId: z.string().uuid(),
  evaluationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  values: z
    .record(z.string(), traitValueSchema)
    .refine((v) => Object.keys(v).length > 0, "au moins une valeur est requise")
    .refine(
      (v) => Object.keys(v).length <= MAX_TRAIT_VALUES_PER_OPERATION,
      "trop de traits pour une seule opération",
    ),
  notes: z.string().max(1000).nullable(),
  payloadHash: z.string().min(16).max(256),
  packConfigurationFingerprint: z.string().min(16).max(256),
});

const requestSchema = z.object({
  operations: z.array(operationSchema).min(1).max(MAX_OPERATIONS_PER_REQUEST),
});

interface OperationResult {
  operationId: string;
  resultCode: OfflineSyncResultCode;
  evaluationId?: string;
  replay?: boolean;
  message: string;
}

function rejected(
  operationId: string,
  resultCode: OfflineSyncResultCode,
  message: string,
): OperationResult {
  return { operationId, resultCode, message };
}

// submit_offline_phenotype_evaluation() (migration 000035) reports its
// structured outcomes as distinctly-prefixed RAISE EXCEPTION messages -
// the same convention the rest of this codebase's SQL functions already
// use (e.g. submit_trait_evaluation()'s 'Forbidden'/'Invalid evaluation
// payload'). Anything not matching a known prefix is treated as a
// retryable server-side failure rather than surfaced as if it were an
// authoritative business rejection.
function mapRpcErrorMessage(message: string): {
  resultCode: OfflineSyncResultCode;
  detail: string;
} {
  if (message.startsWith("PERMISSION_REVOKED")) {
    return { resultCode: "PERMISSION_REVOKED", detail: message };
  }
  if (message.startsWith("TARGET_NOT_FOUND")) {
    return { resultCode: "TARGET_NOT_FOUND", detail: message };
  }
  if (message.startsWith("TARGET_ARCHIVED")) {
    return { resultCode: "TARGET_ARCHIVED", detail: message };
  }
  if (message.startsWith("CONFIG_CHANGED")) {
    return { resultCode: "CONFIG_CHANGED", detail: message };
  }
  if (message.startsWith("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD")) {
    return { resultCode: "IDEMPOTENCY_PAYLOAD_MISMATCH", detail: message };
  }
  if (message.startsWith("VALIDATION_REJECTED")) {
    return { resultCode: "VALIDATION_REJECTED", detail: message };
  }
  return { resultCode: "RETRYABLE_SERVER_ERROR", detail: message };
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "REQUEST_TOO_LARGE" }, { status: 413 });
  }

  const identity = await resolveIdentity();
  if (!identity.ok) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }
  const { client } = identity;

  const rawBody = await request.text();
  if (rawBody.length > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "REQUEST_TOO_LARGE" }, { status: 413 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_REJECTED", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const results: OperationResult[] = [];
  for (const op of parsed.data.operations) {
    const canonicalPayload = {
      phenotypeId: op.phenotypeId,
      evaluationDate: op.evaluationDate,
      values: op.values,
      notes: op.notes,
    };

    // The browser-provided hash is never authoritative. Recompute the
    // canonical payload hash from the content the server actually received.
    const serverPayloadHash = await computePayloadHash(canonicalPayload);

    if (op.payloadHash !== serverPayloadHash) {
      results.push(
        rejected(
          op.operationId,
          "IDEMPOTENCY_PAYLOAD_MISMATCH",
          "Le contenu de l'opération ne correspond pas à son empreinte.",
        ),
      );
      continue;
    }

    // Resolve an already-committed operation before checking the current
    // configuration. This makes an acknowledgement-loss retry safe even
    // when the program configuration changed after the original commit.
    const { data: preflightData, error: preflightError } = await client.rpc(
      "preflight_offline_sync_operation",
      {
        p_operation_id: op.operationId,
        p_phenotype_id: op.phenotypeId,
        p_evaluation_date: op.evaluationDate,
        p_submitted_values: op.values,
        p_evaluation_notes: op.notes,
        p_payload_hash: serverPayloadHash,
      },
    );

    if (preflightError) {
      const { resultCode, detail } = mapRpcErrorMessage(preflightError.message);
      results.push(rejected(op.operationId, resultCode, detail));
      continue;
    }

    const preflight = preflightData as {
      result_code: "NEW" | "SYNCED";
      program_id: string;
      evaluation_id?: string;
      replay: boolean;
    };

    if (preflight.result_code === "SYNCED" && preflight.evaluation_id) {
      results.push({
        operationId: op.operationId,
        resultCode: "SYNCED",
        evaluationId: preflight.evaluation_id,
        replay: true,
        message: "Déjà synchronisé (nouvelle tentative sans effet).",
      });
      continue;
    }

    // programId supplied by the browser is only a consistency assertion.
    // The authoritative program is derived server-side from phenotype_id.
    if (op.programId !== preflight.program_id) {
      results.push(
        rejected(
          op.operationId,
          "VALIDATION_REJECTED",
          "Le programme déclaré ne correspond pas au phénotype ciblé.",
        ),
      );
      continue;
    }

    const { data, error } = await client.rpc(
      "submit_offline_phenotype_evaluation",
      {
        p_operation_id: op.operationId,
        p_phenotype_id: op.phenotypeId,
        p_evaluation_date: op.evaluationDate,
        p_submitted_values: op.values,
        p_evaluation_notes: op.notes,
        p_payload_hash: serverPayloadHash,
        p_pack_configuration_fingerprint: op.packConfigurationFingerprint,
      },
    );

    if (error) {
      const { resultCode, detail } = mapRpcErrorMessage(error.message);
      results.push(rejected(op.operationId, resultCode, detail));
      continue;
    }

    const payload = data as {
      result_code: string;
      evaluation_id: string;
      replay: boolean;
    };
    results.push({
      operationId: op.operationId,
      resultCode: "SYNCED",
      evaluationId: payload.evaluation_id,
      replay: payload.replay,
      message: payload.replay
        ? "Déjà synchronisé (nouvelle tentative sans effet)."
        : "Synchronisé.",
    });
  }

  return NextResponse.json({ results });
}
