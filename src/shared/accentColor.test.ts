import { describe, expect, it } from "vitest";
import { normalizeAccentColor } from "./accentColor";

describe("normalizeAccentColor", () => {
  it("accepts lowercase and uppercase hex, normalizing to lowercase", () => {
    expect(normalizeAccentColor("#4a8cff")).toBe("#4a8cff");
    expect(normalizeAccentColor("#4A8CFF")).toBe("#4a8cff");
    expect(normalizeAccentColor("  #8b5cf6  ")).toBe("#8b5cf6");
  });

  it("falls back to null for missing, malformed or non-hex values", () => {
    expect(normalizeAccentColor(null)).toBeNull();
    expect(normalizeAccentColor(undefined)).toBeNull();
    expect(normalizeAccentColor("")).toBeNull();
    expect(normalizeAccentColor("blue")).toBeNull();
    expect(normalizeAccentColor("#12345")).toBeNull();
    expect(normalizeAccentColor("#1234567")).toBeNull();
    expect(normalizeAccentColor("rgb(74, 140, 255)")).toBeNull();
    expect(normalizeAccentColor(123456)).toBeNull();
  });
});
