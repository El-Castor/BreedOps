import { describe, expect, it } from "vitest";
// The Next.js config is deliberately plain ESM so the runtime can load it.
import config, { securityHeaders } from "../next.config.mjs";

describe("application security headers", () => {
  it("sets the required browser security boundaries on every route", async () => {
    const values = Object.fromEntries(
      securityHeaders.map((header: { key: string; value: string }) => [
        header.key,
        header.value,
      ]),
    );
    expect(values["Content-Security-Policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(values["Content-Security-Policy"]).toContain("connect-src 'self'");
    expect(values["X-Content-Type-Options"]).toBe("nosniff");
    expect(values["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(values["Strict-Transport-Security"]).toBeUndefined();
    expect(await config.headers!()).toEqual([
      { source: "/:path*", headers: securityHeaders },
    ]);
  });
});
