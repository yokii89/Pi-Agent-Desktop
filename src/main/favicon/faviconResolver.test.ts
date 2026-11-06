import { describe, expect, it } from "vitest";
import {
  classifyIconResponse,
  extractFaviconOrigin,
  extractIconHrefs,
  mimeToExt,
} from "./faviconResolver";

describe("extractFaviconOrigin", () => {
  it("http(s) URL 取 origin（含端口）", () => {
    expect(extractFaviconOrigin("https://github.com/owner/repo.git")).toBe("https://github.com");
    expect(extractFaviconOrigin("http://localhost:5173/path?q=1")).toBe("http://localhost:5173");
    expect(extractFaviconOrigin("HTTPS://EXAMPLE.COM/A")).toBe("https://example.com");
  });

  it("非 http(s) 与非法输入返回 null", () => {
    expect(extractFaviconOrigin("file:///D:/a/b.png")).toBeNull();
    expect(extractFaviconOrigin("ftp://example.com")).toBeNull();
    expect(extractFaviconOrigin("不是 URL")).toBeNull();
    expect(extractFaviconOrigin("")).toBeNull();
  });
});

describe("extractIconHrefs", () => {
  it("按文档顺序提取 rel 含 icon 的 link，相对路径按 base 解析", () => {
    const html = [
      '<link rel="stylesheet" href="/style.css">',
      '<link rel="shortcut icon" href="/favicon.ico">',
      '<link rel="apple-touch-icon" href="icons/touch.png">',
      '<link rel="preload" href="/font.woff2">',
    ].join("");
    expect(extractIconHrefs(html, "https://example.com/app/")).toEqual([
      "https://example.com/favicon.ico",
      "https://example.com/app/icons/touch.png",
    ]);
  });

  it("属性顺序无关、单双引号与无引号均可", () => {
    const html = [
      "<link href='/a.ico' REL=icon>",
      '<link rel="mask-icon" href="/b.svg" color="#111">',
    ].join("");
    expect(extractIconHrefs(html, "https://example.com")).toEqual([
      "https://example.com/a.ico",
      "https://example.com/b.svg",
    ]);
  });

  it("data:image 直通，非法与 javascript: 候选跳过", () => {
    const html = [
      '<link rel="icon" href="javascript:alert(1)">',
      '<link rel="icon" href="data:image/png;base64,AAAA">',
      '<link rel="icon" href="http s://broken">',
    ].join("");
    expect(extractIconHrefs(html, "https://example.com")).toEqual(["data:image/png;base64,AAAA"]);
  });

  it("超过上限时截断", () => {
    const html = Array.from({ length: 5 }, (_, i) => `<link rel="icon" href="/i${i}.ico">`).join(
      "",
    );
    expect(extractIconHrefs(html, "https://example.com", 2)).toEqual([
      "https://example.com/i0.ico",
      "https://example.com/i1.ico",
    ]);
  });
});

describe("mimeToExt", () => {
  it("常见图片 MIME 映射扩展名", () => {
    expect(mimeToExt("image/png")).toBe("png");
    expect(mimeToExt("image/jpeg")).toBe("jpg");
    expect(mimeToExt("image/x-icon")).toBe("ico");
    expect(mimeToExt("image/svg+xml; charset=utf-8")).toBe("svg");
  });

  it("未知 MIME 落 bin", () => {
    expect(mimeToExt("application/octet-stream")).toBe("bin");
    expect(mimeToExt("")).toBe("bin");
  });
});

describe("classifyIconResponse", () => {
  it("2xx 图片才是 ok", () => {
    expect(classifyIconResponse(200, "image/png")).toBe("ok");
    expect(classifyIconResponse(200, "image/svg+xml; charset=utf-8")).toBe("ok");
    expect(classifyIconResponse(200, "IMAGE/X-ICON")).toBe("ok");
  });

  it("确认没有的位置算 absent，不去追问下一路也不算抖动", () => {
    expect(classifyIconResponse(404, "text/html")).toBe("absent");
    expect(classifyIconResponse(410, "text/html")).toBe("absent");
    // 门户/网关把 /favicon.ico 换成页面：这一步没有图标，但 link 发现仍可能找到
    expect(classifyIconResponse(200, "text/html")).toBe("absent");
    expect(classifyIconResponse(200, "")).toBe("absent");
  });

  it("抖动不背「这站没图标」的锅", () => {
    expect(classifyIconResponse(500, "text/plain")).toBe("retry");
    expect(classifyIconResponse(503, "text/plain")).toBe("retry");
    expect(classifyIconResponse(429, "text/html")).toBe("retry");
    expect(classifyIconResponse(403, "text/html")).toBe("retry");
    expect(classifyIconResponse(302, "text/html")).toBe("retry");
  });
});
