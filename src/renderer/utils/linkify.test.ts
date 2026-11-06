import { describe, expect, it } from "vitest";
import { splitMessageUrls } from "./linkify";

describe("splitMessageUrls", () => {
  it("中英混排：URL 与前后文本切成 text/url 片段", () => {
    const text =
      "这是个GitHub https://github.com/ismailsaleekh/pi-background-tasks.git 这是个b站 https://www.bilibili.com/v/popular/all?spm_id_from=333.1007.0.0";
    expect(splitMessageUrls(text)).toEqual([
      { kind: "text", value: "这是个GitHub " },
      { kind: "url", value: "https://github.com/ismailsaleekh/pi-background-tasks.git" },
      { kind: "text", value: " 这是个b站 " },
      { kind: "url", value: "https://www.bilibili.com/v/popular/all?spm_id_from=333.1007.0.0" },
    ]);
  });

  it("URL 后直接跟中文标点（无空格）不吞正文", () => {
    const text = "访问 https://x.com，然后看 https://y.com。好了";
    expect(splitMessageUrls(text)).toEqual([
      { kind: "text", value: "访问 " },
      { kind: "url", value: "https://x.com" },
      { kind: "text", value: "，然后看 " },
      { kind: "url", value: "https://y.com" },
      { kind: "text", value: "。好了" },
    ]);
  });

  it("尾部英文句点修剪，路径里的点保留", () => {
    expect(splitMessageUrls("去 https://x.com.")).toEqual([
      { kind: "text", value: "去 " },
      { kind: "url", value: "https://x.com" },
      { kind: "text", value: "." },
    ]);
    expect(splitMessageUrls("https://x.com/a.b.c")).toEqual([
      { kind: "url", value: "https://x.com/a.b.c" },
    ]);
  });

  it("不配对括号修剪，配对括号保留", () => {
    expect(splitMessageUrls("（见 https://x.com/a(b)）")).toEqual([
      { kind: "text", value: "（见 " },
      { kind: "url", value: "https://x.com/a(b)" },
      { kind: "text", value: "）" },
    ]);
    expect(splitMessageUrls("https://x.com/(v1)")).toEqual([
      { kind: "url", value: "https://x.com/(v1)" },
    ]);
  });

  it("中文路径（IRI）完整保留", () => {
    expect(splitMessageUrls("词条 https://zh.wikipedia.org/wiki/矩阵 说明")).toEqual([
      { kind: "text", value: "词条 " },
      { kind: "url", value: "https://zh.wikipedia.org/wiki/矩阵" },
      { kind: "text", value: " 说明" },
    ]);
  });

  it("无 URL 与空串原样返回", () => {
    expect(splitMessageUrls("纯文本 /usr/bin/pnpm 不是 URL")).toEqual([
      { kind: "text", value: "纯文本 /usr/bin/pnpm 不是 URL" },
    ]);
    expect(splitMessageUrls("")).toEqual([]);
  });

  it("半角括号包裹同样只剪不配对的那只", () => {
    expect(splitMessageUrls("(https://x.com/a)")).toEqual([
      { kind: "text", value: "(" },
      { kind: "url", value: "https://x.com/a" },
      { kind: "text", value: ")" },
    ]);
  });

  it("只有 scheme 的残缺串不成链（剪到空即回落正文）", () => {
    expect(splitMessageUrls("地址是 https:// 还没填")).toEqual([
      { kind: "text", value: "地址是 https:// 还没填" },
    ]);
  });

  it("连续 URL 与开头 URL", () => {
    expect(splitMessageUrls("https://a.com/1，https://b.com/2")).toEqual([
      { kind: "url", value: "https://a.com/1" },
      { kind: "text", value: "，" },
      { kind: "url", value: "https://b.com/2" },
    ]);
  });
});
