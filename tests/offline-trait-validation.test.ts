import { describe, expect, it } from "vitest";
import { validateTraitValue } from "../src/lib/offline/trait-validation";
import type { OfflineTraitDefinition } from "../src/lib/offline/types";

function trait(
  overrides: Partial<OfflineTraitDefinition>,
): OfflineTraitDefinition {
  return {
    traitId: "t1",
    code: "t1",
    name: "Trait 1",
    description: null,
    category: "morphology",
    dataType: "numeric",
    unit: null,
    minimumValue: null,
    maximumValue: null,
    decimalPlaces: null,
    allowedValues: null,
    direction: null,
    targetValue: null,
    protocol: null,
    moduleId: "m1",
    moduleName: "Module 1",
    moduleOrder: 1,
    traitOrder: 1,
    ...overrides,
  };
}

describe("validateTraitValue", () => {
  it("treats an empty value as valid-but-absent (not every trait is required)", () => {
    const result = validateTraitValue(trait({}), "");
    expect(result.ok).toBe(true);
    expect(result.value).toBeUndefined();
  });

  it("validates numeric bounds", () => {
    const t = trait({
      dataType: "numeric",
      minimumValue: 0,
      maximumValue: 300,
    });
    expect(validateTraitValue(t, "150").ok).toBe(true);
    expect(validateTraitValue(t, "301").ok).toBe(false);
    expect(validateTraitValue(t, "-1").ok).toBe(false);
  });

  it("requires a whole number for integer/ordinal, but not numeric", () => {
    expect(validateTraitValue(trait({ dataType: "integer" }), "3.5").ok).toBe(
      false,
    );
    expect(validateTraitValue(trait({ dataType: "ordinal" }), "3.5").ok).toBe(
      false,
    );
    expect(validateTraitValue(trait({ dataType: "numeric" }), "3.5").ok).toBe(
      true,
    );
  });

  it("enforces decimal_places", () => {
    const t = trait({ dataType: "numeric", decimalPlaces: 1 });
    expect(validateTraitValue(t, "12.3").ok).toBe(true);
    expect(validateTraitValue(t, "12.34").ok).toBe(false);
  });

  it("validates boolean traits strictly as booleans", () => {
    const t = trait({ dataType: "boolean" });
    expect(validateTraitValue(t, true).ok).toBe(true);
    expect(validateTraitValue(t, "true").ok).toBe(false);
  });

  it("validates date format", () => {
    const t = trait({ dataType: "date" });
    expect(validateTraitValue(t, "2026-11-06").ok).toBe(true);
    expect(validateTraitValue(t, "06/11/2026").ok).toBe(false);
  });

  it("restricts categorical values to the allowed list", () => {
    const t = trait({
      dataType: "categorical",
      allowedValues: ["rose", "blanc"],
    });
    expect(validateTraitValue(t, "rose").ok).toBe(true);
    expect(validateTraitValue(t, "bleu").ok).toBe(false);
  });

  it("bounds free text length between 1 and 1000", () => {
    const t = trait({ dataType: "text" });
    expect(validateTraitValue(t, "Remarque").ok).toBe(true);
    expect(validateTraitValue(t, "a".repeat(1001)).ok).toBe(false);
  });
});
