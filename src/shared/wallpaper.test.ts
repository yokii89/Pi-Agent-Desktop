import { describe, expect, it } from "vitest";
import {
  clampWallpaperDim,
  DEFAULT_WALLPAPER_DIM,
  normalizeWallpaperPath,
  parseByteRange,
  wallpaperFileName,
  wallpaperKindFromPath,
  wallpaperMediaUrl,
  wallpaperMimeType,
} from "./wallpaper";

describe("wallpaperKindFromPath", () => {
  it("recognizes images and videos case-insensitively", () => {
    expect(wallpaperKindFromPath("C:\\art\\asuka.JPG")).toBe("image");
    expect(wallpaperKindFromPath("/home/u/dust.webm")).toBe("video");
    expect(wallpaperKindFromPath("C:\\art\\scene.mp4")).toBe("video");
  });

  it("returns null for unsupported or extension-less files", () => {
    expect(wallpaperKindFromPath("C:\\art\\scene.pkg")).toBeNull();
    expect(wallpaperKindFromPath("C:\\art\\README")).toBeNull();
    expect(wallpaperKindFromPath("C:\\art\\archive.tar.gz")).toBeNull();
  });
});

describe("normalizeWallpaperPath", () => {
  it("trims and keeps supported paths", () => {
    expect(normalizeWallpaperPath("  C:\\art\\a.png  ")).toBe("C:\\art\\a.png");
  });

  it("drops empty, non-string and unsupported values", () => {
    expect(normalizeWallpaperPath("")).toBeNull();
    expect(normalizeWallpaperPath("   ")).toBeNull();
    expect(normalizeWallpaperPath(null)).toBeNull();
    expect(normalizeWallpaperPath(42)).toBeNull();
    expect(normalizeWallpaperPath("C:\\art\\scene.pkg")).toBeNull();
  });
});

describe("clampWallpaperDim", () => {
  it("rounds and clamps to 0–100", () => {
    expect(clampWallpaperDim(70.4)).toBe(70);
    expect(clampWallpaperDim(-12)).toBe(0);
    expect(clampWallpaperDim(180)).toBe(100);
  });

  it("falls back to the default for invalid values", () => {
    expect(clampWallpaperDim(undefined)).toBe(DEFAULT_WALLPAPER_DIM);
    expect(clampWallpaperDim(Number.NaN)).toBe(DEFAULT_WALLPAPER_DIM);
    expect(clampWallpaperDim("60")).toBe(DEFAULT_WALLPAPER_DIM);
  });
});

describe("wallpaper media helpers", () => {
  it("maps extensions to MIME types", () => {
    expect(wallpaperMimeType("a.jpg")).toBe("image/jpeg");
    expect(wallpaperMimeType("a.webm")).toBe("video/webm");
    expect(wallpaperMimeType("a.pkg")).toBeNull();
  });

  it("builds a custom-protocol URL with a cache-busting query", () => {
    const url = wallpaperMediaUrl("C:\\art\\a b.png");
    expect(url.startsWith("pidesk-media://wallpaper/?v=")).toBe(true);
    expect(url).toContain(encodeURIComponent("C:\\art\\a b.png"));
  });

  it("extracts the file name for display", () => {
    expect(wallpaperFileName("C:\\art\\asuka.png")).toBe("asuka.png");
    expect(wallpaperFileName("/home/u/dust.webm")).toBe("dust.webm");
  });
});

describe("parseByteRange", () => {
  const size = 1000;

  it("returns null when the header is absent or multi-range", () => {
    expect(parseByteRange(null, size)).toBeNull();
    expect(parseByteRange("bytes=0-1, 3-4", size)).toBeNull();
    expect(parseByteRange("items=0-1", size)).toBeNull();
  });

  it("parses closed, open-ended and suffix ranges", () => {
    expect(parseByteRange("bytes=0-99", size)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=500-", size)).toEqual({ start: 500, end: 999 });
    expect(parseByteRange("bytes=-100", size)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange(" bytes=0-9 ", size)).toEqual({ start: 0, end: 9 });
  });

  it("clamps the end and rejects out-of-bounds starts", () => {
    expect(parseByteRange("bytes=900-5000", size)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=1000-", size)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=50-10", size)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", size)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=0-0", 0)).toBe("unsatisfiable");
  });
});
