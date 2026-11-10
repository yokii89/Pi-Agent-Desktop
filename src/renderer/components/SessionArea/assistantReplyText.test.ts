import { describe, expect, it } from "vitest";
import type { AssistantBlock } from "../../stores/sessionTranscript";
import {
  assistantReplyMarkdown,
  hasAssistantReplyText,
  markdownToPlainText,
} from "./assistantReplyText";

const toolBlock = {
  kind: "tool",
  toolCallId: "t1",
  name: "read",
  toolKind: "read",
} as unknown as AssistantBlock;

describe("assistantReplyMarkdown", () => {
  it("只取 text 块，思考与工具调用不参与", () => {
    const blocks: AssistantBlock[] = [
      { kind: "thinking", text: "内部推理先忽略？", contentIndex: 0 },
      { kind: "text", text: "第一段正文。", contentIndex: 1 },
      toolBlock,
      { kind: "text", text: "第二段正文。", contentIndex: 3 },
    ];
    expect(assistantReplyMarkdown(blocks)).toBe("第一段正文。\n\n第二段正文。");
  });

  it("丢弃空白 text 块", () => {
    const blocks: AssistantBlock[] = [
      { kind: "text", text: "  \n ", contentIndex: 0 },
      { kind: "text", text: "正文", contentIndex: 1 },
    ];
    expect(assistantReplyMarkdown(blocks)).toBe("正文");
  });

  it("hasAssistantReplyText 只看可见 text", () => {
    expect(hasAssistantReplyText([toolBlock])).toBe(false);
    expect(hasAssistantReplyText([{ kind: "thinking", text: "x", contentIndex: 0 }])).toBe(false);
    expect(hasAssistantReplyText([{ kind: "text", text: "x", contentIndex: 0 }])).toBe(true);
  });
});

describe("markdownToPlainText", () => {
  it("剥标题、强调、链接与图片，保留可见文字", () => {
    const md = [
      "## 标题",
      "",
      "这是**加粗**与*斜体*，还有 `inline` 代码。",
      "",
      "看 [链接文字](https://example.com/a) 与 ![图注](img.png)。",
    ].join("\n");
    expect(markdownToPlainText(md)).toBe(
      ["标题", "", "这是加粗与斜体，还有 inline 代码。", "", "看 链接文字 与 图注。"].join("\n"),
    );
  });

  it("围栏代码原样保留（含语言标注行不出现、代码里的 Markdown 不剥）", () => {
    const md = ["说明：", "", "```ts", "const a = `**x**`;", "# 注释", "```"].join("\n");
    expect(markdownToPlainText(md)).toBe(["说明：", "", "const a = `**x**`;", "# 注释"].join("\n"));
  });

  it("引用去 >，表格分隔行丢弃、单元格用 | 连接", () => {
    const md = ["> 引用一行", "", "| 名称 | 值 |", "| --- | --- |", "| a | b |"].join("\n");
    expect(markdownToPlainText(md)).toBe(["引用一行", "", "名称 | 值", "a | b"].join("\n"));
  });

  it("列表标记与转义字符按纯文本保留", () => {
    const md = ["- 第一项", "- 字面星号 \\*不是强调\\*"].join("\n");
    expect(markdownToPlainText(md)).toBe("- 第一项\n- 字面星号 *不是强调*");
  });

  it("行内代码里的实体与格式不处理", () => {
    expect(markdownToPlainText("`&amp; **x**`")).toBe("&amp; **x**");
    expect(markdownToPlainText("A &amp; B")).toBe("A & B");
  });
});
