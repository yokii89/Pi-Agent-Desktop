import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { splitStableBlocks } from "./markdownBlocks";

/** 前缀不变量：blocks 与 tail 拼回必须等于原文，且流式增长时已定块逐字节稳定。 */
function assertRoundTrip(md: string): void {
  const { blocks, tail } = splitStableBlocks(md);
  expect([...blocks, tail].join("\n")).toBe(md);
}

/** 计入轮廓的块级标签（结构轮廓的观测对象）。 */
const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "table",
  "hr",
]);

/** 容器标签：深度 = 祖先中的出现次数（docs/design/29 §1 解析探针）。 */
const CONTAINER_TAGS = new Set(["ul", "ol", "blockquote"]);

/** 自闭合、不进栈的标签。 */
const VOID_TAGS = new Set(["br", "hr", "img"]);

const HTML_TAG_RE = /<\/?([a-zA-Z][\w-]*)((?:\s[^>]*)?)\/?>/g;

/**
 * 结构轮廓：按文档顺序产出 `tag@深度`（深度 = 祖先 ul/ol/blockquote 数），
 * `ol` 附 `start=N`。渲染层无 DOM，直接对 renderToStaticMarkup 的 HTML 做扫描。
 */
function outline(md: string): string[] {
  const html = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm] }, md));
  const result: string[] = [];
  const stack: string[] = [];
  for (const match of html.matchAll(HTML_TAG_RE)) {
    const name = match[1].toLowerCase();
    if (match[0].startsWith("</")) {
      stack.pop();
      continue;
    }
    if (VOID_TAGS.has(name)) {
      // void 标签无闭合、不进栈，但 hr 属于块级观测对象
      if (BLOCK_TAGS.has(name)) {
        result.push(`${name}@${stack.filter((tag) => CONTAINER_TAGS.has(tag)).length}`);
      }
      continue;
    }
    if (BLOCK_TAGS.has(name)) {
      let entry = `${name}@${stack.filter((tag) => CONTAINER_TAGS.has(tag)).length}`;
      if (name === "ol") {
        const start = /start="(\d+)"/.exec(match[2] ?? "");
        if (start) entry += `[${start[1]}]`;
      }
      result.push(entry);
    }
    stack.push(name);
  }
  return result;
}

/**
 * 切分等价性：整段一次渲染的轮廓，必须等于「切分后逐块渲染」的轮廓拼接。
 * 返回失配数（逐位比较，长度差计入）——0 = 切分不改变渲染结果。
 */
function outlineMismatch(md: string): number {
  const whole = outline(md);
  const { blocks, tail } = splitStableBlocks(md);
  const split = blocks.flatMap((block) => outline(block)).concat(outline(tail));
  let mismatch = Math.abs(whole.length - split.length);
  const shared = Math.min(whole.length, split.length);
  for (let i = 0; i < shared; i += 1) {
    if (whole[i] !== split[i]) mismatch += 1;
  }
  return mismatch;
}

