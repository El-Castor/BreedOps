import { defineConfig, devices } from "@playwright/test";
import { currentProfile } from "./scripts/lib/stack-identity.mjs";

// Defaults to the canonical dev app port (3107), unchanged for a normal
// `npm run test:e2e`. The release gate (npm run release:check) sets
// BREEDOPS_STACK_PROFILE=release-check so this points at the disposable
// stack's own app port instead, never colliding with a canonical server a
// developer may already have running.
const { appPort } = currentProfile();

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: { baseURL: `http://localhost:${appPort}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${appPort}`,
    url: `http://127.0.0.1:${appPort}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
