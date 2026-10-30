#!/usr/bin/env node
// Single reproducible V1 release gate (docs/RELEASE_CHECKLIST.md).
// Runs every check this milestone's release audit calls for, against a
// fresh local Supabase stack started and stopped by this script itself
// (never the retained/production database). Exits non-zero if any step
// fails, and never silently skips a step without saying so in the final
// summary - a step marked SKIPPED is always visible, never hidden among
// PASS results.
import { spawnSync } from "node:child_process";

const steps = [];

function run(name, command, args, options = {}) {
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
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

const npm = (script, args = []) => run(script, "npm", ["run", script, ...args]);

let stackStarted = false;
let fatal = false;

try {
  // Static checks first - fast, no database needed, catch the cheapest
  // failures before paying for a Supabase stack startup.
  if (!npm("typecheck")) fatal = true;
  if (!fatal && !npm("lint")) fatal = true;
  if (!fatal && !npm("format:check")) fatal = true;
  if (!fatal && !npm("security:client-secrets")) fatal = true;

  if (!fatal && !run("unit tests", "npm", ["run", "test:unit"])) fatal = true;

  if (!fatal) {
    run("start disposable Supabase stack (migrations 000001 -> latest from zero)", "npm", ["run", "db:start"]);
    stackStarted = true;

    const dbSuites = [
      ["test:rls", "auth RLS"],
      ["test:identity", "breeding identity/lifecycle"],
      ["test:phenotyping", "phenotype configuration"],
      ["test:media", "plant media"],
      ["test:workflows", "experimental workflows"],
      ["test:import-export", "import/export"],
      ["test:business-completion", "business completion (seed lots, eliminatory criteria, inventory coverage)"],
      ["test:auth-rate-limiting", "login rate limiting"],
    ];
    for (const [script, label] of dbSuites) {
      if (!npm(script)) {
        fatal = true;
      }
    }

    if (!fatal) {
      if (!npm("local:configure")) fatal = true;
    }
    if (!fatal && !npm("build")) fatal = true;

    if (!fatal) {
      const integrationSuites = [
        ["test:auth", "auth integration"],
        ["test:breeding", "breeding integration"],
        ["test:phenotypes", "phenotypes integration"],
        ["test:inventory", "inventory integration"],
        ["test:operations", "operations integration"],
      ];
      for (const [script] of integrationSuites) {
        if (!npm(script)) fatal = true;
      }
    }

    if (!fatal) {
      // Covers the critical user journey plus the accessibility and
      // responsive smoke specs (e2e/accessibility-smoke.spec.ts,
      // e2e/responsive-smoke.spec.ts) - same command as a developer runs.
      if (!npm("test:e2e")) fatal = true;
    } else {
      skip("end-to-end tests", "an earlier step failed");
    }
  } else {
    skip("database suite", "a static/unit check failed");
    skip("integration tests", "an earlier step failed");
    skip("end-to-end tests", "an earlier step failed");
  }
} finally {
  if (stackStarted) {
    run("stop disposable Supabase stack", "npm", ["run", "db:stop"]);
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
