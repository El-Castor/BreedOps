import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import { MET_MODEL_TYPES, type MetModelType } from "./r-model-types";

export { MET_MODEL_TYPES, type MetModelType };

const ANALYTICS_R_DIR = path.join(process.cwd(), "analytics-r");
const R_SCRIPT_RELATIVE_PATH = "scripts/met_models.R";

/** Defense-in-depth mirror of met_models.R's own `MAX_ROWS` guard - failing
 * fast here avoids paying for a spawn that the script would only reject
 * anyway, and keeps this wrapper correct even if it is ever called from a
 * path other than the dataset builder's own (smaller) cap. */
const MAX_ROWS = 50000;
const DEFAULT_TIMEOUT_MS = 120_000;
/** Generous for any MET model result this script produces, but never
 * unbounded: a runaway or compromised R process must not be able to
 * exhaust server memory by writing arbitrarily large stdout. */
const MAX_STDOUT_BYTES = 10 * 1024 * 1024;

export type MetModelRow = {
  entry_id: string;
  environment_id: string;
  block?: string | null;
  value: number;
};

export type MetModelOptions = {
  performance_weight?: number;
};

export type MetModelFailure = {
  status: "error" | "not_estimable" | "dataset_too_large";
  message: string;
};

export type MetModelResult<T> = { status: "ok"; data: T } | MetModelFailure;

const failureSchema = z.object({
  status: z.enum(["error", "not_estimable", "dataset_too_large"]),
  message: z.string(),
});

const engineSchema = z.object({
  engine_name: z.string(),
  engine_version: z.string(),
  r_version: z.string(),
  sommer_version: z.string().optional(),
  metan_version: z.string().optional(),
});

const varianceComponentSchema = z
  .object({ estimate: z.number(), term: z.string() })
  .nullable();

const metBaseOkSchema = z.object({
  status: z.literal("ok"),
  engine: engineSchema,
  model: z.object({
    model_type: z.literal("met_base_v1"),
    formula_fixed: z.string(),
    formula_random: z.string(),
    n_observations: z.number(),
    n_entries: z.number(),
    n_environments: z.number(),
    block_effect_estimable: z.boolean(),
    convergence: z.literal(true),
    aic: z.number(),
    bic: z.number(),
    log_lik: z.number(),
  }),
  /** Entry×Environment variance and residual variance are not separately
   * identifiable with exactly one observation per cell (B-review blocker
   * #2) - met_models.R refuses to even fit the model when
   * replicated_cells === 0, so by the time this schema matches, at least
   * one cell has 2+ observations. replicated_cells < populated_cells
   * still means the split relies on fewer cells than the full design;
   * callers show this, never hide it. */
  replication: z.object({
    populated_cells: z.number(),
    total_observations: z.number(),
    replicated_cells: z.number(),
  }),
  variance_components: z.object({
    entry: varianceComponentSchema,
    entry_x_environment: varianceComponentSchema,
    block_environment: varianceComponentSchema,
    residual: varianceComponentSchema,
  }),
  fixed_effects_environment: z.array(
    z.object({ level: z.string(), estimate: z.number(), se: z.number() }),
  ),
  entry_predictions: z.array(
    z.object({ entry_id: z.string(), blup: z.number(), se: z.number() }),
  ),
  entry_environment_predictions: z.array(
    z.object({
      entry_id: z.string(),
      environment_id: z.string(),
      effect: z.number(),
      se: z.number(),
    }),
  ),
});
export type MetBaseModelResult = z.infer<typeof metBaseOkSchema>;

const metAmmiOkSchema = z.object({
  status: z.literal("ok"),
  engine: engineSchema,
  model: z.object({
    model_type: z.literal("met_ammi_v1"),
    n_observations: z.number(),
    n_entries: z.number(),
    n_environments: z.number(),
    /** metan::performs_ammi() does not exclude a missing Entry×Environment
     * cell - it imputes it (EM-SVD) before fitting. Always reported (0
     * when complete) so this is never silent (B40). */
    missing_cells_imputed: z.number(),
  }),
  principal_components: z.array(
    z.object({
      component: z.string(),
      variance_explained_pct: z.number(),
      cumulative_pct: z.number(),
    }),
  ),
  genotype_scores: z.array(
    z.object({
      entry_id: z.string(),
      mean: z.number(),
      pc1: z.number(),
      pc2: z.number().nullable().optional(),
    }),
  ),
  environment_scores: z.array(
    z.object({
      environment_id: z.string(),
      mean: z.number(),
      pc1: z.number(),
      pc2: z.number().nullable().optional(),
    }),
  ),
});
export type MetAmmiModelResult = z.infer<typeof metAmmiOkSchema>;

