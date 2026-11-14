import { describe, expect, it } from "vitest";
import { findMatchOffsets } from "./previewFind";

describe("findMatchOffsets", () => {
  it("空查询不产生命中", () => {
    expect(findMatchOffsets("abcabc", "")).toEqual([]);
  });

  it("大小写不敏感且给出全部命中", () => {
    expect(findMatchOffsets("Foo bar foo FOO", "foo")).toEqual([
      [0, 3],
      [8, 11],
      [12, 15],
    ]);
  });

  it("命中互不重叠（命中后从末尾继续找）", () => {
    expect(findMatchOffsets("aaaa", "aa")).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it("没有命中时返回空数组", () => {
    expect(findMatchOffsets("hello", "zzz")).toEqual([]);
  });

  it("保留查询里的空格（查找整段原文）", () => {
    expect(findMatchOffsets("const a = 1", "a = 1")).toEqual([[6, 11]]);
  });
});
