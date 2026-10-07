import { describe, expect, it } from "vitest";
import { DEFAULT_RAIL_STYLE, isRailStyle, normalizeRailStyle, RAIL_STYLES } from "./railStyles";

describe("railStyles", () => {
  it("accepts only registered style ids", () => {
    for (const id of RAIL_STYLES) {
      expect(isRailStyle(id)).toBe(true);
    }
    expect(isRailStyle("squiggle")).toBe(false);
    expect(isRailStyle(null)).toBe(false);
    expect(isRailStyle(2)).toBe(false);
  });

  it("normalizes invalid values back to default", () => {
    expect(normalizeRailStyle("nope")).toBe(DEFAULT_RAIL_STYLE);
    expect(normalizeRailStyle(undefined)).toBe(DEFAULT_RAIL_STYLE);
    expect(normalizeRailStyle("dot")).toBe("dot");
    expect(normalizeRailStyle("ring")).toBe("ring");
  });

  it("defaults to the line style for backward compatibility", () => {
    expect(DEFAULT_RAIL_STYLE).toBe("line");
    expect(RAIL_STYLES).toContain(DEFAULT_RAIL_STYLE);
  });
});