const metWaasbOkSchema = z.object({
  status: z.literal("ok"),
  engine: engineSchema,
  model: z.object({
    model_type: z.literal("met_waasb_v1"),
    n_observations: z.number(),
    n_entries: z.number(),
    n_environments: z.number(),
    performance_weight: z.number(),
    stability_weight: z.number(),
  }),
  entries: z.array(
    z.object({
      entry_id: z.string(),
      mean_performance: z.number(),
      waasb: z.number(),
      waasby: z.number(),
      performance_percentile: z.number(),
      stability_percentile: z.number(),
    }),
  ),
});
export type MetWaasbModelResult = z.infer<typeof metWaasbOkSchema>;

const metFinlayWilkinsonOkSchema = z.object({
  status: z.literal("ok"),
  engine: engineSchema,
  model: z.object({
    model_type: z.literal("met_finlay_wilkinson_v1"),
    n_observations: z.number(),
    n_entries: z.number(),
    n_environments: z.number(),
  }),
  entries: z.array(
    z.object({
      entry_id: z.string(),
      intercept: z.number(),
      /** Responsiveness to the environmental index. 1 is average
       * responsiveness (Eberhart & Russell's own reference value) - this
       * is deliberately not centered on 0 the way an ordinary regression
       * slope would be. */
      slope: z.number(),
      slope_t_stat: z.number(),
      /** p-value for H0: slope == 1 (not slope == 0). */
      slope_p_value: z.number(),
      /** Eberhart & Russell's deviation-from-regression variance (s2di) -
       * the stability measure proper, independent of the slope. */
      deviation_variance: z.number(),
      deviation_f_stat: z.number(),
      deviation_p_value: z.number(),
      rmse: z.number(),
      r_squared: z.number(),
    }),
  ),
});
export type MetFinlayWilkinsonModelResult = z.infer<
  typeof metFinlayWilkinsonOkSchema
>;

const metGgeOkSchema = z.object({
  status: z.literal("ok"),
  engine: engineSchema,
  model: z.object({
    model_type: z.literal("met_gge_v1"),
    n_observations: z.number(),
    n_entries: z.number(),
    n_environments: z.number(),
    centering: z.string(),
    scaling: z.string(),
    svp: z.string(),
    /** metan::gge() does not exclude a missing Entry×Environment cell -
     * it imputes it (EM-SVD) before the SVD biplot. Always reported (0
     * when complete) so this is never silent (B40). */
    missing_cells_imputed: z.number(),
  }),
  grand_mean: z.number(),
  principal_components: z.array(
    z.object({
      component: z.string(),
      eigenvalue: z.number(),
      variance_explained_pct: z.number(),
    }),
  ),
  genotype_scores: z.array(
    z.object({
      entry_id: z.string(),
      mean: z.number(),
      coordinates: z.array(z.number()),
    }),
  ),
  environment_scores: z.array(
    z.object({
      environment_id: z.string(),
      mean: z.number(),
      coordinates: z.array(z.number()),
    }),
  ),
});
export type MetGgeModelResult = z.infer<typeof metGgeOkSchema>;

/** Spawns `Rscript analytics-r/scripts/met_models.R <model_type>`, feeds it
 * one JSON request body on stdin, and returns the raw parsed JSON response
 * (not yet validated against a specific model's success schema - callers
 * below do that). Never spawns a shell and never interpolates `rows`/
 * `options` into a command string: the entire request travels as a single
 * JSON payload over stdin, exactly like analytics-r's own reference tests
 * invoke it. */