describe("splitStableBlocks", () => {
  it("splits plain paragraphs at blank lines", () => {
    const md = "第一段\n\n第二段\n\n第三段还在写";
    const { blocks, tail } = splitStableBlocks(md);
    // 块保留尾随空行：字节级保真，单独解析与在原文中解析完全一致
    expect(blocks).toEqual(["第一段\n", "第二段\n"]);
    expect(tail).toBe("第三段还在写");
    assertRoundTrip(md);
  });

  it("keeps blank lines inside a fenced code block intact", () => {
    const md = "前文\n\n```py\na = 1\n\nb = 2\n```\n\n后文";
    const { blocks, tail } = splitStableBlocks(md);
    expect(blocks).toEqual(["前文\n", "```py\na = 1\n\nb = 2\n```\n"]);
    expect(tail).toBe("后文");
    assertRoundTrip(md);
  });

  it("keeps an unclosed fence entirely in tail", () => {
    const md = "前文\n\n```ts\nconst a = 1;";
    const { blocks, tail } = splitStableBlocks(md);
    expect(blocks).toEqual(["前文\n"]);
    expect(tail).toBe("```ts\nconst a = 1;");
  });

  it("a longer closing fence closes a shorter open fence", () => {
    const md = "````txt\n内含 ``` 围栏\n````\n\n后文";
    const { blocks, tail } = splitStableBlocks(md);
    expect(blocks).toEqual(["````txt\n内含 ``` 围栏\n````\n"]);
    expect(tail).toBe("后文");
  });

  it("does not split loose lists (numbering / spacing would change)", () => {
    const ordered = "1. a\n\n2. b\n\n正文";
    const orderedSplit = splitStableBlocks(ordered);
    // 列表内部边界作废，但列表后的边界合法 → 整个列表成为一块
    expect(orderedSplit.blocks).toEqual(["1. a\n\n2. b\n"]);
    expect(orderedSplit.tail).toBe("正文");

    const unordered = "- a\n\n- b\n\n正文";
    const unorderedSplit = splitStableBlocks(unordered);
    expect(unorderedSplit.blocks).toEqual(["- a\n\n- b\n"]);
    expect(unorderedSplit.tail).toBe("正文");
  });

  it("splits after a list once a non-list block follows", () => {
    const md = "- a\n- b\n\n正文";
    const { blocks, tail } = splitStableBlocks(md);
    expect(blocks).toEqual(["- a\n- b\n"]);
    expect(tail).toBe("正文");
  });

  it("keeps a growing table whole (no blank lines inside tables)", () => {
    const md = "说明\n\n| a | b |\n| - | - |\n| 1 | 2 |";
    const { blocks, tail } = splitStableBlocks(md);
    expect(blocks).toEqual(["说明\n"]);
    expect(tail).toContain("| 1 | 2 |");
    assertRoundTrip(md);
  });

  it("prefix blocks are byte-stable as the stream grows", () => {
    const early = "段落A\n\n段落B";
    const later = "段落A\n\n段落B\n\n段落C";
    const earlySplit = splitStableBlocks(early);
    const laterSplit = splitStableBlocks(later);
    // 早期已定块在增长后逐字节不变 → memo 不失效
    expect(laterSplit.blocks.slice(0, earlySplit.blocks.length)).toEqual(earlySplit.blocks);
    expect(laterSplit.blocks).toEqual(["段落A\n", "段落B\n"]);
    expect(laterSplit.tail).toBe("段落C");
  });

  it("returns empty blocks for empty or blank text", () => {
    expect(splitStableBlocks("")).toEqual({ blocks: [], tail: "" });
    expect(splitStableBlocks("\n\n")).toEqual({ blocks: [], tail: "\n\n" });
  });

  it("text ending with blank lines goes into blocks with empty tail", () => {
    const md = "段落A\n\n段落B\n\n";
    const { blocks, tail } = splitStableBlocks(md);
    expect(blocks).toEqual(["段落A\n"]);
    expect(tail).toBe("段落B\n\n");
    assertRoundTrip(md);
  });

  // ---- docs/design/29 缺陷 C：切分后轮廓必须与整段渲染一致 ----

  it("does not split an indented continuation out of its list item", () => {
    const md = "- **安装依赖**\n\n  先确认 pnpm 版本。\n\n- **启动服务**\n\n  再执行 pnpm dev。";
    const { blocks, tail } = splitStableBlocks(md);
    // 整个松散列表连成一块：续写行从第 0 列之外起笔 → 边界作废
    expect(blocks).toEqual([]);
    expect(tail).toBe(md);
    expect(outlineMismatch(md)).toBe(0);
  });

  it("keeps a nested list inside its parent item (indent continuation)", () => {
    const md = "1. 步\n\n   1. 子甲\n\n   2. 子乙\n\n2. 第二步";
    const { blocks, tail } = splitStableBlocks(md);
    expect(blocks).toEqual([]);
    expect(tail).toBe(md);
    expect(outlineMismatch(md)).toBe(0);
  });

  it("keeps ordered list items together (no loose→tight downgrade, no extra ol start)", () => {
    const md = "1. 第一项\n\n2. 第二项\n\n正文";
    expect(outlineMismatch(md)).toBe(0);
    const whole = outline(md);
    // 整段只有一个 ol；切分不得多出 ol[start=2] 之类的第二段列表
    expect(whole.filter((item) => item.startsWith("ol@"))).toHaveLength(1);
  });

  it("outline equivalence for tight lists, fence+table, and nested lists (control groups)", () => {
    expect(outlineMismatch("- a\n- b\n\n正文")).toBe(0);
    expect(
      outlineMismatch(
        "说明\n\n```py\na = 1\n\nb = 2\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n结尾",
      ),
    ).toBe(0);
    expect(outlineMismatch("- 外\n  - 内\n    - 内内\n\n正文")).toBe(0);
  });

  it("prefix stays byte-stable while an indented continuation is still streaming in", () => {
    // 空行后下一行首字符是空格：该边界永不生效 → 已定前缀在增长中稳定
    const prefix = "前文\n\n```py\nx = 1\n```\n\n";
    const early = `${prefix}段落\n\n- **安装依赖**\n\n`;
    const later = `${prefix}段落\n\n- **安装依赖**\n\n  先确认 pnpm`;
    const evenLater = `${prefix}段落\n\n- **安装依赖**\n\n  先确认 pnpm 版本。\n\n- **启动**`;
    const earlySplit = splitStableBlocks(early);
    const laterSplit = splitStableBlocks(later);
    const evenLaterSplit = splitStableBlocks(evenLater);
    // "段落" 后是列表项 → 边界作废，段落与列表一起留在尾块
    expect(earlySplit.blocks).toEqual(["前文\n", "```py\nx = 1\n```\n"]);
    expect(laterSplit.blocks.slice(0, earlySplit.blocks.length)).toEqual(earlySplit.blocks);
    expect(evenLaterSplit.blocks.slice(0, laterSplit.blocks.length)).toEqual(laterSplit.blocks);
    assertRoundTrip(evenLater);
  });
});
