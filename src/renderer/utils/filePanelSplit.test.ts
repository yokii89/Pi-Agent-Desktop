import { describe, expect, it } from "vitest";
import {
  clampFilePanelRatio,
  FILE_PANEL_DEFAULT_RATIO,
  filePanelRatioBounds,
} from "./filePanelSplit";

describe("file panel split geometry", () => {
  it("keeps both panes adjustable in the default and narrow sidebar widths", () => {
    for (const width of [0, 212, 292]) {
      const bounds = filePanelRatioBounds(width);
      expect(bounds.min).toBeLessThan(FILE_PANEL_DEFAULT_RATIO);
      expect(bounds.max).toBeGreaterThan(FILE_PANEL_DEFAULT_RATIO);
      expect(clampFilePanelRatio(-1, width)).toBe(bounds.min);
      expect(clampFilePanelRatio(2, width)).toBe(bounds.max);
      expect(bounds.min).toBeGreaterThan(0);
      expect(bounds.max).toBeLessThan(1);
    }
  });

  it("reserves readable pixel widths when the sidebar has enough room", () => {
    const width = 1000;
    const bounds = filePanelRatioBounds(width);
    expect(bounds.min * width).toBe(140);
    expect((1 - bounds.max) * width).toBeCloseTo(200);
    expect(clampFilePanelRatio(0.6, width)).toBe(0.6);
  });

  it("clamps an expanded layout when the sidebar becomes narrower", () => {
    const expanded = clampFilePanelRatio(0.85, 1200);
    expect(expanded).toBe(1 - 200 / 1200);
    const narrow = clampFilePanelRatio(expanded, 292);
    expect(narrow).toBe(0.65);
    expect(clampFilePanelRatio(narrow, 1200)).toBe(narrow);
  });

  it("recovers a valid ratio from unavailable geometry or invalid values", () => {
    expect(filePanelRatioBounds(-1)).toEqual(filePanelRatioBounds(0));
    for (const ratio of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clampFilePanelRatio(ratio, 600)).toBe(FILE_PANEL_DEFAULT_RATIO);
    }
  });
});