async function invokeMetScript(
  modelType: MetModelType,
  body: { rows: MetModelRow[]; options?: MetModelOptions },
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  if (!MET_MODEL_TYPES.includes(modelType)) {
    throw new Error(`Unknown MET model_type: ${String(modelType)}`);
  }
  if (body.rows.length === 0) {
    throw new Error("invokeMetScript called with zero rows.");
  }
  if (body.rows.length > MAX_ROWS) {
    return {
      status: "dataset_too_large",
      message: `Dataset exceeds the supported size (${MAX_ROWS} rows).`,
    };
  }

  const requestBody = JSON.stringify({ model_type: modelType, ...body });

  return new Promise<unknown>((resolve, reject) => {
    const child = spawn("Rscript", [R_SCRIPT_RELATIVE_PATH, modelType], {
      cwd: ANALYTICS_R_DIR,
      env: {
        ...process.env,
        // REQUIRED - see met_models.R's header comment: a parse-time
        // locale issue, not fixable from inside the R script itself.
        LC_ALL: "C.UTF-8",
        LANG: "C.UTF-8",
        RENV_CONFIG_STARTUP_QUIET: "TRUE",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
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
              `MET R engine exceeded the maximum output size (${MAX_STDOUT_BYTES} bytes).`,
            ),
          ),
        );
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      finish(() => reject(err));
    });

    child.on("close", (code) => {
      finish(() => {
        if (timedOut) {
          reject(new Error(`MET R engine timed out after ${timeoutMs}ms.`));
          return;
        }
        if (code !== 0) {
          // met_models.R's own fail() always exits 0 with a structured JSON
          // error body - a non-zero exit means the process itself crashed
          // (missing Rscript, renv restore failure, OOM kill, ...), which
          // is an internal condition never shown verbatim to the client.
          console.error(
            `MET R engine exited with code ${code}. stderr:\n${stderr}`,
          );
          reject(new Error("The MET statistical engine failed to run."));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          console.error(`MET R engine produced non-JSON stdout:\n${stdout}`);
          reject(
            new Error(
              "The MET statistical engine returned an invalid response.",
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
): MetModelResult<T> {
  const ok = okSchema.safeParse(raw);
  if (ok.success) return { status: "ok", data: ok.data };
  const failure = failureSchema.safeParse(raw);
  if (failure.success) return failure.data;
  console.error(
    "MET R engine response matched neither the success nor the error schema:",
    raw,
  );
  return {
    status: "error",
    message: "The MET statistical engine returned an unrecognized response.",
  };
}

export async function runMetBaseModel(
  rows: MetModelRow[],
  timeoutMs?: number,
): Promise<MetModelResult<MetBaseModelResult>> {
  const raw = await invokeMetScript("met_base_v1", { rows }, timeoutMs);
  return toModelResult(raw, metBaseOkSchema);
}

export async function runMetAmmiModel(
  rows: MetModelRow[],
  timeoutMs?: number,
): Promise<MetModelResult<MetAmmiModelResult>> {
  const raw = await invokeMetScript("met_ammi_v1", { rows }, timeoutMs);
  return toModelResult(raw, metAmmiOkSchema);
}

export async function runMetWaasbModel(
  rows: MetModelRow[],
  performanceWeight: number,
  timeoutMs?: number,
): Promise<MetModelResult<MetWaasbModelResult>> {
  const raw = await invokeMetScript(
    "met_waasb_v1",
    { rows, options: { performance_weight: performanceWeight } },
    timeoutMs,
  );
  return toModelResult(raw, metWaasbOkSchema);
}

export async function runMetFinlayWilkinsonModel(
  rows: MetModelRow[],
  timeoutMs?: number,
): Promise<MetModelResult<MetFinlayWilkinsonModelResult>> {
  const raw = await invokeMetScript(
    "met_finlay_wilkinson_v1",
    { rows },
    timeoutMs,
  );
  return toModelResult(raw, metFinlayWilkinsonOkSchema);
}

export async function runMetGgeModel(
  rows: MetModelRow[],
  timeoutMs?: number,
): Promise<MetModelResult<MetGgeModelResult>> {
  const raw = await invokeMetScript("met_gge_v1", { rows }, timeoutMs);
  return toModelResult(raw, metGgeOkSchema);
}
