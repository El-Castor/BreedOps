import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/auth", () => ({ requireIdentity: vi.fn() }));
vi.mock("../src/lib/media/storage", () => ({
  buildMediaStoragePath: vi.fn(),
  uploadMediaObject: vi.fn(),
  removeMediaObject: vi.fn(),
  createMediaSignedUrl: vi.fn(),
}));

import { requireIdentity } from "../src/lib/auth";
import {
  buildMediaStoragePath,
  removeMediaObject,
  uploadMediaObject,
} from "../src/lib/media/storage";
import { initialActionState } from "../src/lib/action-state";
import { uploadMedia } from "../src/lib/media/actions";

const targetId = "11111111-1111-4111-8111-111111111111";
const storagePath = "org/org-1/program/none/parent-line/target-1/media-1.png";

// The first 8 bytes are a real PNG signature; sniffImageMimeType only looks
// at the magic bytes, so the rest of the payload can be arbitrary filler.
const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
]);
const textBytes = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);

function buildForm(bytes: Uint8Array, mime = "image/png") {
  const form = new FormData();
  form.set("target_type", "parent_line");
  form.set("target_id", targetId);
  form.set("caption", "");
  form.set("media_kind", "");
  form.set("captured_at", "");
  form.set("file", new File([bytes], "test.png", { type: mime }));
  return form;
}

function fakeClient(options: {
  targetRow: { id: string; deleted_at: string | null } | null;
  insertError?: unknown;
}) {
  return {
    from(table: string) {
      if (table === "media_assets")
        return { insert: vi.fn(async () => ({ error: options.insertError ?? null })) };
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: options.targetRow };
        },
      };
    },
  };
}

describe("Plant Media upload compensation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildMediaStoragePath).mockReturnValue({
      mediaId: "99999999-9999-4999-8999-999999999999",
      path: storagePath,
    });
  });

  it("deletes the uploaded storage object when the metadata insert fails (ORPHAN_STORAGE_PROTECTION)", async () => {
    vi.mocked(requireIdentity).mockResolvedValue({
      client: fakeClient({
        targetRow: { id: targetId, deleted_at: null },
        insertError: new Error("simulated insert failure"),
      }),
      profile: { organization_id: "org-1", id: "profile-1" },
    } as never);

    const result = await uploadMedia(initialActionState, buildForm(pngBytes));

    expect(result.status).toBe("error");
    expect(uploadMediaObject).toHaveBeenCalledWith(
      storagePath,
      expect.anything(),
      "image/png",
    );
    expect(removeMediaObject).toHaveBeenCalledWith(storagePath);
  });

  it("never removes the object when the insert succeeds", async () => {
    vi.mocked(requireIdentity).mockResolvedValue({
      client: fakeClient({ targetRow: { id: targetId, deleted_at: null } }),
      profile: { organization_id: "org-1", id: "profile-1" },
    } as never);

    const result = await uploadMedia(initialActionState, buildForm(pngBytes));

    expect(result.status).toBe("success");
    expect(uploadMediaObject).toHaveBeenCalledOnce();
    expect(removeMediaObject).not.toHaveBeenCalled();
  });

  it("blocks a new upload on an archived target before touching storage", async () => {
    vi.mocked(requireIdentity).mockResolvedValue({
      client: fakeClient({
        targetRow: { id: targetId, deleted_at: "2026-01-01T00:00:00Z" },
      }),
      profile: { organization_id: "org-1", id: "profile-1" },
    } as never);

    const result = await uploadMedia(initialActionState, buildForm(pngBytes));

    expect(result.status).toBe("error");
    expect(uploadMediaObject).not.toHaveBeenCalled();
    expect(removeMediaObject).not.toHaveBeenCalled();
  });

  it("rejects a file whose magic bytes are not JPEG, PNG or WebP before touching storage", async () => {
    vi.mocked(requireIdentity).mockResolvedValue({
      client: fakeClient({ targetRow: { id: targetId, deleted_at: null } }),
      profile: { organization_id: "org-1", id: "profile-1" },
    } as never);

    const result = await uploadMedia(
      initialActionState,
      buildForm(textBytes, "image/png"),
    );

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/format non pris en charge/i);
    expect(uploadMediaObject).not.toHaveBeenCalled();
  });
});
