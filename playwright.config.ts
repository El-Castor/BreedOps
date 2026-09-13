import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: { baseURL: "http://localhost:3107", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3107",
    url: "http://127.0.0.1:3107/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
