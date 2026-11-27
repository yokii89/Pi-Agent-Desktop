import { describe, expect, it } from "vitest";
import { fitFloatingWindow } from "./floatingWindowGeometry";

const minimum = { width: 560, height: 400 };
const viewport = { width: 1440, height: 900 };

describe("floating window geometry", () => {
  it("keeps a saved window unchanged while it fits", () => {
    const saved = { left: 120, top: 100, width: 900, height: 600 };
    expect(fitFloatingWindow(saved, viewport, minimum)).toEqual(saved);
  });

  it("keeps the title and resize handle reachable after dragging past either edge", () => {
    expect(
      fitFloatingWindow({ left: -500, top: -100, width: 720, height: 560 }, viewport, minimum),
    ).toEqual({ left: 12, top: 12, width: 720, height: 560 });
    expect(
      fitFloatingWindow({ left: 2000, top: 1000, width: 720, height: 560 }, viewport, minimum),
    ).toEqual({ left: 708, top: 328, width: 720, height: 560 });
  });

  it("honors the minimum size when the viewport has room", () => {
    expect(
      fitFloatingWindow({ left: 100, top: 100, width: 50, height: 40 }, viewport, minimum),
    ).toEqual({ left: 100, top: 100, ...minimum });
  });

  it("shrinks a restored window to the new viewport, even below its usual minimum", () => {
    const saved = { left: 1000, top: 600, width: 1100, height: 760 };
    expect(fitFloatingWindow(saved, { width: 500, height: 320 }, minimum)).toEqual({
      left: 12,
      top: 12,
      width: 476,
      height: 296,
    });
  });

  it("keeps finite positive geometry in a temporarily tiny viewport", () => {
    const result = fitFloatingWindow(
      { left: 100, top: 100, width: 1100, height: 760 },
      { width: 10, height: 8 },
      minimum,
    );
    expect(result).toEqual({ left: 4.5, top: 3.5, width: 1, height: 1 });
  });
});
