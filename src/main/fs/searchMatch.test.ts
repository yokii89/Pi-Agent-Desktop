import { describe, expect, it } from "vitest";
import { isSubsequence, matchesFileQuery } from "./searchMatch";

describe("isSubsequence", () => {
  it("按序命中", () => {
    expect(isSubsequence("upr", "usepaletteresults.ts")).toBe(true);
    expect(isSubsequence("ftree", "filetree.tsx")).toBe(true);
  });

  it("乱序不命中", () => {
    expect(isSubsequence("pu", "usepalette.ts")).toBe(false);
  });

  it("空 needle 恒命中", () => {
    expect(isSubsequence("", "anything")).toBe(true);
  });
});

describe("matchesFileQuery", () => {
  it("子序列召回：缩写能命中全名（原 includes 语义召不回）", () => {
    expect(
      matchesFileQuery("usePaletteResults.ts", "src/renderer/usePaletteResults.ts", "upr"),
    ).toBe(true);
  });

  it("子串仍然命中（向后兼容）", () => {
    expect(matchesFileQuery("palette.tsx", "src/commandPalette.tsx", "palette")).toBe(true);
    // 连续路径片段（含分隔符）两种语义都命中
    expect(matchesFileQuery("o.ts", "src/palette/o.ts", "src/pal")).toBe(true);
    // 查询自带分隔符时它必须真实存在于路径中（与旧 includes 语义一致，不算回退）
    expect(matchesFileQuery("palette.tsx", "src/commandPalette.tsx", "command/pal")).toBe(false);
  });

  it("多词查询：每个词都要命中（name 或 relPath 二选一）", () => {
    expect(matchesFileQuery("tree.tsx", "src/panels/FileTree.tsx", "file tree")).toBe(true);
    expect(matchesFileQuery("tree.tsx", "src/panels/FileTree.tsx", "tree nomatch")).toBe(false);
  });

  it("大小写不敏感", () => {
    expect(matchesFileQuery("FileTree.tsx", "src/FileTree.tsx", "ft")).toBe(true);
  });

  it("空查询 = 浏览模式恒命中", () => {
    expect(matchesFileQuery("anything.txt", "src/anything.txt", "  ")).toBe(true);
  });
});
