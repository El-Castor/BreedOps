import { describe, expect, it } from "vitest";
import { validateAnnotationGeometry } from "../src/lib/media/annotation-validation";

describe("validateAnnotationGeometry", () => {
  it("accepts a point within bounds with no label", () => {
    expect(
      validateAnnotationGeometry({
        annotationType: "point",
        x: 0.5,
        y: 0.5,
        width: null,
        height: null,
        label: null,
      }),
    ).toEqual({ ok: true });
  });

  it("accepts a rectangle that exactly touches the far edge", () => {
    expect(
      validateAnnotationGeometry({
        annotationType: "rectangle",
        x: 0.5,
        y: 0.5,
        width: 0.5,
        height: 0.5,
        label: null,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a rectangle extending past the right edge", () => {
    const result = validateAnnotationGeometry({
      annotationType: "rectangle",
      x: 0.6,
      y: 0.1,
      width: 0.5,
      height: 0.1,
      label: null,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a rectangle extending past the bottom edge", () => {
    const result = validateAnnotationGeometry({
      annotationType: "rectangle",
      x: 0.1,
      y: 0.6,
      width: 0.1,
      height: 0.5,
      label: null,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a rectangle missing its width/height", () => {
    const result = validateAnnotationGeometry({
      annotationType: "rectangle",
      x: 0.1,
      y: 0.1,
      width: null,
      height: null,
      label: null,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a point that declares a width", () => {
    const result = validateAnnotationGeometry({
      annotationType: "point",
      x: 0.1,
      y: 0.1,
      width: 0.1,
      height: null,
      label: null,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a text annotation with no label", () => {
    const result = validateAnnotationGeometry({
      annotationType: "text",
      x: 0.1,
      y: 0.1,
      width: null,
      height: null,
      label: null,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a text annotation with a blank label", () => {
    const result = validateAnnotationGeometry({
      annotationType: "text",
      x: 0.1,
      y: 0.1,
      width: null,
      height: null,
      label: "   ",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a text annotation with a real label", () => {
    expect(
      validateAnnotationGeometry({
        annotationType: "text",
        x: 0.1,
        y: 0.1,
        width: null,
        height: null,
        label: "Observation libre",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a coordinate outside [0,1]", () => {
    const result = validateAnnotationGeometry({
      annotationType: "point",
      x: 1.2,
      y: 0.1,
      width: null,
      height: null,
      label: null,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a negative coordinate", () => {
    const result = validateAnnotationGeometry({
      annotationType: "point",
      x: -0.1,
      y: 0.1,
      width: null,
      height: null,
      label: null,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a label over 300 characters", () => {
    const result = validateAnnotationGeometry({
      annotationType: "point",
      x: 0.1,
      y: 0.1,
      width: null,
      height: null,
      label: "x".repeat(301),
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a label at exactly 300 characters", () => {
    expect(
      validateAnnotationGeometry({
        annotationType: "point",
        x: 0.1,
        y: 0.1,
        width: null,
        height: null,
        label: "x".repeat(300),
      }),
    ).toEqual({ ok: true });
  });
});
