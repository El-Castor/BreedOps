#!/usr/bin/env node
// Single reproducible V1 release gate (docs/RELEASE_CHECKLIST.md).
//
// SAFETY: this script is intrinsically isolated from the canonical/retained
// BreedOps Supabase stack. Every child process it spawns runs with
// BREEDOPS_STACK_PROFILE=release-check, which every stack-aware script in
// this repo (scripts/db-start.mjs, db-stop.mjs, configure-local.mjs,
// test-rls.mjs, the integration tests, the e2e specs) reads via
// scripts/lib/stack-identity.mjs to resolve a project_id, API/DB ports,
// Docker container name, backend-config file, and app port that are all
// DIFFERENT from the canonical stack's (supabase/config.toml: project_id
// "BreedOps", ports 55421/55422). This script never calls `supabase db
// reset`, `supabase stop --no-backup`, or any Docker command against the
// canonical project; it only ever touches its own disposable
// ".release-check/" workdir and the "BreedOpsReleaseCheck" project. The
// canonical stack may be running before, during, and after this script
// runs - nothing here reads, starts, stops, or mutates it.
//
// A fail-closed guard (assertDisposableBackendIsSafe, below) re-derives the
// live identity after the disposable stack starts and refuses to continue
// if it is not genuinely distinct from the canonical one - this does not
// rely on comments or operator discipline alone.
//
// Runs every check this milestone's release audit calls for, against the
// disposable stack it starts and stops itself. Exits non-zero if any step
// fails, and never silently skips a step without saying so in the final
// summary - a step marked SKIPPED is always visible, never hidden among
// PASS results.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  CANONICAL,
  RELEASE_CHECK,
  assertStatusMatchesProfile,
} from "./lib/stack-identity.mjs";

const steps = [];

// Every child process spawned by this script resolves the disposable
// "release-check" profile, never the default "canonical" one.
const baseEnv = { ...process.env, BREEDOPS_STACK_PROFILE: "release-check" };

function run(name, command, args, options = {}) {
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    env: baseEnv,
    ...options,
  });
  const passed = result.status === 0;
  steps.push({ name, passed: passed ? "PASS" : "FAIL" });
  if (!passed) {
    console.error(`\n!!! ${name} failed (exit code ${result.status}) !!!`);
  }
  return passed;
}

function skip(name, reason) {
  console.log(`\n=== ${name} (SKIPPED: ${reason}) ===`);
  steps.push({ name, passed: `SKIPPED (${reason})` });
}

const npm = (script, args = [], options = {}) =>
  run(script, "npm", ["run", script, ...args], options);

// Fail-closed safety check, independent of (in addition to) the same guard
// already enforced inside scripts/configure-local.mjs: re-reads the
// disposable stack's own recorded identity from disk and refuses to
// proceed unless it is genuinely the release-check project, never the
// canonical one. Called before any destructive/test step runs against the
// stack.
function assertDisposableBackendIsSafe() {
  const backend = JSON.parse(readFileSync(RELEASE_CHECK.backendFile, "utf8"));
  assertStatusMatchesProfile(backend, RELEASE_CHECK);
  console.log(
    `Release-check safety guard: confirmed disposable Supabase stack at ${backend.API_URL} ` +
      `(project "${RELEASE_CHECK.projectId}"), distinct from the canonical stack at ${CANONICAL.apiUrl}.`,
  );
  return backend;
}

let stackStarted = false;
let appStarted = false;
let fatal = false;

