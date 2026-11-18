import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { markdownUrlTransform, resolveMarkdownImageSource } from "./markdownImageSource";

describe("Markdown 图片来源", () => {
  it("会话相对路径基于 cwd，文件预览优先基于源文件目录", () => {
    expect(resolveMarkdownImageSource("./out/图%20片.png", null, "D:/project")).toEqual({
      kind: "local",
      path: "D:/project/out/图 片.png",
    });
    expect(resolveMarkdownImageSource("../image.png", "D:/docs/guide/page.md", "C:/other")).toEqual(
      {
        kind: "local",
        path: "D:/docs/image.png",
      },
    );
    expect(resolveMarkdownImageSource("out/image.png")).toBeNull();
  });

  it("绝对路径与 file URL 不依赖当前会话目录", () => {
    expect(resolveMarkdownImageSource("D:/out/image.png")).toEqual({
      kind: "local",
      path: "D:/out/image.png",
    });
    expect(resolveMarkdownImageSource("/D:/out/image.png")).toEqual({
      kind: "local",
      path: "D:/out/image.png",
    });
    expect(resolveMarkdownImageSource("D:%5Cout%5Cimage.png")).toEqual({
      kind: "local",
      path: "D:\\out\\image.png",
    });
    expect(resolveMarkdownImageSource("file:///D:/out/image%20one.png")).toEqual({
      kind: "local",
      path: "D:/out/image one.png",
    });
    expect(resolveMarkdownImageSource("/tmp/image.png")).toEqual({
      kind: "local",
      path: "/tmp/image.png",
    });
  });

  it("网络和内嵌图片保持图片来源，其余协议不当作图片", () => {
    expect(resolveMarkdownImageSource("https://example.com/图.png")).toEqual({
      kind: "url",
      url: "https://example.com/%E5%9B%BE.png",
    });
    const data = "data:image/png;base64,AAAA";
    expect(resolveMarkdownImageSource(data)).toEqual({ kind: "url", url: data });
    for (const src of [
      "",
      "#x",
      "javascript:alert(1)",
      "data:text/html,test",
      "data:image/not-real,AAAA",
      "ftp://example.com/a.png",
      "https://",
    ]) {
      expect(resolveMarkdownImageSource(src)).toBeNull();
    }
  });

  it("本地路径可用于链接，data URL 只允许图片，危险协议仍被过滤", () => {
    for (const url of ["D:/out/a.png", "file:///D:/a.png"]) {
      expect(markdownUrlTransform(url, "src")).toBe(url);
      expect(markdownUrlTransform(url, "href")).toBe(url);
    }
    expect(markdownUrlTransform("data:image/png;base64,AAAA", "src")).toBe(
      "data:image/png;base64,AAAA",
    );
    for (const url of [
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
      "vbscript:test",
      "data:text/html,test",
    ]) {
      expect(markdownUrlTransform(url, "href")).toBe("");
    }
    expect(markdownUrlTransform("javascript:alert(1)", "src")).toBe("");
    expect(markdownUrlTransform("data:text/html,hello", "src")).toBe("");
  });

  it("实际 Markdown 链接保留目录、图片、空格、反斜杠和行号", () => {
    const links: string[] = [];
    renderToStaticMarkup(
      createElement(
        Markdown,
        {
          urlTransform: markdownUrlTransform,
          components: {
            a: ({ href }) => {
              links.push(href ?? "");
              return null;
            },
          },
        },
        [
          "[截图目录](D:/Code/PI/pidesk/temp/composer-drop-ui/screenshots)",
          "[PNG](D:/out/a.png)",
          "[空格](<D:/my files/a.png>)",
          "[反斜杠](D:\\out\\a.png)",
          "[行号](D:/out/a.ts:12:3)",
          "[网页](https://example.com)",
        ].join("\n\n"),
      ),
    );
    expect(links).toEqual([
      "D:/Code/PI/pidesk/temp/composer-drop-ui/screenshots",
      "D:/out/a.png",
      "D:/my%20files/a.png",
      "D:%5Cout%5Ca.png",
      "D:/out/a.ts:12:3",
      "https://example.com",
    ]);
  });

  it("实际 Markdown 解析不会在进入图片组件前清掉盘符和 data 来源", () => {
    const sources: string[] = [];
    renderToStaticMarkup(
      createElement(
        Markdown,
        {
          urlTransform: markdownUrlTransform,
          components: {
            img: ({ src }) => {
              sources.push(src ?? "");
              return null;
            },
          },
        },
        "![本地](D:/out/a.png)\n\n![反斜杠](D:\\out\\a.png)\n\n![内嵌](data:image/png;base64,AAAA)",
      ),
    );
    expect(sources).toEqual(["D:/out/a.png", "D:%5Cout%5Ca.png", "data:image/png;base64,AAAA"]);
    expect(sources.map((src) => resolveMarkdownImageSource(src)?.kind)).toEqual([
      "local",
      "local",
      "url",
    ]);
  });
});
