import { describe, expect, it } from "vitest";
import {
  normalizeUiZoom,
  resolveUiZoomAction,
  stepUiZoom,
  UI_ZOOM_DEFAULT,
  UI_ZOOM_MAX,
  UI_ZOOM_MIN,
  type UiZoomKeyInput,
} from "./uiZoom";

function key(patch: Partial<UiZoomKeyInput>): UiZoomKeyInput {
  return {
    type: "keyDown",
    key: "",
    control: true,
    shift: false,
    alt: false,
    meta: false,
    ...patch,
  };
}

describe("resolveUiZoomAction", () => {
  it("zooms in on Ctrl+= (the accelerator the default menu misses on Windows)", () => {
    expect(resolveUiZoomAction(key({ key: "=", code: "Equal" }))).toBe("in");
  });

  it("zooms in on Ctrl+Shift+= / Ctrl++ / numpad add", () => {
    expect(resolveUiZoomAction(key({ key: "+", code: "Equal", shift: true }))).toBe("in");
    expect(resolveUiZoomAction(key({ key: "+", shift: true }))).toBe("in");
    expect(resolveUiZoomAction(key({ key: "+", code: "NumpadAdd" }))).toBe("in");
    expect(resolveUiZoomAction(key({ key: "Add" }))).toBe("in");
  });

  it("zooms out on Ctrl+- / Ctrl+_ / numpad subtract", () => {
    expect(resolveUiZoomAction(key({ key: "-", code: "Minus" }))).toBe("out");
    expect(resolveUiZoomAction(key({ key: "_", code: "Minus", shift: true }))).toBe("out");
    expect(resolveUiZoomAction(key({ key: "-", code: "NumpadSubtract" }))).toBe("out");
  });

  it("resets on Ctrl+0 but not Ctrl+Shift+0", () => {
    expect(resolveUiZoomAction(key({ key: "0", code: "Digit0" }))).toBe("reset");
    expect(resolveUiZoomAction(key({ key: "0", code: "Numpad0" }))).toBe("reset");
    expect(resolveUiZoomAction(key({ key: ")", code: "Digit0", shift: true }))).toBeNull();
  });

  it("ignores unrelated combos", () => {
    expect(resolveUiZoomAction(key({ key: "a", code: "KeyA" }))).toBeNull();
    expect(resolveUiZoomAction(key({ key: "=", code: "Equal", control: false }))).toBeNull();
    // AltGr 布局上 Ctrl+Alt+= 等于打字符，Win/Meta 是系统保留位
    expect(resolveUiZoomAction(key({ key: "=", code: "Equal", alt: true }))).toBeNull();
    expect(resolveUiZoomAction(key({ key: "=", code: "Equal", meta: true }))).toBeNull();
    expect(resolveUiZoomAction(key({ key: "=", code: "Equal", type: "keyUp" }))).toBeNull();
  });
});

describe("normalizeUiZoom", () => {
  it("keeps valid factors and snaps them to the 0.1 grid", () => {
    expect(normalizeUiZoom(1.25)).toBe(1.3);
    expect(normalizeUiZoom(1.1)).toBe(1.1);
    expect(normalizeUiZoom(0.8)).toBe(0.8);
  });

  it("clamps to the readable range and falls back for junk", () => {
    expect(normalizeUiZoom(0.1)).toBe(UI_ZOOM_MIN);
    expect(normalizeUiZoom(9)).toBe(UI_ZOOM_MAX);
    expect(normalizeUiZoom(undefined)).toBe(UI_ZOOM_DEFAULT);
    expect(normalizeUiZoom(Number.NaN)).toBe(UI_ZOOM_DEFAULT);
    expect(normalizeUiZoom("1.5")).toBe(UI_ZOOM_DEFAULT);
  });
});

describe("stepUiZoom", () => {
  it("steps by one 0.1 notch without float drift", () => {
    expect(stepUiZoom(1, "in")).toBe(1.1);
    expect(stepUiZoom(0.7, "in")).toBe(0.8);
    expect(stepUiZoom(1.1, "out")).toBe(1);
    expect(stepUiZoom(0.8, "out")).toBe(0.7);
  });

  it("stops at the bounds and resets to 100%", () => {
    expect(stepUiZoom(UI_ZOOM_MAX, "in")).toBe(UI_ZOOM_MAX);
    expect(stepUiZoom(UI_ZOOM_MIN, "out")).toBe(UI_ZOOM_MIN);
    expect(stepUiZoom(1.7, "reset")).toBe(UI_ZOOM_DEFAULT);
  });
});
