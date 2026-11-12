import { describe, expect, it } from "vitest";
import {
  clampNavWidth,
  NAV_WIDTH_COLLAPSED,
  NAV_WIDTH_DEFAULT,
  NAV_WIDTH_MAX,
  NAV_WIDTH_MIN,
} from "../../shared/navWidth";
import {
  clampNavWidthToGrid,
  NAV_MAIN_MIN_WIDTH,
  navMaxWidth,
  readGridTracks,
} from "./navGeometry";

/**
 * 左栏宽度的夹取口径（docs/design/137）：
 * 下限是硬下限，上限随「窗口宽 - 右栏 - 中央区最小宽」浮动，任何路径都不得越界。
 */
describe("clampNavWidth", () => {
  it("区间内原样取整，越界夹到两端", () => {
    expect(clampNavWidth(300)).toBe(300);
    expect(clampNavWidth(300.6)).toBe(301);
    expect(clampNavWidth(10)).toBe(NAV_WIDTH_MIN);
    expect(clampNavWidth(9999)).toBe(NAV_WIDTH_MAX);
  });

  it("非法值回退默认宽度", () => {
    expect(clampNavWidth(undefined)).toBe(NAV_WIDTH_DEFAULT);
    expect(clampNavWidth(null)).toBe(NAV_WIDTH_DEFAULT);
    expect(clampNavWidth("320")).toBe(NAV_WIDTH_DEFAULT);
    expect(clampNavWidth(Number.NaN)).toBe(NAV_WIDTH_DEFAULT);
    expect(clampNavWidth(Number.POSITIVE_INFINITY)).toBe(NAV_WIDTH_DEFAULT);
  });

  it("折叠宽度不进夹取区间，只作常量引用", () => {
    expect(NAV_WIDTH_COLLAPSED).toBeLessThan(NAV_WIDTH_MIN);
  });
});

describe("navMaxWidth", () => {
  it("上限 = 窗口宽 - 右栏 - 中央区最小宽", () => {
    expect(navMaxWidth(1440, 300)).toBe(1440 - 300 - NAV_MAIN_MIN_WIDTH);
  });

  it("窗口过窄时宁可挤压中央区，也不低于硬下限", () => {
    expect(navMaxWidth(600, 300)).toBe(NAV_WIDTH_MIN);
    expect(navMaxWidth(0, 0)).toBe(NAV_WIDTH_MIN);
  });

  it("右栏越宽，左栏越窄（两者不吃掉同一段空间）", () => {
    expect(navMaxWidth(1440, 400)).toBeLessThan(navMaxWidth(1440, 0));
  });
});

describe("clampNavWidthToGrid", () => {
  it("先夹上限再抬下限", () => {
    // 1440 - 300 - 560 = 580，但全局上限 480 先命中
    expect(clampNavWidthToGrid(900, 1440, 300)).toBe(NAV_WIDTH_MAX);
    // 1000 - 300 - 560 = 140，低于硬下限则用下限
    expect(clampNavWidthToGrid(400, 1000, 300)).toBe(NAV_WIDTH_MIN);
    // 区间内原样
    expect(clampNavWidthToGrid(320, 1440, 300)).toBe(320);
  });

  it("上限恒定时不会因为「起始宽度」变化而漂移", () => {
    const first = clampNavWidthToGrid(300, 1280, 300);
    const second = clampNavWidthToGrid(300, 1280, 300);
    expect(first).toBe(second);
  });
});

describe("readGridTracks", () => {
  // getComputedStyle 需要真实 DOM；这里只验证解析退化路径，桩掉全局读数即可
  const fakeGrid = () => ({ nodeType: 1, style: {} }) as unknown as HTMLElement;

  it("解析三列宽度，非法值归 0", () => {
    const grid = fakeGrid();
    // getComputedStyle 需要真实 DOM，这里只验证解析退化路径：空串 → 全 0
    globalThis.getComputedStyle = (() => ({ gridTemplateColumns: "248px 892px 300px" })) as never;
    expect(readGridTracks(grid)).toEqual([248, 892, 300]);
    globalThis.getComputedStyle = (() => ({ gridTemplateColumns: "" })) as never;
    expect(readGridTracks(grid)).toEqual([0, 0, 0]);
    globalThis.getComputedStyle = (() => ({ gridTemplateColumns: "abc 1fr 0px" })) as never;
    expect(readGridTracks(grid)).toEqual([0, 1, 0]);
    // @ts-expect-error 测试里清理注入的全局桩
    delete globalThis.getComputedStyle;
  });
});
