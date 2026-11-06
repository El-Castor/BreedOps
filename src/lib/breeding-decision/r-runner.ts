import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import {
  SELECTION_MODEL_TYPES,
  type SelectionModelType,
} from "./r-model-types";
import { buildRSubprocessEnv } from "@/lib/met/r-env";

export { SELECTION_MODEL_TYPES, type SelectionModelType };

const ANALYTICS_R_DIR = path.join(process.cwd(), "analytics-r");
const R_SCRIPT_RELATIVE_PATH = "scripts/selection_models.R";

/** Mirrors src/lib/met/r-runner.ts's own caps exactly - same rationale:
 * defense-in-depth against a caller other than this module's own
 * (smaller) candidate-matrix cap, and against a runaway/compromised R
 * process exhausting server memory. */
const MAX_CANDIDATES = 5000;
const MAX_TRAITS = 100;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STDOUT_BYTES = 10 * 1024 * 1024;
const MAX_STDERR_BYTES = 1 * 1024 * 1024;

export type SelectionCandidateInput = { candidate_id: string };
export type SelectionTraitInput = {
  trait_id: string;
  direction: "higher_is_better" | "lower_is_better" | "target_value";
  target_value?: number | null;
  weight?: number | null;
  economic_weight?: number | null;
};
export type SelectionMatrixCellInput = {
  candidate_id: string;
  trait_id: string;
  value: number;
};
export type SelectionModelOptions = {
  selection_proportion: number;
};

export type SelectionModelFailure = {
  status: "error" | "not_estimable" | "dataset_too_large";
  message: string;
};
export type SelectionModelResult<T> =
  | { status: "ok"; data: T }
  | SelectionModelFailure;

const failureSchema = z.object({
  status: z.enum(["error", "not_estimable", "dataset_too_large"]),
  message: z.string(),
});

const engineSchema = z.object({
  engine_name: z.string(),
  engine_version: z.string(),
  r_version: z.string(),
  metan_version: z.string().optional(),
});

const mgidiOkSchema = z.object({
  status: z.literal("ok"),
  engine: engineSchema,
  model: z.object({
    model_type: z.literal("selection_mgidi_v1"),
    n_candidates: z.number(),
    n_traits: z.number(),
    selection_proportion: z.number(),
    n_factors_retained: z.number(),
    kmo: z.number(),
  }),
  candidates: z.array(
    z.object({
      candidate_id: z.string(),
      mgidi: z.number(),
      rank: z.number(),
      selected: z.boolean(),
    }),
  ),
  factor_loadings: z.array(
    z.object({
      trait_id: z.string(),
      factor: z.string(),
      loading: z.number(),
      communality: z.number(),
    }),
  ),
  factor_contributions: z.array(
    z.object({
      candidate_id: z.string(),
      factor: z.string(),
      contribution_pct: z.number(),
    }),
  ),
  pca: z.array(
    z.object({
      component: z.string(),
      eigenvalue: z.number(),
      variance_explained_pct: z.number(),
    }),
  ),
});
export type SelectionMgidiModelResult = z.infer<typeof mgidiOkSchema>;

/** Spawns `Rscript analytics-r/scripts/selection_models.R <model_type>`,
 * feeds it one JSON request body on stdin, returns the raw parsed JSON
 * response. Never spawns a shell, never interpolates request data into a
 * command string - the entire request travels as one JSON payload over
 * stdin, the exact pattern src/lib/met/r-runner.ts already established
 * and validated for V2-05. Reuses that module's own environment
 * allowlist (buildRSubprocessEnv) unchanged - never a second R-security
 * posture to keep in sync (task review §42). */
async function invokeSelectionScript(
  modelType: SelectionModelType,
  body: {
    candidates: SelectionCandidateInput[];
    traits: SelectionTraitInput[];
    matrix: SelectionMatrixCellInput[];
    options: SelectionModelOptions;
  },
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  if (!SELECTION_MODEL_TYPES.includes(modelType)) {
    throw new Error(`Unknown selection model_type: ${String(modelType)}`);
  }
  if (body.candidates.length === 0) {
    throw new Error("invokeSelectionScript called with zero candidates.");
  }
  if (body.candidates.length > MAX_CANDIDATES) {
    return {
      status: "dataset_too_large",
      message: `Dataset exceeds the supported size (${MAX_CANDIDATES} candidates).`,
    };
  }
  if (body.traits.length > MAX_TRAITS) {
    return {
      status: "dataset_too_large",
      message: `Dataset exceeds the supported size (${MAX_TRAITS} traits).`,
    };
  }

  const requestBody = JSON.stringify({ model_type: modelType, ...body });

  return new Promise<unknown>((resolve, reject) => {
    const child = spawn("Rscript", [R_SCRIPT_RELATIVE_PATH, modelType], {
      cwd: ANALYTICS_R_DIR,
      env: buildRSubprocessEnv(process.env),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    let stderrBytes = 0;
    let stderrTruncated = false;
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        child.kill("SIGKILL");
        finish(() =>
          reject(
            new Error(
              `Selection R engine exceeded the maximum output size (${MAX_STDOUT_BYTES} bytes).`,
            ),
          ),
        );
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) {
        stderrTruncated = true;
        return;
      }
      stderrBytes += chunk.length;
      stderr += chunk.toString("utf8");
      if (stderrBytes > MAX_STDERR_BYTES) {
        stderr = stderr.slice(0, MAX_STDERR_BYTES);
        stderrTruncated = true;
      }
    });

    child.on("error", (err) => {
      finish(() => reject(err));
    });

    child.on("close", (code) => {
      finish(() => {
        if (timedOut) {
          reject(
            new Error(`Selection R engine timed out after ${timeoutMs}ms.`),
          );
          return;
        }
        if (code !== 0) {
          console.error(
            `Selection R engine exited with code ${code}. stderr${stderrTruncated ? ` (truncated at ${MAX_STDERR_BYTES} bytes)` : ""}:\n${stderr}`,
          );
          reject(
            new Error(
              "The breeding-decision statistical engine failed to run.",
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          console.error(
            `Selection R engine produced non-JSON stdout:\n${stdout}`,
          );
          reject(
            new Error(
              "The breeding-decision statistical engine returned an invalid response.",
            ),
          );
        }
      });
    });

    child.stdin.write(requestBody);
    child.stdin.end();
  });
}

function toModelResult<T>(
  raw: unknown,
  okSchema: z.ZodType<T>,
): SelectionModelResult<T> {
  const ok = okSchema.safeParse(raw);
  if (ok.success) return { status: "ok", data: ok.data };
  const failure = failureSchema.safeParse(raw);
  if (failure.success) return failure.data;
  console.error(
    "Selection R engine response matched neither the success nor the error schema:",
    raw,
  );
  return {
    status: "error",
    message:
      "The breeding-decision statistical engine returned an unrecognized response.",
  };
}

export async function runSelectionMgidiModel(
  candidates: SelectionCandidateInput[],
  traits: SelectionTraitInput[],
  matrix: SelectionMatrixCellInput[],
  selectionProportion: number,
  timeoutMs?: number,
): Promise<SelectionModelResult<SelectionMgidiModelResult>> {
  const raw = await invokeSelectionScript(
    "selection_mgidi_v1",
    {
      candidates,
      traits,
      matrix,
      options: { selection_proportion: selectionProportion },
    },
    timeoutMs,
  );
  return toModelResult(raw, mgidiOkSchema);
}
