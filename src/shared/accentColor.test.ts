import { describe, expect, it } from "vitest";
import {
  accentTextTone,
  normalizeAccentColor,
  normalizeSystemAccentColor,
  resolveAccentColor,
} from "./accentColor";

describe("normalizeAccentColor", () => {
  it("preserves the system preference through persistence normalization", () => {
    const saved = JSON.parse(JSON.stringify({ accentColor: normalizeAccentColor("system") }));
    expect(normalizeAccentColor(saved.accentColor)).toBe("system");
  });
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

describe("system accent color", () => {
  it("reads Electron RGBA in the correct byte order and ignores alpha", () => {
    expect(normalizeSystemAccentColor("D24726FF")).toBe("#d24726");
    expect(normalizeSystemAccentColor("0078d400")).toBe("#0078d4");
    for (const value of [null, undefined, "", "0078d4", "#0078d4ff", "invalid!", 123]) {
      expect(normalizeSystemAccentColor(value)).toBeNull();
    }
  });

  it("follows system changes only when selected, with a default fallback", () => {
    expect(resolveAccentColor("system", "#0078d4")).toBe("#0078d4");
    expect(resolveAccentColor("system", "#e5484d")).toBe("#e5484d");
    expect(resolveAccentColor("#8b5cf6", "#e5484d")).toBe("#8b5cf6");
    expect(resolveAccentColor(null, "#e5484d")).toBeNull();
    expect(resolveAccentColor("system", null)).toBeNull();
    expect(resolveAccentColor("system", "system")).toBeNull();
  });

  it("keeps foreground text readable for light, dark and midtone system colors", () => {
    expect(accentTextTone("#ffff00")).toBe("dark");
    expect(accentTextTone("#ffffff")).toBe("dark");
    expect(accentTextTone("#000000")).toBe("light");
    expect(accentTextTone("#003366")).toBe("light");
    expect(accentTextTone("#808080")).toBe("dark");
  });
});
