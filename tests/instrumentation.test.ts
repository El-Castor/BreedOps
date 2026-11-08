import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "../src/instrumentation";

const REQUIRED_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_ORIGIN",
];

function stubAllRequired() {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  for (const key of REQUIRED_KEYS) vi.stubEnv(key, `test-${key}`);
}

describe("production startup environment validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does nothing outside the Node.js runtime, even in production", async () => {
    stubAllRequired();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("APP_ORIGIN", "");
    await expect(register()).resolves.toBeUndefined();
  });

  it("does nothing outside production, even with variables missing", async () => {
    stubAllRequired();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_ORIGIN", "");
    await expect(register()).resolves.toBeUndefined();
  });

  it("throws in production when a required variable is missing", async () => {
    stubAllRequired();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "");
    await expect(register()).rejects.toThrow(/APP_ORIGIN/);
  });

  it("throws listing every missing variable, not just the first", async () => {
    stubAllRequired();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(register()).rejects.toThrow(
      /APP_ORIGIN.*SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY.*APP_ORIGIN/,
    );
  });

  it("does not throw in production when every required variable is set", async () => {
    stubAllRequired();
    vi.stubEnv("NODE_ENV", "production");
    await expect(register()).resolves.toBeUndefined();
  });
});
