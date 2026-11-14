import { describe, expect, it } from "vitest";
import { applyLineEnding, detectLineEnding, toSavedContent } from "./lineEndings";

describe("detectLineEnding", () => {
  it("纯 LF 判 lf", () => {
    expect(detectLineEnding("a\nb\n")).toBe("lf");
  });

  it("含 \\r\\n 判 crlf", () => {
    expect(detectLineEnding("a\r\nb\r\n")).toBe("crlf");
  });

  it("单行无换行按 lf", () => {
    expect(detectLineEnding("a")).toBe("lf");
  });

  it("混合行尾按 crlf（保持原样而非归一）", () => {
    expect(detectLineEnding("a\r\nb\n")).toBe("crlf");
  });
});

describe("applyLineEnding", () => {
  it("crlf 还原每一行", () => {
    expect(applyLineEnding("a\nb\n", "crlf")).toBe("a\r\nb\r\n");
  });

  it("lf 同时清掉杂散的 \\r", () => {
    expect(applyLineEnding("a\r\nb\rc", "lf")).toBe("a\nb\nc");
  });

  it("不重复叠加 \\r（已是 crlf 时保持一份）", () => {
    expect(applyLineEnding("a\r\nb", "crlf")).toBe("a\r\nb");
  });
});

describe("toSavedContent", () => {
  it("LF 文件原样返回", () => {
    expect(toSavedContent("a\nb\n", "x\ny\n")).toBe("a\nb\n");
  });

  it("CRLF 文件保存时还原行尾", () => {
    expect(toSavedContent("a\nb\n", "x\r\ny\r\n")).toBe("a\r\nb\r\n");
  });

  it("原文件末尾有换行、编辑后删掉时补回", () => {
    expect(toSavedContent("a\nb", "x\ny\n")).toBe("a\nb\n");
  });

  it("原文件末尾无换行、编辑后多出时去掉", () => {
    expect(toSavedContent("a\nb\n", "x\ny")).toBe("a\nb");
  });

  it("空原文件不做末尾换行修正（新写入的行尾由编辑器内容决定）", () => {
    expect(toSavedContent("hello\n", "")).toBe("hello\n");
  });
});
