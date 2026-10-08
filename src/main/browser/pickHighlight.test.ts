import { describe, expect, it } from "vitest";
import {
  buildClearSelectionExpression,
  buildSetHighlightModeExpression,
  buildTargetAtExpression,
  parsePickHit,
  resolveLayerPlan,
  toDocumentHitPoint,
} from "./pickHighlight";

describe("parsePickHit", () => {
  it("接受 binding 回传的 JSON 字符串", () => {
    expect(parsePickHit('{"x":12,"y":34}')).toEqual({
      x: 12,
      y: 34,
      scrollX: 0,
      scrollY: 0,
    });
  });

  it("接受已解析对象 / 数组形态，并透出 scroll", () => {
    expect(parsePickHit({ x: 12, y: 34, scrollX: 100, scrollY: 200 })).toEqual({
      x: 12,
      y: 34,
      scrollX: 100,
      scrollY: 200,
    });
    expect(parsePickHit([7, 8])).toEqual({ x: 7, y: 8, scrollX: 0, scrollY: 0 });
  });

  it("scroll 缺失或非法时按 0 处理", () => {
    expect(parsePickHit({ x: 1, y: 2, scrollX: "x", scrollY: Number.NaN })).toEqual({
      x: 1,
      y: 2,
      scrollX: 0,
      scrollY: 0,
    });
  });

  it("拒绝非有限数字与畸形载荷", () => {
    expect(parsePickHit(null)).toBeNull();
    expect(parsePickHit({ x: "1", y: 2 })).toBeNull();
    expect(parsePickHit({ x: Number.NaN, y: 0 })).toBeNull();
    expect(parsePickHit([1])).toBeNull();
    expect(parsePickHit("nope")).toBeNull();
    expect(parsePickHit("{bad json")).toBeNull();
  });
});

describe("toDocumentHitPoint", () => {
  it("视口坐标加 scroll 得到文档坐标", () => {
    expect(toDocumentHitPoint({ x: 10, y: 20, scrollX: 100, scrollY: 300 })).toEqual({
      x: 110,
      y: 320,
    });
  });

  it("CDP 要 integer：小数四舍五入", () => {
    expect(toDocumentHitPoint({ x: 10.4, y: 20.6, scrollX: 0.4, scrollY: 0 })).toEqual({
      x: 11,
      y: 21,
    });
  });
});

describe("buildTargetAtExpression", () => {
  it("生成调用页内 targetAt 的表达式", () => {
    expect(buildTargetAtExpression(12, 34)).toBe(
      "(window.__pideskPickHighlight__ && window.__pideskPickHighlight__.targetAt(12, 34)) || null",
    );
  });

  it("非有限坐标回退 0，避免注入 NaN", () => {
    expect(buildTargetAtExpression(Number.NaN, Number.POSITIVE_INFINITY)).toContain(
      "targetAt(0, 0)",
    );
  });
});

describe("resolveLayerPlan", () => {
  it("无选中仅悬停：画 hover，chip 在 hover", () => {
    expect(
      resolveLayerPlan({
        hasSelection: false,
        hasHover: true,
        hoverIsSelection: false,
        mode: "full",
      }),
    ).toEqual({ drawSelection: false, drawHover: true, drawChipOn: "hover" });
  });

  it("选中 + 悬停其他元素：双层并存，chip 在 hover", () => {
    expect(
      resolveLayerPlan({
        hasSelection: true,
        hasHover: true,
        hoverIsSelection: false,
        mode: "full",
      }),
    ).toEqual({ drawSelection: true, drawHover: true, drawChipOn: "hover" });
  });

  it("悬停命中选中：不叠 fill，chip 在 selection", () => {
    expect(
      resolveLayerPlan({
        hasSelection: true,
        hasHover: true,
        hoverIsSelection: true,
        mode: "full",
      }),
    ).toEqual({ drawSelection: true, drawHover: false, drawChipOn: "selection" });
  });

  it("鼠标不在页面：只留选中描边，无 chip", () => {
    expect(
      resolveLayerPlan({
        hasSelection: true,
        hasHover: false,
        hoverIsSelection: false,
        mode: "full",
      }),
    ).toEqual({ drawSelection: true, drawHover: false, drawChipOn: "none" });
  });

  it("浏览 selection-only：只描边，无 hover/chip", () => {
    expect(
      resolveLayerPlan({
        hasSelection: true,
        hasHover: true,
        hoverIsSelection: false,
        mode: "selection-only",
      }),
    ).toEqual({ drawSelection: true, drawHover: false, drawChipOn: "none" });
  });
});

describe("highlight mode expressions", () => {
  it("setMode / clearSelection 调用页内 API", () => {
    expect(buildSetHighlightModeExpression("selection-only")).toBe(
      '(window.__pideskPickHighlight__ && window.__pideskPickHighlight__.setMode("selection-only")) || null',
    );
    expect(buildClearSelectionExpression()).toBe(
      "(window.__pideskPickHighlight__ && window.__pideskPickHighlight__.clearSelection()) || null",
    );
  });
});
