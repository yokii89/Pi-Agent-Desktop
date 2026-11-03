import { describe, expect, it } from "vitest";
import type { GitChange } from "../../shared/ipc";
import { findChangeFocus } from "./reviewFocus";

const REPO = "D:/proj";
const CWD = "D:/proj";

function change(
  path: string,
  layer: GitChange["layer"] = "unstaged",
  oldPath: string | null = null,
): GitChange {
  return { path, oldPath, status: "modified", layer, additions: 1, deletions: 1 };
}

describe("findChangeFocus", () => {
  it("仓库相对路径命中本轮改动，口径切 lastRound", () => {
    const round = [change("src/a.ts")];
    const all = [...round, change("src/b.ts", "staged")];
    expect(findChangeFocus("src/a.ts", round, all, REPO, CWD)).toEqual({
      change: round[0],
      source: "lastRound",
    });
  });

  it("只在全量改动里命中时口径切 all", () => {
    const all = [change("src/b.ts", "staged")];
    const hit = findChangeFocus("src/b.ts", [], all, REPO, CWD);
    expect(hit?.source).toBe("all");
    expect(hit?.change.path).toBe("src/b.ts");
  });

  it("绝对路径剥仓库根后匹配；反斜杠与大小写不影响命中", () => {
    const all = [change("Src/A.ts")];
    expect(findChangeFocus("D:\\proj\\src\\a.ts", [], all, REPO, CWD)?.source).toBe("all");
  });

  it("绝对路径带 :line:col 定位后缀仍能命中", () => {
    const all = [change("src/a.ts")];
    expect(findChangeFocus("D:/proj/src/a.ts:12:3", [], all, REPO, CWD)).not.toBeNull();
  });

  it("会话目录在仓库子目录时，相对 cwd 的展示路径也命中", () => {
    const all = [change("packages/app/src/a.ts")];
    const hit = findChangeFocus("src/a.ts", [], all, REPO, "D:/proj/packages/app");
    expect(hit?.change.path).toBe("packages/app/src/a.ts");
  });

  it("rename 条目按原路径也能命中", () => {
    const all = [change("src/new.ts", "staged", "src/old.ts")];
    expect(findChangeFocus("src/old.ts", [], all, REPO, CWD)?.change.path).toBe("src/new.ts");
  });

  it("仓库外的绝对路径不命中，交回调用方兜底", () => {
    const all = [change("src/a.ts")];
    expect(findChangeFocus("C:/other/src/a.ts", [], all, REPO, CWD)).toBeNull();
    // 仓库根未知：绝对展示路径剥不出相对形态
    expect(findChangeFocus("D:/proj/src/a.ts", [], all, null, null)).toBeNull();
  });

  it("空路径不命中", () => {
    expect(findChangeFocus("", [], [], REPO, CWD)).toBeNull();
  });

  it("本轮优先于全量：同一路径两层都在时取 lastRound 条目", () => {
    const round = [change("src/a.ts", "staged")];
    const all = [change("src/a.ts"), ...round];
    expect(findChangeFocus("src/a.ts", round, all, REPO, CWD)?.change).toBe(round[0]);
  });
});
