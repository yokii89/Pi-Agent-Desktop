import { describe, expect, it } from "vitest";
import { reconcileActiveTab, wrappedStep } from "./tabs-node";

describe("reconcileActiveTab", () => {
  it("ignores an absent activeTab prop (pure local switching)", () => {
    const state = { activeId: "q1", lastExplicit: "q0" };
    expect(reconcileActiveTab(state, undefined)).toBeNull();
    expect(state.activeId).toBe("q1");
  });

  it("ignores an echo of the last explicit value (extension shadow state lags local switching)", () => {
    // 场景：扩展自动前进到 q1（lastExplicit=q1），用户本地点回 q0，
    // 随后扩展因别的 change 回显 activeTab 仍是 q1 —— 不得把用户弹回去。
    const state = { activeId: "q0", lastExplicit: "q1" };
    expect(reconcileActiveTab(state, "q1")).toBeNull();
    expect(state.activeId).toBe("q0");
  });

  it("takes over when the prop carries a new explicit value", () => {
    const state = { activeId: "q0", lastExplicit: "q0" };
    expect(reconcileActiveTab(state, "q2")).toEqual({ activeId: "q2", lastExplicit: "q2" });
  });

  it("takes over the first defined prop after mounting without one", () => {
    const state = { activeId: "first", lastExplicit: undefined };
    expect(reconcileActiveTab(state, "review")).toEqual({
      activeId: "review",
      lastExplicit: "review",
    });
  });
});

describe("wrappedStep", () => {
  it("steps forward and backward within bounds", () => {
    expect(wrappedStep(0, 1, 4)).toBe(1);
    expect(wrappedStep(2, -1, 4)).toBe(1);
  });

  it("wraps at both ends", () => {
    expect(wrappedStep(3, 1, 4)).toBe(0);
    expect(wrappedStep(0, -1, 4)).toBe(3);
  });

  it("survives degenerate lengths", () => {
    expect(wrappedStep(0, 1, 0)).toBe(0);
    expect(wrappedStep(0, -1, 1)).toBe(0);
  });
});
