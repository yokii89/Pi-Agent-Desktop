import { describe, expect, it } from "vitest";
import {
  eventToCombo,
  findConflict,
  isCanonicalCombo,
  matchesCombo,
  normalizeShortcutsMap,
  parseEventCombo,
  type ShortcutBinding,
  sanitizeShortcutsRecord,
} from "./shortcuts";

const ev = (
  key: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {},
  code?: string,
) => ({
  key,
  code,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
  metaKey: mods.meta ?? false,
});

/** 测试用绑定清单（对齐注册表的存量五键 + 方向键导航）。 */
const BINDINGS: ShortcutBinding[] = [
  { id: "newTask", defaultCombo: "Ctrl+N" },
  { id: "openFiles", defaultCombo: "Ctrl+P" },
  { id: "toggleTerminal", defaultCombo: "Ctrl+T" },
  { id: "toggleSidebar", defaultCombo: "Ctrl+B" },
  { id: "openCommandPalette", defaultCombo: "Ctrl+Shift+P" },
  { id: "nextSession", defaultCombo: "Alt+ArrowDown" },
  { id: "prevSession", defaultCombo: "Alt+ArrowUp" },
];
const DEFAULTS: Record<string, string> = Object.fromEntries(
  BINDINGS.map((b) => [b.id, b.defaultCombo as string]),
);

describe("isCanonicalCombo", () => {
  it("接受 Ctrl+字母与含 Shift 的组合", () => {
    expect(isCanonicalCombo("Ctrl+N")).toBe(true);
    expect(isCanonicalCombo("Ctrl+Shift+K")).toBe(true);
    expect(isCanonicalCombo("Alt+F5")).toBe(true);
    expect(isCanonicalCombo("Ctrl+Shift+1")).toBe(true);
  });

  it("接受方向键主键", () => {
    expect(isCanonicalCombo("Alt+ArrowDown")).toBe(true);
    expect(isCanonicalCombo("Ctrl+Alt+ArrowUp")).toBe(true);
    expect(eventToCombo(ev("ArrowDown", { alt: true }, "ArrowDown"))).toBe("Alt+ArrowDown");
    expect(eventToCombo(ev("ArrowUp", { alt: true }))).toBe("Alt+ArrowUp");
  });

  it("拒绝缺修饰键 / Meta / 重复修饰 / 未知主键 / 保留组合", () => {
    expect(isCanonicalCombo("N")).toBe(false);
    expect(isCanonicalCombo("Meta+N")).toBe(false);
    expect(isCanonicalCombo("Ctrl+Ctrl+N")).toBe(false);
    expect(isCanonicalCombo("Ctrl+Esc")).toBe(false);
    expect(isCanonicalCombo("Shift+N")).toBe(false);
    expect(isCanonicalCombo("Ctrl+C")).toBe(false);
    expect(isCanonicalCombo("Ctrl+V")).toBe(false);
    // 方向键也不能单键 / 只配 Shift
    expect(isCanonicalCombo("ArrowDown")).toBe(false);
    expect(isCanonicalCombo("Shift+ArrowDown")).toBe(false);
  });
});

describe("eventToCombo / parseEventCombo", () => {
  it("生成 canonical 串并归一大小写", () => {
    expect(eventToCombo(ev("n", { ctrl: true }, "KeyN"))).toBe("Ctrl+N");
    expect(eventToCombo(ev("n", { ctrl: true }))).toBe("Ctrl+N");
    expect(eventToCombo(ev("K", { ctrl: true, shift: true }, "KeyK"))).toBe("Ctrl+Shift+K");
    expect(eventToCombo(ev("F5", { alt: true }))).toBe("Alt+F5");
  });

  it("Shift+数字经 code 录成 Digit，不受 key 符号影响", () => {
    expect(eventToCombo(ev("!", { ctrl: true, shift: true }, "Digit1"))).toBe("Ctrl+Shift+1");
    expect(eventToCombo(ev("!", { ctrl: true, shift: true }))).toBeNull();
    expect(parseEventCombo(ev("!", { ctrl: true, shift: true }, "Digit1"))).toEqual({
      type: "combo",
      combo: "Ctrl+Shift+1",
    });
  });

  it("纯修饰键静默；缺 Ctrl·Alt / 含 Meta / 保留组合不匹配", () => {
    expect(parseEventCombo(ev("Control", { ctrl: true }, "ControlLeft")).type).toBe("modifier");
    expect(eventToCombo(ev("a", { shift: true }))).toBeNull();
    expect(eventToCombo(ev("n", { meta: true, ctrl: true }, "KeyN"))).toBeNull();
    expect(eventToCombo(ev("Escape", { ctrl: true }))).toBeNull();
    expect(eventToCombo(ev("/", { ctrl: true }))).toBeNull();

    const reserved = parseEventCombo(ev("c", { ctrl: true }, "KeyC"));
    expect(reserved).toEqual({ type: "reserved", combo: "Ctrl+C" });
    expect(eventToCombo(ev("c", { ctrl: true }, "KeyC"))).toBeNull();
  });
});

