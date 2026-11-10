/**
 * 表格 hast → GFM Markdown 源码（docs/design/135）。
 *
 * 为什么从 AST 还原而不读 DOM：会话区把行内代码换成了 chip、把软换行换成了所需组件，
 * 回读 DOM 文本会丢格式（代码/粗体/链接全变纯文本）。hast 里仍是 Markdown 语义节点，
 * 逐个还原即可得到能再次粘回对话的表格文本。
 */

/** react-markdown 传给自定义组件的 hast 节点（只声明用得到的字段）。 */
export interface TableHastNode {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: TableHastNode[];
}

/** 表格行容器：只有这三种会装 `<tr>`，其余（单元格内的嵌套表）不参与外层行收集。 */
const ROW_CONTAINERS = new Set(["thead", "tbody", "tfoot"]);
const CELL_TAGS = new Set(["th", "td"]);

function childrenOf(node: TableHastNode): TableHastNode[] {
  return node.children ?? [];
}

function tagOf(node: TableHastNode): string {
  return node.tagName ?? "";
}

function textOf(node: TableHastNode): string {
  return childrenOf(node)
    .map((child) => (child.type === "text" ? (child.value ?? "") : textOf(child)))
    .join("");
}

/**
 * 单元格内的行内文本：`|` 必须转义（GFM 表格先按竖线切列，行内代码里的竖线也一样），
 * 真实换行在单元格里没有意义，压成空格。
 */
function escapeCellText(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

/** 行内代码：围栏要比内容里最长的反引号串长一位，否则 Markdown 解析不回去。 */
function codeSpan(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${escapeCellText(text)}${pad}${fence}`;
}

function hrefOf(node: TableHastNode): string {
  const href = node.properties?.href;
  return typeof href === "string" ? href : "";
}

function srcOf(node: TableHastNode): string {
  const src = node.properties?.src;
  return typeof src === "string" ? src : "";
}

function serializeInline(node: TableHastNode): string {
  if (node.type === "text") return escapeCellText(node.value ?? "");
  const inner = (): string => childrenOf(node).map(serializeInline).join("");
  switch (tagOf(node)) {
    case "code":
      return codeSpan(textOf(node));
    case "strong":
    case "b":
      return `**${inner()}**`;
    case "em":
    case "i":
      return `*${inner()}*`;
    case "del":
    case "s":
      return `~~${inner()}~~`;
    case "br":
      return "<br>";
    case "img":
      return `![${escapeCellText(textOf(node))}](${srcOf(node)})`;
    case "a": {
      const href = hrefOf(node);
      const text = inner();
      return href ? `[${text}](${href})` : text;
    }
    default:
      return inner();
  }
}

/** 表格里所有 `<tr>`（只沿 thead/tbody/tfoot 下钻，单元格内的嵌套表不混进外层）。 */
function collectRows(table: TableHastNode): TableHastNode[] {
  const rows: TableHastNode[] = [];
  const walk = (node: TableHastNode): void => {
    for (const child of childrenOf(node)) {
      const tag = tagOf(child);
      if (tag === "tr") rows.push(child);
      else if (ROW_CONTAINERS.has(tag)) walk(child);
    }
  };
  walk(table);
  return rows;
}

function cellNodesOf(row: TableHastNode): TableHastNode[] {
  return childrenOf(row).filter((cell) => CELL_TAGS.has(tagOf(cell)));
}

/** 列对齐标记：hast 把 GFM 的 `:---:` 写在 `properties.align` 上。 */
function alignMarker(cell: TableHastNode | undefined): string {
  const align = cell?.properties?.align;
  if (align === "left") return ":---";
  if (align === "right") return "---:";
  if (align === "center") return ":---:";
  return "---";
}

/**
 * 还原成 GFM 表格源码（`| a | b |` + 分隔行 + 数据行）。拿不到行时返回空串，
 * 调用方据此提示失败而不是把空文本塞进剪贴板。
 */
export function tableToMarkdown(table: TableHastNode): string {
  const rows = collectRows(table);
  if (rows.length === 0) return "";

  const headerCells = cellNodesOf(rows[0] ?? {});
  const width = rows.reduce((max, row) => Math.max(max, cellNodesOf(row).length), 0);
  if (width === 0) return "";

  const toLine = (row: TableHastNode): string => {
    const cells = cellNodesOf(row).map((cell) => serializeInline(cell).trim());
    while (cells.length < width) cells.push("");
    return `| ${cells.join(" | ")} |`;
  };

  const delimiter = Array.from({ length: width }, (_, index) => alignMarker(headerCells[index]));
  const lines = [toLine(rows[0] ?? {}), `| ${delimiter.join(" | ")} |`];
  for (const row of rows.slice(1)) lines.push(toLine(row));
  return lines.join("\n");
}
