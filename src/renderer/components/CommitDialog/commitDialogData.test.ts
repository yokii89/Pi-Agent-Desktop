import { describe, expect, it } from "vitest";
import type { GitChange } from "../../../shared/ipc";
import { canCommit, formatStat, sumDiffStat } from "./commitDialogData";

function change(partial: Partial<GitChange>): GitChange {
  return {
    path: "src/a.ts",
    oldPath: null,
    status: "modified",
    layer: "unstaged",
    additions: 1,
    deletions: 1,
    ...partial,
  };
}

describe("sumDiffStat", () => {
  it("累加增删行，二进制文件的 null 按 0 计", () => {
    const stat = sumDiffStat([
      change({ path: "a.ts", additions: 120, deletions: 30 }),
      change({ path: "b.png", additions: null, deletions: null }),
    ]);
    expect(stat).toEqual({ additions: 120, deletions: 30 });
  });

  it("空列表为 0", () => {
    expect(sumDiffStat([])).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("canCommit", () => {
  it("说明、改动、空闲三者齐备才可提交", () => {
    expect(
      canCommit({
        message: "fix: 修正",
        includeUnstaged: true,
        changeCount: 2,
        stagedCount: 0,
        busy: false,
      }),
    ).toBe(true);
  });

  it("说明只有空白时不可提交", () => {
    expect(
      canCommit({
        message: "  \n ",
        includeUnstaged: true,
        changeCount: 2,
        stagedCount: 0,
        busy: false,
      }),
    ).toBe(false);
  });

  it("勾选包含未暂存：工作区有改动即可", () => {
    expect(
      canCommit({
        message: "x",
        includeUnstaged: true,
        changeCount: 1,
        stagedCount: 0,
        busy: false,
      }),
    ).toBe(true);
  });

  it("不勾选时必须有已暂存改动", () => {
    const base = { message: "x", includeUnstaged: false, changeCount: 3, busy: false };
    expect(canCommit({ ...base, stagedCount: 0 })).toBe(false);
    expect(canCommit({ ...base, stagedCount: 1 })).toBe(true);
  });

  it("在途写操作期间一律不可提交", () => {
    expect(
      canCommit({
        message: "x",
        includeUnstaged: true,
        changeCount: 1,
        stagedCount: 1,
        busy: true,
      }),
    ).toBe(false);
  });
});

describe("formatStat", () => {
  it("按界面语言加千分位", () => {
    expect(formatStat(1995, "zh-CN")).toBe("1,995");
    expect(formatStat(1995, "en-US")).toBe("1,995");
    expect(formatStat(42, "zh-CN")).toBe("42");
  });
});
