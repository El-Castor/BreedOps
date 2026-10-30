import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "../src/app/api/health/route";

const REQUIRED_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_ORIGIN",
];

describe("GET /api/health", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of REQUIRED_KEYS) {
      saved[key] = process.env[key];
      process.env[key] = `test-${key}`;
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("reports ok with 200 when fully configured", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("reports degraded with 503 when configuration is incomplete, without naming the missing key", async () => {
    delete process.env.APP_ORIGIN;
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ status: "degraded", reason: "configuration" });
    expect(JSON.stringify(body)).not.toContain("APP_ORIGIN");
  });

  it("never includes a connection string, hostname, or credential in its response", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const response = await GET();
    const text = JSON.stringify(await response.json());
    expect(text).not.toMatch(/postgres|supabase\.co|127\.0\.0\.1|eyJ/i);
  });
});
