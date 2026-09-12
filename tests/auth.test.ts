import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: {
    id: "22222222-0000-0000-0000-000000000001",
    email: "fixture@example.test",
  } as { id: string; email: string } | null,
  role: "user",
  profile: true,
  team: true,
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("../src/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        maybeSingle: async () => ({
          data:
            table === "profiles"
              ? state.profile
                ? {
                    id: "33333333-0000-0000-0000-000000000001",
                    user_id: state.user?.id,
                    organization_id: "11111111-0000-0000-0000-000000000001",
                    role: state.role,
                    display_name: null,
                  }
                : null
              : state.team
                ? {
                    id: "11111111-0000-0000-0000-000000000001",
                    name: "Test team",
                  }
                : null,
        }),
      };
      return query;
    },
  }),
}));

import { requireAdministrator, requireIdentity } from "../src/lib/auth";

describe("server identity and role boundary", () => {
  beforeEach(() => {
    state.user = {
      id: "22222222-0000-0000-0000-000000000001",
      email: "fixture@example.test",
    };
    state.role = "user";
    state.profile = true;
    state.team = true;
  });
  it("rejects an anonymous request", async () => {
    state.user = null;
    await expect(requireIdentity()).rejects.toThrow("REDIRECT:/login");
  });
  it("rejects an authenticated account without an active profile", async () => {
    state.profile = false;
    await expect(requireIdentity()).rejects.toThrow("membership");
  });
  it("rejects missing or deleted team membership", async () => {
    state.team = false;
    await expect(requireIdentity()).rejects.toThrow("membership");
  });
  it("rejects roles outside the accepted V1 model", async () => {
    state.role = "viewer";
    await expect(requireIdentity()).rejects.toThrow("membership");
  });
  it("allows ordinary identity but rejects administrative access", async () => {
    expect((await requireIdentity()).profile.role).toBe("user");
    await expect(requireAdministrator()).rejects.toThrow("Forbidden");
  });
  it.each(["team_admin", "system_admin"])(
    "allows %s administrative access",
    async (role) => {
      state.role = role;
      expect((await requireAdministrator()).profile.role).toBe(role);
    },
  );
});
