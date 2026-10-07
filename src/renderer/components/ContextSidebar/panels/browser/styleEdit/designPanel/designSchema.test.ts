import { describe, expect, it } from "vitest";
import {
  colorAlphaToPercent,
  colorWithAlpha,
  isBorderBox,
  joinLength,
  opacityToCss,
  opacityToDisplay,
  resolveDisplayValue,
  resolveFlowMode,
  resolvePairValue,
  rotateToDisplay,
  splitLength,
} from "./designSchema";

describe("designSchema", () => {
  it("resolveDisplayValue 调整优先于 computed", () => {
    const computed = new Map([
      ["width", "160px"],
      ["color", "rgb(0, 0, 0)"],
    ]);
    const decls = [
      { name: "width", value: "180px", enabled: true },
      { name: "color", value: "red", enabled: false },
    ];
    expect(resolveDisplayValue("width", computed, decls)).toBe("180px");
    expect(resolveDisplayValue("color", computed, decls)).toBe("rgb(0, 0, 0)");
  });

  it("resolvePairValue 两侧不同时取前侧", () => {
    const computed = new Map([
      ["padding-left", "1px"],
      ["padding-right", "6px"],
    ]);
    expect(resolvePairValue(["padding-left", "padding-right"], computed, [])).toBe("1px");
  });

  it("splitLength / joinLength 往返", () => {
    expect(splitLength("160px")).toEqual({ num: "160", unit: "px" });
    expect(joinLength("160", "px")).toBe("160px");
    expect(joinLength("auto", "px")).toBe("auto");
    expect(joinLength("3", "")).toBe("3");
  });

  it("opacity 展示百分比、写入小数", () => {
    expect(opacityToDisplay("0.5")).toBe("50");
    expect(opacityToDisplay("50%")).toBe("50");
    expect(opacityToDisplay("1")).toBe("100");
    expect(opacityToCss("80")).toBe("0.8");
    expect(opacityToCss("50")).toBe("0.5");
    expect(opacityToCss("0.5")).toBe("0.005");
  });

  it("rotate 从 transform 回退解析", () => {
    expect(rotateToDisplay("45deg", "")).toBe("45");
    expect(rotateToDisplay("", "rotate(12deg)")).toBe("12");
    expect(rotateToDisplay("", "none")).toBe("0");
  });

  it("flow / border-box 归纳", () => {
    expect(resolveFlowMode("flex", "column")).toBe("column");
    expect(resolveFlowMode("grid", "row")).toBe("grid");
    expect(resolveFlowMode("block", "")).toBe("block");
    expect(isBorderBox("border-box")).toBe(true);
    expect(isBorderBox("content-box")).toBe(false);
  });

  it("颜色透明度换算", () => {
    expect(colorAlphaToPercent("rgba(0, 0, 0, 0.5)")).toBe("50");
    expect(colorAlphaToPercent("#000000")).toBe("100");
    expect(colorWithAlpha("rgb(74, 140, 255)", "50")).toBe("rgba(74, 140, 255, 0.5)");
  });
});
