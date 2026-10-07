import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_MONO_PRESET,
  DEFAULT_FONT_UI_PRESET,
  FONT_MONO_PRESETS,
  FONT_UI_PRESETS,
  isFontMonoPreset,
  isFontUiPreset,
  normalizeFontMonoPreset,
  normalizeFontUiPreset,
  resolveFontMonoStack,
  resolveFontUiStack,
} from "./fontPresets";

describe("fontPresets", () => {
  it("accepts only registered UI preset ids", () => {
    for (const id of FONT_UI_PRESETS) {
      expect(isFontUiPreset(id)).toBe(true);
    }
    expect(isFontUiPreset("Comic Sans")).toBe(false);
    expect(isFontUiPreset(null)).toBe(false);
  });

  it("accepts only registered mono preset ids", () => {
    for (const id of FONT_MONO_PRESETS) {
      expect(isFontMonoPreset(id)).toBe(true);
    }
    expect(isFontMonoPreset("")).toBe(false);
    expect(isFontMonoPreset(1)).toBe(false);
  });

  it("normalizes invalid values back to default", () => {
    expect(normalizeFontUiPreset("nope")).toBe(DEFAULT_FONT_UI_PRESET);
    expect(normalizeFontMonoPreset(undefined)).toBe(DEFAULT_FONT_MONO_PRESET);
    expect(normalizeFontUiPreset("yahei")).toBe("yahei");
    expect(normalizeFontMonoPreset("consolas")).toBe("consolas");
  });

  it("resolves stacks that include the primary family", () => {
    expect(resolveFontUiStack("default")).toContain("OPPO Sans");
    expect(resolveFontUiStack("yahei")).toContain("Microsoft YaHei");
    expect(resolveFontMonoStack("consolas")).toContain("Consolas");
    expect(resolveFontUiStack("bogus")).toBe(resolveFontUiStack("default"));
    expect(resolveFontMonoStack(null)).toBe(resolveFontMonoStack("default"));
  });
});
