import { describe, expect, it } from "vitest";
import { isCanonicalCombo } from "../../shared/shortcuts";
import {
  ACTION_REGISTRY,
  BINDABLE_ACTION_IDS,
  DEFAULT_SHORTCUTS,
  findActionByCombo,
  SHORTCUT_BINDINGS,
} from "./actionRegistry";

describe("actionRegistry", () => {
  it("动作 id 全表唯一", () => {
    const ids = ACTION_REGISTRY.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每条动作都有标签键与检索关键词", () => {
    for (const action of ACTION_REGISTRY) {
      expect(action.labelKey.length).toBeGreaterThan(0);
      expect(action.keywords.length).toBeGreaterThan(0);
    }
  });

  it("可绑定 id 清单与注册表的 defaultCombo 集合严格一致", () => {
    const fromRegistry = ACTION_REGISTRY.filter((a) => a.defaultCombo !== null).map((a) => a.id);
    expect([...BINDABLE_ACTION_IDS].sort()).toEqual([...fromRegistry].sort());
  });

  it("DEFAULT_SHORTCUTS 与注册表默认键一致且全部合法", () => {
    expect(Object.keys(DEFAULT_SHORTCUTS).sort()).toEqual([...BINDABLE_ACTION_IDS].sort());
    for (const action of ACTION_REGISTRY) {
      if (action.defaultCombo === null) continue;
      expect(isCanonicalCombo(action.defaultCombo)).toBe(true);
      expect(DEFAULT_SHORTCUTS[action.id as keyof typeof DEFAULT_SHORTCUTS]).toBe(
        action.defaultCombo,
      );
    }
  });

  it("默认键互不冲突、不撞保留组合", () => {
    const seen = new Map<string, string>();
    for (const action of ACTION_REGISTRY) {
      if (action.defaultCombo === null) continue;
      const owner = seen.get(action.defaultCombo);
      expect(owner, `${action.defaultCombo} 被 ${owner} 与 ${action.id} 同时占用`).toBeUndefined();
      seen.set(action.defaultCombo, action.id);
    }
  });

  it("SHORTCUT_BINDINGS 与 BINDABLE_ACTION_IDS 顺序一致（归一优先级）", () => {
    expect(SHORTCUT_BINDINGS.map((b) => b.id)).toEqual([...BINDABLE_ACTION_IDS]);
  });

  it("findActionByCombo 命中默认键并尊重当前映射", () => {
    expect(findActionByCombo(DEFAULT_SHORTCUTS, "Ctrl+N")?.id).toBe("newTask");
    expect(findActionByCombo(DEFAULT_SHORTCUTS, "Alt+1")?.id).toBe("goSession");
    // 用户改键后按新映射命中
    expect(findActionByCombo({ ...DEFAULT_SHORTCUTS, newTask: "Ctrl+J" }, "Ctrl+J")?.id).toBe(
      "newTask",
    );
    // 纯面板命令与非法组合不命中
    expect(findActionByCombo(DEFAULT_SHORTCUTS, "Ctrl+C")).toBeNull();
    expect(findActionByCombo(DEFAULT_SHORTCUTS, "n")).toBeNull();
  });
});
