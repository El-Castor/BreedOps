import { describe, expect, it, vi } from "vitest";
import { collectionState } from "../src/lib/query-state";

describe("collection query states", () => {
  it("keeps empty data distinct from backend failure", () => {
    expect(collectionState({ data: [], error: null }, "failure")).toEqual({
      status: "empty",
      data: [],
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      collectionState(
        { data: null, error: { message: "private detail" } },
        "Impossible de charger les croisements.",
      ),
    ).toEqual({
      status: "error",
      data: [],
      message: "Impossible de charger les croisements.",
    });
  });
});
