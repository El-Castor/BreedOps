// Starts the already-built production app (`next start`) in the
// background, on the current profile's app port, and blocks until it
// answers /login (or the given timeout elapses). The integration Vitest
// suites (tests/*.integration.test.ts) make real HTTP requests against a
// running server and have no self-starting logic of their own, unlike
// e2e/*.spec.ts which Playwright can start itself via playwright.config.ts
// - this script is what makes `npm run test:auth` (etc.) meaningful to run
// standalone, and what scripts/release-check.mjs and CI use to start the
// disposable-profile app before running those suites.
//
// The spawned process is detached and its PID recorded in the current
// profile's appPidFile, for scripts/stop-app.mjs to stop later - this
// script itself does not wait for or own the process after startup.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { currentProfile } from "./lib/stack-identity.mjs";

const profile = currentProfile();
const url = `http://127.0.0.1:${profile.appPort}/login`;
const timeoutMs = Number(process.env.BREEDOPS_APP_START_TIMEOUT_MS ?? 60_000);

mkdirSync(".local", { recursive: true });

const child = spawn(
  "npm",
  ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(profile.appPort)],
  { stdio: "inherit", detached: true },
);
child.unref();
writeFileSync(profile.appPidFile, String(child.pid));
console.log(`Started app (pid ${child.pid}) for profile "${profile.name}", waiting for ${url} ...`);

const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  try {
    const response = await fetch(url);
    if (response.status) {
      console.log(`App is ready at ${url} (HTTP ${response.status}).`);
      process.exit(0);
    }
  } catch {
    // Not up yet - keep polling.
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
console.error(`App did not become ready at ${url} within ${timeoutMs}ms.`);
process.exit(1);
