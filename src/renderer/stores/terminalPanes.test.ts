import { describe, expect, it } from "vitest";
import {
  INITIAL_PANE_STATE,
  pickSplitPartner,
  type TerminalPaneAction,
  type TerminalPaneState,
  type TerminalTab,
  terminalPaneReducer,
} from "./terminalPanes";

function tab(id: string, exited = false): TerminalTab {
  return { id, title: id, exited };
}

function state(partial: Partial<TerminalPaneState>): TerminalPaneState {
  return { ...INITIAL_PANE_STATE, ...partial };
}

describe("terminalPaneReducer", () => {
  it("首个实例装入窗格 0", () => {
    const next = terminalPaneReducer(INITIAL_PANE_STATE, {
      type: "tabAdded",
      tab: tab("term-1"),
      install: true,
    });
    expect(next.tabs.map((item) => item.id)).toEqual(["term-1"]);
    expect(next.panes).toEqual(["term-1"]);
    expect(next.focusedPane).toBe(0);
    expect(next.split).toBeNull();
  });

  it("install=false 只入列、不动窗格（进入分屏时先建实例后落位）", () => {
    const base = state({ tabs: [tab("term-1")], panes: ["term-1"] });
    const next = terminalPaneReducer(base, {
      type: "tabAdded",
      tab: tab("term-2"),
      install: false,
    });
    expect(next.panes).toEqual(["term-1"]);
    expect(next.tabs.map((item) => item.id)).toEqual(["term-1", "term-2"]);
  });

  it("进入分屏：实例落到第二窗格，焦点交给新窗格", () => {
    const base = state({ tabs: [tab("term-1"), tab("term-2")], panes: ["term-1"] });
    const next = terminalPaneReducer(base, {
      type: "splitEntered",
      direction: "row",
      secondary: "term-2",
    });
    expect(next.split).toBe("row");
    expect(next.panes).toEqual(["term-1", "term-2"]);
    expect(next.focusedPane).toBe(1);
  });

  it("进入分屏的守卫：已分屏 / 实例已在窗格 / 实例不存在都原样返回", () => {
    const split = state({
      tabs: [tab("a"), tab("b")],
      panes: ["a", "b"],
      focusedPane: 1,
      split: "row",
    });
    expect(
      terminalPaneReducer(split, { type: "splitEntered", direction: "column", secondary: "x" }),
    ).toBe(split);
    const single = state({ tabs: [tab("a")], panes: ["a"] });
    expect(
      terminalPaneReducer(single, { type: "splitEntered", direction: "row", secondary: "a" }),
    ).toBe(single);
    expect(
      terminalPaneReducer(single, { type: "splitEntered", direction: "row", secondary: "missing" }),
    ).toBe(single);
  });

  it("收起分屏保留焦点窗格的实例，另一个仍是 Tab", () => {
    const base = state({
      tabs: [tab("a"), tab("b")],
      panes: ["a", "b"],
      focusedPane: 1,
      split: "row",
    });
    const next = terminalPaneReducer(base, { type: "splitExited" });
    expect(next.panes).toEqual(["b"]);
    expect(next.split).toBeNull();
    expect(next.focusedPane).toBe(0);
    expect(next.tabs.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("换向只改方向，窗格与焦点不动", () => {
    const base = state({
      tabs: [tab("a"), tab("b")],
      panes: ["a", "b"],
      focusedPane: 1,
      split: "row",
    });
    const next = terminalPaneReducer(base, { type: "splitDirectionChanged", direction: "column" });
    expect(next.split).toBe("column");
    expect(next.panes).toEqual(["a", "b"]);
    expect(next.focusedPane).toBe(1);
  });

  it("点击已在另一窗格的 Tab 只转移焦点、不搬内容", () => {
    const base = state({
      tabs: [tab("a"), tab("b")],
      panes: ["a", "b"],
      focusedPane: 0,
      split: "row",
    });
    const next = terminalPaneReducer(base, { type: "tabActivated", id: "b" });
    expect(next.panes).toEqual(["a", "b"]);
    expect(next.focusedPane).toBe(1);
  });

  it("点击未显示的 Tab 装入焦点窗格", () => {
    const base = state({
      tabs: [tab("a"), tab("b"), tab("c")],
      panes: ["a", "b"],
      focusedPane: 0,
      split: "row",
    });
    const next = terminalPaneReducer(base, { type: "tabActivated", id: "c" });
    expect(next.panes).toEqual(["c", "b"]);
  });

  it("关闭未显示的实例不动窗格", () => {
    const base = state({
      tabs: [tab("a"), tab("b"), tab("c")],
      panes: ["a", "b"],
      focusedPane: 0,
      split: "row",
    });
    const next = terminalPaneReducer(base, { type: "tabClosed", id: "c" });
    expect(next.panes).toEqual(["a", "b"]);
    expect(next.split).toBe("row");
    expect(next.tabs.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("分屏下关闭焦点窗格的实例：落点插回原位置，另一窗格不动", () => {
    const base = state({
      tabs: [tab("a"), tab("b"), tab("c")],
      panes: ["a", "b"],
      focusedPane: 0,
      split: "row",
    });
    const next = terminalPaneReducer(base, { type: "tabClosed", id: "a" });
    expect(next.panes).toEqual(["c", "b"]);
    expect(next.split).toBe("row");
    expect(next.focusedPane).toBe(0);
  });

  it("分屏下关掉一个窗格、候选只剩另一窗格实例：自动收起分屏", () => {
    const base = state({
      tabs: [tab("a"), tab("b")],
      panes: ["a", "b"],
      focusedPane: 0,
      split: "row",
    });
    const next = terminalPaneReducer(base, { type: "tabClosed", id: "a" });
    expect(next.panes).toEqual(["b"]);
    expect(next.split).toBeNull();
    expect(next.focusedPane).toBe(0);
  });

  it("关闭最后一个实例：窗格与分屏一起清空", () => {
    const base = state({ tabs: [tab("a")], panes: ["a"] });
    const next = terminalPaneReducer(base, { type: "tabClosed", id: "a" });
    expect(next.tabs).toEqual([]);
    expect(next.panes).toEqual([]);
    expect(next.split).toBeNull();
  });

  it("单窗格关闭当前实例：落点接替，不进入分屏", () => {
    const base = state({ tabs: [tab("a"), tab("b")], panes: ["a"] });
    const next = terminalPaneReducer(base, { type: "tabClosed", id: "a" });
    expect(next.panes).toEqual(["b"]);
    expect(next.split).toBeNull();
  });

  it("退出只标状态、重命名只改标题，都不动窗格", () => {
    const base = state({
      tabs: [tab("a"), tab("b")],
      panes: ["a", "b"],
      focusedPane: 1,
      split: "column",
    });
    const exited = terminalPaneReducer(base, { type: "tabExited", id: "b", exitCode: 3 });
    expect(exited.panes).toEqual(["a", "b"]);
    expect(exited.tabs[1]?.exited).toBe(true);
    expect(exited.tabs[1]?.exitCode).toBe(3);
    const renamed = terminalPaneReducer(base, { type: "tabRenamed", id: "a", title: "构建" });
    expect(renamed.tabs[0]?.title).toBe("构建");
    expect(renamed.panes).toEqual(["a", "b"]);
  });

  it("paneFocused 同值或越界原样返回", () => {
    const base = state({
      tabs: [tab("a"), tab("b")],
      panes: ["a", "b"],
      focusedPane: 0,
      split: "row",
    });
    expect(terminalPaneReducer(base, { type: "paneFocused", index: 0 })).toBe(base);
    expect(terminalPaneReducer(base, { type: "paneFocused", index: 2 })).toBe(base);
    expect(terminalPaneReducer(base, { type: "paneFocused", index: -1 })).toBe(base);
    expect(terminalPaneReducer(base, { type: "paneFocused", index: 1 }).focusedPane).toBe(1);
  });

  it("分屏复用的落点：最近的未显示实例，优先未退出的", () => {
    // 没有可复用的（都在窗格里）→ null（调用方新建）
    expect(pickSplitPartner([tab("a"), tab("b")], ["a", "b"])).toBeNull();
    expect(pickSplitPartner([], [])).toBeNull();
    // 只有一个候选且已退出 → 仍复用（比新建更省 pty）
    expect(pickSplitPartner([tab("a"), tab("b", true)], ["a"])?.id).toBe("b");
    // 全存活 → 取最近创建的（tabs 是追加序）
    expect(pickSplitPartner([tab("a"), tab("c"), tab("d")], ["a"])?.id).toBe("d");
    // 最近的已退出、次近的存活 → 取存活的
    expect(pickSplitPartner([tab("a"), tab("c"), tab("d", true)], ["a"])?.id).toBe("c");
    // 候选全退出 → 取最近的那个（不新建）
    expect(pickSplitPartner([tab("a"), tab("c", true), tab("d", true)], ["a"])?.id).toBe("d");
  });

  it("任意动作序列后不变量成立：split 非 null ⟺ 窗格恰两个且不重复，窗格都在 tabs 中", () => {
    const actions: TerminalPaneAction[] = [
      { type: "tabAdded", tab: tab("t1"), install: true },
      { type: "splitEntered", direction: "row", secondary: "t1" },
      { type: "tabAdded", tab: tab("t2"), install: false },
      { type: "splitEntered", direction: "row", secondary: "t2" },
      { type: "tabActivated", id: "t1" },
      { type: "splitDirectionChanged", direction: "column" },
      { type: "splitDirectionChanged", direction: "column" },
      { type: "tabAdded", tab: tab("t3"), install: true },
      { type: "tabActivated", id: "t1" },
      { type: "tabClosed", id: "t2" },
      { type: "tabClosed", id: "t3" },
      { type: "tabAdded", tab: tab("t4", true), install: false },
      { type: "splitEntered", direction: "row", secondary: "t4" },
      { type: "splitExited" },
      { type: "splitExited" },
      { type: "tabClosed", id: "t1" },
      { type: "tabClosed", id: "t4" },
    ];
    let current = INITIAL_PANE_STATE;
    for (const action of actions) {
      current = terminalPaneReducer(current, action);
      if (current.split !== null) {
        expect(current.panes).toHaveLength(2);
        expect(new Set(current.panes).size).toBe(2);
        expect(current.focusedPane).toBeLessThan(2);
      } else {
        expect(current.panes.length).toBeLessThanOrEqual(1);
      }
      for (const id of current.panes) {
        expect(current.tabs.some((item) => item.id === id)).toBe(true);
      }
    }
    expect(current.tabs).toEqual([]);
    expect(current.panes).toEqual([]);
  });
});
