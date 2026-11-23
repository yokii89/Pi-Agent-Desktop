import { describe, expect, it } from "vitest";
import { APP_ICON_IDS, DEFAULT_APP_ICON_ID, isAppIconId, normalizeAppIconId } from "./appIcon";

describe("app icon preferences", () => {
  it("accepts only bundled variants", () => {
    for (const id of APP_ICON_IDS) expect(isAppIconId(id)).toBe(true);
    expect(isAppIconId("user-file.ico")).toBe(false);
    expect(isAppIconId(null)).toBe(false);
  });

  it("falls back to the original bundled icon", () => {
    expect(normalizeAppIconId("unknown")).toBe(DEFAULT_APP_ICON_ID);
    expect(normalizeAppIconId(undefined)).toBe(DEFAULT_APP_ICON_ID);
  });
});
