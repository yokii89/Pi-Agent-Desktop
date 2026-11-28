import { describe, expect, it } from "vitest";
import { getPdfViewportSize, PDF_MAX_ZOOM, PDF_MIN_ZOOM, stepPdfZoom } from "./pdfViewport";

describe("PDF viewport sizing", () => {
  const page = { width: 600, height: 800 };

  it("fits the available width without the previous display-scale ceiling", () => {
    const size = getPdfViewportSize(page, 1800, null, 1);
    expect(size.width).toBe(1800);
    expect(size.height).toBe(2400);
    expect(size.zoom).toBe(2.25);
  });

  it("uses CSS physical units at 100% and preserves layout on HiDPI screens", () => {
    const standard = getPdfViewportSize(page, 300, 1, 1);
    const hidpi = getPdfViewportSize(page, 300, 1, 2);
    expect(standard.width).toBe(800);
    expect(hidpi.width).toBe(standard.width);
    expect(hidpi.height).toBe(standard.height);
    expect(hidpi.canvasWidth).toBe(standard.canvasWidth * 2);
    expect(Math.abs(hidpi.canvasHeight - standard.canvasHeight * 2)).toBeLessThanOrEqual(1);
    expect(getPdfViewportSize(page, 1200, 1, 2)).toEqual(hidpi);
  });

  it("renders more pixels when zooming in rather than stretching the old backing store", () => {
    const small = getPdfViewportSize(page, 300, 0.5, 2);
    const large = getPdfViewportSize(page, 300, 1, 2);
    expect(large.canvasWidth).toBe(small.canvasWidth * 2);
    expect(Math.abs(large.canvasHeight - small.canvasHeight * 2)).toBeLessThanOrEqual(1);
  });

  it("bounds memory while keeping the requested page and selection dimensions", () => {
    const size = getPdfViewportSize(page, 300, 4, 3);
    expect(size.zoom).toBe(4);
    expect(size.width).toBe(3200);
    expect(size.canvasWidth * size.canvasHeight).toBeLessThanOrEqual(16_000_000);
    expect(size.canvasWidth / size.width).toBeCloseTo(size.canvasHeight / size.height, 3);
  });

  it("also bounds extremely long canvas dimensions", () => {
    const size = getPdfViewportSize({ width: 10, height: 100_000 }, 300, 4, 2);
    expect(size.canvasHeight).toBeLessThanOrEqual(16_384);
    expect(size.canvasWidth).toBeGreaterThan(0);
  });

  it("steps from arbitrary fitted sizes and clamps repeated clicks to the zoom range", () => {
    expect(stepPdfZoom(0.42, 1)).toBe(0.5);
    expect(stepPdfZoom(0.42, -1)).toBe(0.25);
    expect(stepPdfZoom(1 - Number.EPSILON, 1)).toBe(1.25);
    expect(stepPdfZoom(PDF_MAX_ZOOM, 1)).toBe(PDF_MAX_ZOOM);
    expect(stepPdfZoom(PDF_MIN_ZOOM, -1)).toBe(PDF_MIN_ZOOM);
    expect(stepPdfZoom(8, -1)).toBe(PDF_MAX_ZOOM);
    expect(stepPdfZoom(0.1, 1)).toBe(PDF_MIN_ZOOM);
  });
});
