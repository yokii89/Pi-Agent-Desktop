import { describe, expect, it } from "vitest";
import { clampThinkingLevel, deriveAvailableThinkingLevels, THINKING_LEVELS } from "./ipc";

describe("deriveAvailableThinkingLevels", () => {
  it("非推理模型只有 off", () => {
    expect(deriveAvailableThinkingLevels(false)).toEqual(["off"]);
    expect(deriveAvailableThinkingLevels(false, { max: "max" })).toEqual(["off"]);
  });

  it("推理模型无 map 时是默认 5 档", () => {
    expect(deriveAvailableThinkingLevels(true)).toEqual(THINKING_LEVELS.slice(0, 5));
    expect(deriveAvailableThinkingLevels(true, null)).toEqual(THINKING_LEVELS.slice(0, 5));
  });

  it("map 的 null 隐藏档位；xhigh/max 仅在显式映射时出现", () => {
    expect(
      deriveAvailableThinkingLevels(true, {
        minimal: null,
        xhigh: null,
        max: "max",
      }),
    ).toEqual(["off", "low", "medium", "high", "max"]);
  });

  it("非法 map 按默认 5 档处理", () => {
    expect(deriveAvailableThinkingLevels(true, ["xhigh"])).toEqual(THINKING_LEVELS.slice(0, 5));
  });
});

describe("clampThinkingLevel", () => {
  it("在集合内保持不变", () => {
    expect(clampThinkingLevel("medium", ["off", "medium", "high"])).toBe("medium");
  });

  it("优先向更高档夹取，其次更低档", () => {
    expect(clampThinkingLevel("medium", ["low", "high", "max"])).toBe("high");
    expect(clampThinkingLevel("medium", ["off", "minimal", "low"])).toBe("low");
  });

  it("空集合回退 off", () => {
    expect(clampThinkingLevel("medium", [])).toBe("off");
  });
});
