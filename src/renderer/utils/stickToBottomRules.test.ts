import { describe, expect, it } from "vitest";
import { REATTACH_THRESHOLD_PX, type ScrollSignal, scrollTransition } from "./stickToBottomRules";

interface Step {
  distance: number;
  transition: ReturnType<typeof scrollTransition>;
}

/** 从贴底（distance = startDistance）出发，按给定位移序列逐帧推进状态机。 */
function play(deltas: number[], startDistance = 0, mode: ScrollSignal["mode"] = "follow") {
  let top = 0;
  let distance = startDistance;
  let current = mode;
  const steps: Step[] = [];
  for (const delta of deltas) {
    const prevTop = top;
    top += delta;
    distance = Math.max(0, distance - delta);
    const transition = scrollTransition({ mode: current, prevTop, top, distance });
    if (transition === "release") current = "free";
    else if (transition === "reattach") current = "follow";
    steps.push({ distance, transition });
  }
  return { steps, mode: current, distance };
}

describe("会话贴底状态机判定规则", () => {
  it("贴底时一帧小幅上滚即脱离跟随（回弹回归：曾要求先划出回贴阈值）", () => {
    expect(scrollTransition({ mode: "follow", prevTop: 1000, top: 996, distance: 4 })).toBe(
      "release",
    );
  });

  it("平滑滚动逐帧 1px 也能脱离（回弹回归：曾要求单帧位移 > 2px）", () => {
    const { steps, mode } = play([-1, -1, -1, -1]);
    expect(steps.map((step) => step.transition)).toEqual(["none", "release", "unread", "unread"]);
    expect(mode).toBe("free");
  });

  it("连续小幅度滚轮能累积划出回贴区，中途不被粘回", () => {
    const { steps, mode, distance } = play(Array.from({ length: 12 }, () => -6));
    expect(steps[0].transition).toBe("release");
    expect(steps.slice(1).map((step) => step.transition)).toEqual(Array(11).fill("unread"));
    expect(mode).toBe("free");
    expect(distance).toBeGreaterThan(REATTACH_THRESHOLD_PX);
  });

  it("内容变矮导致浏览器钳制 scrollTop 不算用户上滚", () => {
    expect(scrollTransition({ mode: "follow", prevTop: 900, top: 870, distance: 0 })).toBe("none");
    // 亚像素/缩放余量
    expect(scrollTransition({ mode: "follow", prevTop: 900, top: 899, distance: 0.4 })).toBe(
      "none",
    );
  });

  it("程序贴底（scrollTop 只增）不误判成用户滚动", () => {
    expect(scrollTransition({ mode: "follow", prevTop: 900, top: 1000, distance: 0 })).toBe("none");
  });

  it("free 期向上滚经过回贴区不会被重新粘住", () => {
    expect(scrollTransition({ mode: "free", prevTop: 1000, top: 960, distance: 40 })).toBe(
      "unread",
    );
  });

  it("free 期向下滚回到底部附近才恢复跟随", () => {
    expect(scrollTransition({ mode: "free", prevTop: 900, top: 940, distance: 12 })).toBe(
      "reattach",
    );
  });

  it("free 期向下滚但仍离底很远时只更新未读高度", () => {
    expect(scrollTransition({ mode: "free", prevTop: 900, top: 940, distance: 300 })).toBe(
      "unread",
    );
  });

  it("从贴底一路划到回贴区外，全程只脱离一次且不再回贴", () => {
    const { mode, distance } = play([-1, -1, -1, -1, -1, -1, -1, -1, -1]);
    expect(mode).toBe("free");
    expect(distance).toBe(9);
  });
});
