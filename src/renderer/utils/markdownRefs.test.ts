import { describe, expect, it } from "vitest";
import { normalizeFenceLang, resolveMarkdownRef } from "./markdownRefs";

describe("resolveMarkdownRef", () => {
  const md = "D:\\docs\\project\\README.md";

  it("相对路径基于 md 所在目录拼接并归一化 ./ ../", () => {
    expect(resolveMarkdownRef("./img/a.png", md)).toBe("D:\\docs\\project\\img\\a.png");
    expect(resolveMarkdownRef("img/a.png", md)).toBe("D:\\docs\\project\\img\\a.png");
    expect(resolveMarkdownRef("../assets/logo.svg", md)).toBe("D:\\docs\\assets\\logo.svg");
    expect(resolveMarkdownRef("../../outside/x.md", md)).toBe("D:\\outside\\x.md");
    // 越出根：截断在根，不产生 D:\..
    expect(resolveMarkdownRef("../../../../../etc/x.png", md)).toBe("D:\\etc\\x.png");
  });

  it("URL 编码被解码，非法百分号转义按原文处理", () => {
    expect(resolveMarkdownRef("./my%20image.png", md)).toBe("D:\\docs\\project\\my image.png");
    expect(resolveMarkdownRef("./100%.png", md)).toBe("D:\\docs\\project\\100%.png");
  });

  it("绝对路径（盘符 / POSIX 根）直接归一化，忽略 md 所在目录", () => {
    expect(resolveMarkdownRef("D:/other/pic.png", md)).toBe("D:/other/pic.png");
    expect(resolveMarkdownRef("D:\\other\\pic.png", md)).toBe("D:\\other\\pic.png");
    expect(resolveMarkdownRef("C:\\temp\\a.jpg", md)).toBe("C:\\temp\\a.jpg");
    expect(resolveMarkdownRef("/usr/share/i.png", "/home/u/README.md")).toBe("/usr/share/i.png");
  });

  it("file:// 剥协议取 pathname（去掉 Windows 盘符前多出的 /）", () => {
    expect(resolveMarkdownRef("file:///D:/x/y.png", md)).toBe("D:/x/y.png");
    expect(resolveMarkdownRef("file:///home/u/i.png", "/home/u/README.md")).toBe("/home/u/i.png");
  });

  it("非本地引用返回 null：http(s)、data、mailto、锚点", () => {
    expect(resolveMarkdownRef("https://example.com/a.png", md)).toBeNull();
    expect(resolveMarkdownRef("http://example.com/a.png", md)).toBeNull();
    expect(resolveMarkdownRef("data:image/png;base64,AAAA", md)).toBeNull();
    expect(resolveMarkdownRef("mailto:a@b.c", md)).toBeNull();
    expect(resolveMarkdownRef("#section", md)).toBeNull();
    expect(resolveMarkdownRef("", md)).toBeNull();
    expect(resolveMarkdownRef("   ", md)).toBeNull();
  });
});

describe("normalizeFenceLang", () => {
  it("常见别名归一为 shiki 语言 id", () => {
    expect(normalizeFenceLang("ts")).toBe("typescript");
    expect(normalizeFenceLang("TS")).toBe("typescript");
    expect(normalizeFenceLang("js")).toBe("javascript");
    expect(normalizeFenceLang("sh")).toBe("bash");
    expect(normalizeFenceLang("shell")).toBe("bash");
    expect(normalizeFenceLang("py")).toBe("python");
    expect(normalizeFenceLang("yml")).toBe("yaml");
    expect(normalizeFenceLang("c++")).toBe("cpp");
    expect(normalizeFenceLang("cs")).toBe("csharp");
  });

  it("非别名语言原样返回（shiki 侧再降级）", () => {
    expect(normalizeFenceLang("rust")).toBe("rust");
    expect(normalizeFenceLang("SomeUnknown")).toBe("someunknown");
  });

  it("剥离元数据：行号标记 / 大括号高亮段 / meta 后缀", () => {
    expect(normalizeFenceLang("ts {1,3-4}")).toBe("typescript");
    expect(normalizeFenceLang("python title=app.py")).toBe("python");
    expect(normalizeFenceLang("ts:line-numbers")).toBe("typescript");
    expect(normalizeFenceLang("")).toBe("plaintext");
    expect(normalizeFenceLang("   ")).toBe("plaintext");
  });
});