try {
  // Static checks first - fast, no database needed, catch the cheapest
  // failures before paying for a Supabase stack startup. (The
  // client-secret scan runs later, after `build`, since it scans the
  // production bundle that step produces.)
  if (!npm("typecheck")) fatal = true;
  if (!fatal && !npm("lint")) fatal = true;
  if (!fatal && !npm("format:check")) fatal = true;

  if (!fatal && !run("unit tests", "npm", ["run", "test:unit"])) fatal = true;

  if (!fatal) {
    run(
      "start disposable release-check Supabase stack (own project_id/ports/container/volume, migrations 000001 -> latest from zero)",
      "npm",
      ["run", "db:start"],
    );
    stackStarted = true;

    let backend;
    if (!npm("local:configure")) {
      fatal = true;
    } else {
      backend = assertDisposableBackendIsSafe();
    }

    const dbSuites = [
      ["test:rls", "auth RLS"],
      ["test:identity", "breeding identity/lifecycle"],
      ["test:phenotyping", "phenotype configuration"],
      ["test:media", "plant media"],
      ["test:workflows", "experimental workflows"],
      ["test:import-export", "import/export"],
      ["test:business-completion", "business completion (seed lots, eliminatory criteria, inventory coverage)"],
      ["test:auth-rate-limiting", "login rate limiting"],
      ["test:audit-logs-cleanup", "audit_logs cleanup trigger regression"],
    ];
    if (!fatal) {
      for (const [script] of dbSuites) {
        if (!npm(script)) fatal = true;
      }
      if (fatal) console.error(`\n!!! A database suite failed against the disposable release-check stack !!!`);
    } else {
      for (const [, label] of dbSuites) skip(label, "local:configure / safety guard failed");
    }

    // The disposable stack's URL/keys and app origin are passed as
    // explicit process env vars to `build`/the integration & e2e test
    // runners below - never written to .env.local, so this never risks
    // overwriting a developer's real local dev configuration.
    const appEnv = !fatal
      ? {
          ...baseEnv,
          NEXT_PUBLIC_SUPABASE_URL: backend.API_URL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: backend.ANON_KEY,
          SUPABASE_SERVICE_ROLE_KEY: backend.SERVICE_ROLE_KEY,
          APP_ORIGIN: RELEASE_CHECK.appOrigin,
          ALLOW_SELF_SIGNUP: "false",
        }
      : baseEnv;

    if (fatal) {
      skip("build", "an earlier step failed");
      skip("client-secret scan", "an earlier step failed");
    } else {
      if (!npm("build", [], { env: appEnv })) fatal = true;
      if (!fatal) {
        if (!npm("security:client-secrets", [], { env: appEnv })) fatal = true;
      } else {
        skip("client-secret scan", "build failed");
      }
    }

    if (fatal) {
      skip("start built app server", "an earlier step failed");
      skip("integration tests", "an earlier step failed");
    } else {
      // The integration suites (tests/*.integration.test.ts) make real
      // HTTP requests against a running server and have no self-starting
      // logic of their own, unlike e2e/*.spec.ts which Playwright can
      // start itself. appStarted is set before the attempt, not after, so
      // the finally block below still tries to stop it even if the
      // readiness check times out and the process is left orphaned.
      appStarted = true;
      if (!npm("app:start", [], { env: appEnv })) fatal = true;

      if (!fatal) {
        const integrationSuites = [
          ["test:auth", "auth integration"],
          ["test:breeding", "breeding integration"],
          ["test:phenotypes", "phenotypes integration"],
          ["test:inventory", "inventory integration"],
          ["test:operations", "operations integration"],
        ];
        for (const [script] of integrationSuites) {
          if (!npm(script, [], { env: appEnv })) fatal = true;
        }
      } else {
        skip("integration tests", "the app server failed to start");
      }
    }

    if (!fatal) {
      // Covers the critical user journey plus the accessibility and
      // responsive smoke specs (e2e/accessibility-smoke.spec.ts,
      // e2e/responsive-smoke.spec.ts) - same command as a developer runs,
      // but against the disposable stack's own app port.
      if (!npm("test:e2e", [], { env: appEnv })) fatal = true;
    } else {
      skip("end-to-end tests", "an earlier step failed");
    }
  } else {
    skip("database suite", "a static/unit check failed");
    skip("build", "a static/unit check failed");
    skip("client-secret scan", "a static/unit check failed");
    skip("start built app server", "a static/unit check failed");
    skip("integration tests", "an earlier step failed");
    skip("end-to-end tests", "an earlier step failed");
  }
} finally {
  if (appStarted) {
    // Always runs, even if an earlier step failed or the readiness check
    // timed out and left the process running. Stops only the app process
    // this run itself started (scripts/stop-app.mjs signals its own
    // tracked PID/process group), never anything else listening on a
    // developer's machine.
    run("stop built app server", "npm", ["run", "app:stop"]);
  }
  if (stackStarted) {
    // Always runs, even if an earlier step failed. Stops and fully
    // discards the disposable project's container and volume (see
    // scripts/db-stop.mjs) - never the canonical stack, which this script
    // never references.
    run(
      "stop disposable release-check Supabase stack (discards its container/volume entirely)",
      "npm",
      ["run", "db:stop"],
    );
  }
}

console.log("\n\n================ RELEASE CHECK SUMMARY ================");
let allPassed = true;
for (const step of steps) {
  console.log(`${step.passed.toString().padEnd(20)} ${step.name}`);
  if (step.passed === "FAIL") allPassed = false;
}
console.log("=========================================================\n");

if (!allPassed) {
  console.error("RELEASE CHECK: FAIL — see above.");
  process.exit(1);
}
console.log("RELEASE CHECK: PASS");
