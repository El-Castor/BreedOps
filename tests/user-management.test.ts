import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/auth", () => ({ requireAdministrator: vi.fn() }));
vi.mock("../src/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { requireAdministrator } from "../src/lib/auth";
import { createAdminClient } from "../src/lib/supabase/admin";
import { resetManagedUserPassword } from "../src/lib/user-management";

const actorId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";

function profileQuery() {
  return {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    async single() {
      return {
        data: { organization_id: organizationId, role: "user" },
        error: null,
      };
    },
  };
}

describe("administrator password reset consistency", () => {
  const rpc = vi.fn();
  const updateUserById = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdministrator).mockResolvedValue({
      user: { id: actorId },
      profile: {
        id: actorId,
        user_id: actorId,
        organization_id: organizationId,
        role: "system_admin",
        display_name: "Admin",
      },
      client: { rpc },
      team: { id: organizationId, name: "Team" },
    } as never);
    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { updateUserById } },
      from: () => profileQuery(),
    } as never);
  });

  it("never records success when the password update fails", async () => {
    updateUserById.mockResolvedValueOnce({
      error: { message: "auth unavailable" },
    });
    await expect(
      resetManagedUserPassword({ userId: targetId, password: "ValidPass9!" }),
    ).rejects.toThrow("Réinitialisation impossible");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("audits only after success and disables the account if auditing fails", async () => {
    updateUserById
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ error: { message: "audit unavailable" } });
    await expect(
      resetManagedUserPassword({ userId: targetId, password: "ValidPass9!" }),
    ).rejects.toThrow("désactivé par sécurité");
    expect(updateUserById).toHaveBeenNthCalledWith(1, targetId, {
      password: "ValidPass9!",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(updateUserById).toHaveBeenNthCalledWith(2, targetId, {
      ban_duration: "876000h",
    });
  });
});
