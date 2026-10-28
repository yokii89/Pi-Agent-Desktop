import { describe, expect, it } from "vitest";
import {
  clampSplashLogoSize,
  clampSplashSpeed,
  DEFAULT_SPLASH_FONT_PRESET,
  DEFAULT_SPLASH_LOGO_SIZE,
  DEFAULT_SPLASH_SPEED,
  isSplashLogoDataUrl,
  normalizeSplashFontPreset,
  normalizeSplashLogoImage,
  normalizeSplashText,
  resolveSplashFontStack,
  SPLASH_FONT_PRESETS,
} from "./splash";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("splash settings helpers", () => {
  it("只接受 base64 图片 data URL，且限长", () => {
    expect(isSplashLogoDataUrl(PNG_1PX)).toBe(true);
    expect(isSplashLogoDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBe(true);
    expect(isSplashLogoDataUrl("javascript:alert(1)")).toBe(false);
    expect(isSplashLogoDataUrl("data:image/svg+xml,<svg onload=alert(1)></svg>")).toBe(false);
    expect(isSplashLogoDataUrl(`data:image/png;base64,${"A".repeat(200001)}`)).toBe(false);
    expect(normalizeSplashLogoImage("nope")).toBe("");
  });

  it("字号 / 速度越界夹取，非法回退默认", () => {
    expect(clampSplashLogoSize(999)).toBe(240);
    expect(clampSplashLogoSize(1)).toBe(64);
    expect(clampSplashLogoSize("bad")).toBe(DEFAULT_SPLASH_LOGO_SIZE);
    expect(clampSplashSpeed(9)).toBe(3);
    expect(clampSplashSpeed(0)).toBe(0.35);
    expect(clampSplashSpeed("bad")).toBe(DEFAULT_SPLASH_SPEED);
  });

  it("默认 Cascadia Mono，reference 已下线并回退默认", () => {
    expect(DEFAULT_SPLASH_FONT_PRESET).toBe("cascadia");
    expect(SPLASH_FONT_PRESETS as readonly string[]).not.toContain("reference");
    expect(normalizeSplashFontPreset("neon")).toBe("cascadia");
    expect(normalizeSplashFontPreset("reference")).toBe("cascadia");
    expect(resolveSplashFontStack("segoe")).toContain("Segoe UI");
    expect(resolveSplashFontStack("cascadia")).toContain("Cascadia Mono");
  });

  it("文案空串保留（主动隐藏该行），非字符串回退默认", () => {
    expect(normalizeSplashText("", "fallback")).toBe("");
    expect(normalizeSplashText(null, "fallback")).toBe("fallback");
    expect(normalizeSplashText("x".repeat(100), "fallback")).toHaveLength(64);
  });
});
