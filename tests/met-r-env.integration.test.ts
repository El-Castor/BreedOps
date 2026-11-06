// Real-subprocess regression test (B-review blocker #4): proves a
// synthetic sensitive env var set in THIS process is NOT visible to an
// actual Rscript child process spawned with buildRSubprocessEnv's
// filtered environment - the exact function src/lib/met/r-runner.ts's
// real spawn() call uses, not a parallel reimplementation. Separate from
// tests/met-r-env.test.ts (the pure-function unit tests, always run via
// `npm run test:unit`) because this one needs a real `Rscript` binary on
// PATH - same reason the analytics-r/tests/*.R reference suite is its
// own category, run via its own script, not folded into test:unit.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildRSubprocessEnv } from "../src/lib/met/r-env";

const SENTINEL_NAME = "BREEDOPS_TEST_SECRET_SENTINEL";
const SENTINEL_VALUE = "should-never-reach-the-r-subprocess";

const rscriptAvailable =
  spawnSync("Rscript", ["--version"], { stdio: "ignore" }).status === 0;

describe.skipIf(!rscriptAvailable)(
  "buildRSubprocessEnv against a real Rscript child process (B-review blocker #4)",
  () => {
    it("never exposes a synthetic sensitive env var to the R subprocess", () => {
      const sourceEnv = { ...process.env, [SENTINEL_NAME]: SENTINEL_VALUE };
      const filteredEnv = buildRSubprocessEnv(sourceEnv);
      const result = spawnSync(
        "Rscript",
        ["-e", `cat(Sys.getenv("${SENTINEL_NAME}"))`],
        { env: filteredEnv, encoding: "utf8" },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    });

    it("still lets R see an allowlisted name, proving the filter isn't just empty", () => {
      const sourceEnv = { ...process.env, PATH: process.env.PATH ?? "" };
      const filteredEnv = buildRSubprocessEnv(sourceEnv);
      const result = spawnSync(
        "Rscript",
        ["-e", 'cat(nchar(Sys.getenv("PATH")) > 0)'],
        { env: filteredEnv, encoding: "utf8" },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("TRUE");
    });
  },
);
