import { describe, expect, it } from "vitest";
import { rendererBoundsToDip } from "./browserBounds";

const BOUNDS = { x: 100.4, y: 22.7, width: 300.3, height: 180.2, visible: true };

describe("rendererBoundsToDip", () => {
  it("keeps CSS coordinates unchanged at the default UI zoom", () => {
    expect(rendererBoundsToDip(BOUNDS, 1)).toEqual({ x: 100, y: 23, width: 300, height: 180 });
  });

  it("scales coordinates and size to DIP at non-default UI zoom", () => {
    expect(rendererBoundsToDip(BOUNDS, 1.25)).toEqual({ x: 126, y: 28, width: 375, height: 225 });
  });

  it("falls back to 1x for invalid zoom values and keeps dimensions positive", () => {
    expect(rendererBoundsToDip({ ...BOUNDS, width: 0, height: 0 }, Number.NaN)).toEqual({
      x: 100,
      y: 23,
      width: 1,
      height: 1,
    });
  });
});
