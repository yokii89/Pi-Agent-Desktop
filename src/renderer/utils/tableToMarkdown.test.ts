import { describe, expect, it } from "vitest";
import { type TableHastNode, tableToMarkdown } from "./tableToMarkdown";

function text(value: string): TableHastNode {
  return { type: "text", value };
}

function cell(tagName: "th" | "td", children: TableHastNode[], align?: string): TableHastNode {
  return { type: "element", tagName, properties: align ? { align } : {}, children };
}

function row(cells: TableHastNode[]): TableHastNode {
  return { type: "element", tagName: "tr", properties: {}, children: cells };
}

function table(head: TableHastNode[], body: TableHastNode[] = []): TableHastNode {
  const children: TableHastNode[] = [{ type: "element", tagName: "thead", children: head }];
  if (body.length > 0) children.push({ type: "element", tagName: "tbody", children: body });
  return { type: "element", tagName: "table", properties: {}, children };
}

describe("tableToMarkdown", () => {
  it("还原表头、分隔行与数据行", () => {
    const node = table(
      [row([cell("th", [text("缺陷")]), cell("th", [text("位置")])])],
      [
        row([cell("td", [text("A 短命令误判")]), cell("td", [text("classify.ts:67")])]),
        row([cell("td", [text("B")]), cell("td", [text("notify.ts:66")])]),
      ],
    );
    expect(tableToMarkdown(node)).toBe(
      [
        "| 缺陷 | 位置 |",
        "| --- | --- |",
        "| A 短命令误判 | classify.ts:67 |",
        "| B | notify.ts:66 |",
      ].join("\n"),
    );
  });

  it("接住 GFM 的列对齐", () => {
    const node = table([
      row([
        cell("th", [text("a")], "left"),
        cell("th", [text("b")], "center"),
        cell("th", [text("c")], "right"),
      ]),
    ]);
    expect(tableToMarkdown(node)).toBe("| a | b | c |\n| :--- | :---: | ---: |");
  });

  it("行内代码保留围栏、竖线转义、换行压平", () => {
    const node = table(
      [row([cell("th", [text("说明")])])],
      [
        row([
          cell("td", [
            text("含 "),
            { type: "element", tagName: "code", children: [text("a|b")] },
            text(" 以及\n换行"),
          ]),
        ]),
      ],
    );
    expect(tableToMarkdown(node)).toBe("| 说明 |\n| --- |\n| 含 `a\\|b` 以及 换行 |");
  });

  it("行内代码围栏比内容里最长的反引号长一位", () => {
    const node = table([
      row([cell("th", [{ type: "element", tagName: "code", children: [text("a``b")] }])]),
    ]);
    expect(tableToMarkdown(node)).toContain("```a``b```");
  });

  it("行内强调、删除线、链接与硬换行都还原成 Markdown", () => {
    const node = table([
      row([
        cell("th", [
          { type: "element", tagName: "strong", children: [text("粗")] },
          text(" "),
          { type: "element", tagName: "em", children: [text("斜")] },
          text(" "),
          { type: "element", tagName: "del", children: [text("删")] },
        ]),
        cell("th", [
          {
            type: "element",
            tagName: "a",
            properties: { href: "https://pi.dev" },
            children: [text("官网")],
          },
          { type: "element", tagName: "br" },
          text("副行"),
        ]),
      ]),
    ]);
    expect(tableToMarkdown(node)).toBe(
      "| **粗** *斜* ~~删~~ | [官网](https://pi.dev)<br>副行 |\n| --- | --- |",
    );
  });

  it("短行补空列，长行按表头列数截断语义保持不变", () => {
    const node = table(
      [row([cell("th", [text("a")]), cell("th", [text("b")])])],
      [row([cell("td", [text("只有一列")])])],
    );
    expect(tableToMarkdown(node)).toBe("| a | b |\n| --- | --- |\n| 只有一列 |  |");
  });

  it("拿不到行时返回空串（调用方据此提示失败）", () => {
    expect(tableToMarkdown({ type: "element", tagName: "table", children: [] })).toBe("");
  });
});
