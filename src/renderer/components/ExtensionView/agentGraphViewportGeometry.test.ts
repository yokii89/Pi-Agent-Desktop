import { describe, expect, it } from "vitest";
import {
  agentGraphZoomPercent,
  fitAgentGraphScale,
  zoomAgentGraphScale,
} from "./agentGraphViewportGeometry";

describe("agent graph overview geometry", () => {
  it("fits tall and deep supported snapshots without a five-percent floor", () => {
    const viewport = { width: 300, height: 120 };
    for (const graph of [
      { width: 488, height: 34000 },
      { width: 50000, height: 300 },
    ]) {
      const scale = fitAgentGraphScale(graph, viewport);
      expect(scale).toBeGreaterThan(0);
      expect(scale).toBeLessThan(0.05);
      expect(graph.width * scale).toBeLessThanOrEqual(viewport.width);
      expect(graph.height * scale).toBeLessThanOrEqual(viewport.height);
      expect(agentGraphZoomPercent(scale)).toBeGreaterThan(0);
    }
  });
  it("does not enlarge small graphs and handles unmeasured bounds", () => {
    expect(fitAgentGraphScale({ width: 200, height: 200 }, { width: 800, height: 600 })).toBe(1);
    expect(fitAgentGraphScale({ width: 0, height: 200 }, { width: 0, height: 0 })).toBe(1);
  });
  it("zooms monotonically when starting below the normal readable minimum", () => {
    const current = 0.004;
    expect(zoomAgentGraphScale(current, 1.2, current)).toBeCloseTo(current * 1.2);
    expect(zoomAgentGraphScale(current, 1 / 1.2, current)).toBe(current);
    expect(zoomAgentGraphScale(current, 1 / 1.2, 0.02)).toBeLessThanOrEqual(current);
    expect(zoomAgentGraphScale(1.9, 1.2, 0.01)).toBe(2);
  });
});