describe("matchesCombo / findConflict / normalizeShortcutsMap", () => {
  it("matchesCombo 与 eventToCombo 一致", () => {
    expect(matchesCombo("Ctrl+N", ev("n", { ctrl: true }, "KeyN"))).toBe(true);
    expect(matchesCombo("Ctrl+N", ev("n", { ctrl: true, shift: true }, "KeyN"))).toBe(false);
    expect(matchesCombo("Ctrl+Shift+1", ev("!", { ctrl: true, shift: true }, "Digit1"))).toBe(true);
    expect(matchesCombo("Alt+ArrowDown", ev("ArrowDown", { alt: true }, "ArrowDown"))).toBe(true);
  });

  it("findConflict 跳过 exceptId 与纯面板命令", () => {
    expect(findConflict(BINDINGS, DEFAULTS, "Ctrl+N")).toBe("newTask");
    expect(findConflict(BINDINGS, DEFAULTS, "Ctrl+N", "newTask")).toBeNull();
    const withPanelOnly: ShortcutBinding[] = [...BINDINGS, { id: "themeDark", defaultCombo: null }];
    expect(findConflict(withPanelOnly, { ...DEFAULTS, themeDark: "Ctrl+N" }, "Ctrl+N")).toBe(
      "newTask",
    );
  });

  it("normalizeShortcutsMap 回退非法值并消解冲突", () => {
    expect(normalizeShortcutsMap(BINDINGS, DEFAULTS, null)).toEqual(DEFAULTS);
    expect(normalizeShortcutsMap(BINDINGS, DEFAULTS, { newTask: "n" })).toEqual(DEFAULTS);
    expect(normalizeShortcutsMap(BINDINGS, DEFAULTS, { newTask: "Ctrl+C" })).toEqual(DEFAULTS);
    const merged = normalizeShortcutsMap(BINDINGS, DEFAULTS, {
      newTask: "Ctrl+Shift+N",
      openFiles: "Ctrl+Shift+N",
      toggleTerminal: "nope",
    });
    expect(merged.newTask).toBe("Ctrl+Shift+N");
    expect(merged.openFiles).toBe(DEFAULTS.openFiles);
    expect(merged.toggleTerminal).toBe(DEFAULTS.toggleTerminal);
    expect(merged.toggleSidebar).toBe(DEFAULTS.toggleSidebar);
  });

  it("注册表顺序即归一优先级：先登记者赢得冲突组合", () => {
    const merged = normalizeShortcutsMap(BINDINGS, DEFAULTS, {
      newTask: "Ctrl+J",
      openFiles: "Ctrl+J",
    });
    expect(merged.newTask).toBe("Ctrl+J");
    expect(merged.openFiles).toBe(DEFAULTS.openFiles);
  });

  it("未知 id（已删除动作的残留）不进归一结果", () => {
    const merged = normalizeShortcutsMap(BINDINGS, DEFAULTS, {
      legacyAction: "Ctrl+G",
      newTask: "Ctrl+N",
    });
    expect(merged).toEqual({ ...DEFAULTS, newTask: "Ctrl+N" });
  });
});

describe("sanitizeShortcutsRecord", () => {
  it("只保留 string → string 键值", () => {
    expect(sanitizeShortcutsRecord({ newTask: "Ctrl+N", bad: 3, worse: null, arr: ["x"] })).toEqual(
      { newTask: "Ctrl+N" },
    );
    expect(sanitizeShortcutsRecord(null)).toEqual({});
    expect(sanitizeShortcutsRecord(["Ctrl+N"])).toEqual({});
  });
});
