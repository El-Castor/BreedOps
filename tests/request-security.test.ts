import { describe, expect, it } from "vitest";
import { sameOrigin } from "../src/lib/request-security";

describe("authentication CSRF boundary", () => {
  it("accepts the application's own origin", () => {
    expect(
      sameOrigin(
        new Request("http://localhost:3000/auth/login", {
          headers: { origin: "http://localhost:3000" },
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
          new Request("http://localhost:3000/auth/logout", { headers }),
        ),
      ).toBe(false);
    }
  });
});
