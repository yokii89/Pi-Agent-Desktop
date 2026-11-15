import { describe, expect, it } from "vitest";
import {
  DEFAULT_THINKING_ANIMATION,
  isThinkingAnimation,
  normalizeThinkingAnimation,
  THINKING_ANIMATIONS,
} from "./thinkingAnimation";

describe("thinking animation preferences", () => {
  it("registers the original mark and each supported orb look", () => {
    expect(THINKING_ANIMATIONS).toEqual(["pi", "reasoning", "twins", "gyro", "lighthouse"]);
    expect(THINKING_ANIMATIONS.every(isThinkingAnimation)).toBe(true);
  });

  it("falls back to the original mark for unknown values", () => {
    expect(DEFAULT_THINKING_ANIMATION).toBe("pi");
    expect(normalizeThinkingAnimation("unknown")).toBe("pi");
    expect(normalizeThinkingAnimation(undefined)).toBe("pi");
  });
});
