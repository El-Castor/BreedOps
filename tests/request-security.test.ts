import { describe, expect, it } from "vitest";
import { sameOrigin } from "../src/lib/request-security";

describe("authentication CSRF boundary", () => {
  it("accepts the application's own origin", () => {
    process.env.APP_ORIGIN = "http://localhost:3107";
    expect(
      sameOrigin(
        new Request("http://127.0.0.1:3107/auth/login", {
          headers: { origin: "http://localhost:3107" },
        }),
      ),
    ).toBe(true);
  });
  it("rejects foreign and missing origins", () => {
    for (const headers of [
      new Headers({ origin: "https://attacker.example" }),
      new Headers(),
    ]) {
      expect(
        sameOrigin(
          new Request("http://127.0.0.1:3107/auth/logout", { headers }),
        ),
      ).toBe(false);
    }
  });
});
