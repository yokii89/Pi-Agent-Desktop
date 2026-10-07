import { describe, expect, it } from "vitest";
import { formatQuoteBlock, toQuoteLines } from "./quoteFormat";

describe("toQuoteLines", () => {
  it("单行加 > 前缀", () => {
    expect(toQuoteLines("hello")).toEqual(["> hello"]);
  });

  it("多行逐行加前缀", () => {
    expect(toQuoteLines("第一行\n第二行")).toEqual(["> 第一行", "> 第二行"]);
  });

  it("CRLF 换行同样处理", () => {
    expect(toQuoteLines("a\r\nb")).toEqual(["> a", "> b"]);
  });

  it("选区首尾空白与换行不进引用块", () => {
    expect(toQuoteLines("\n\n  a\nb  \n")).toEqual(["> a", "> b"]);
  });

  it("内部空行与纯空白行都输出 >", () => {
    expect(toQuoteLines("a\n\nb")).toEqual(["> a", ">", "> b"]);
    expect(toQuoteLines("a\n  \nb")).toEqual(["> a", ">", "> b"]);
  });

  it("纯空白选区为空", () => {
    expect(toQuoteLines("  \n\n ")).toEqual([]);
  });
});

describe("formatQuoteBlock", () => {
  it("空草稿：引用块 + 末尾空行", () => {
    expect(formatQuoteBlock("", "a\nb")).toEqual("> a\n> b\n");
  });

  it("纯空白草稿视同空草稿", () => {
    expect(formatQuoteBlock(" \n ", "a")).toEqual("> a\n");
  });

  it("非空草稿先补一个空行再追加", () => {
    expect(formatQuoteBlock("帮我改这个", "a")).toEqual("\n\n> a\n");
  });

  it("草稿已带尾部换行时不产生连续空行", () => {
    expect(formatQuoteBlock("帮我改这个\n", "a")).toEqual("\n> a\n");
  });

  it("空选区不追加任何内容", () => {
    expect(formatQuoteBlock("草稿", "  \n ")).toEqual("");
  });
});
