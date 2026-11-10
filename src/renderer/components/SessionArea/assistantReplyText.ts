import type { AssistantBlock } from "../../stores/sessionTranscript";

/**
 * 助手回复的可复制正文（Markdown 源文）。
 * 只取 text 块：思考（thinking）与工具调用/结果属于过程信息，不参与复制。
 */
export function assistantReplyMarkdown(blocks: AssistantBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.kind !== "text") continue;
    const text = block.text.trim();
    if (text.length > 0) parts.push(text);
  }
  return parts.join("\n\n");
}

/** 是否有可复制的正文（决定页脚是否出现；纯工具/思考轮次没有页脚）。 */
export function hasAssistantReplyText(blocks: AssistantBlock[]): boolean {
  return blocks.some((block) => block.kind === "text" && block.text.trim().length > 0);
}

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const HEADING_RE = /^\s{0,3}#{1,6}\s+/;
const BLOCKQUOTE_RE = /^\s{0,3}>\s?/;
const HR_RE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const TABLE_DIVIDER_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const INLINE_CODE_RE = /(`+)([^`]*?)\1/g;
const ESCAPE_RE = /\\([\\`*_{}[\]()#+\-.!>~|])/g;
// 私有区字符做占位符：正文几乎不可能自带，避免与真实的 Markdown 文本撞车
const PLACEHOLDER_OPEN = "\uE000";
const PLACEHOLDER_CLOSE = "\uE001";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

function decodeCodePoint(raw: string, radix: number, fallback: string): string {
  const code = Number.parseInt(raw, radix);
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex: string) => decodeCodePoint(hex, 16, whole))
    .replace(/&#(\d+);/g, (whole, dec: string) => decodeCodePoint(dec, 10, whole))
    .replace(
      /&([a-z#0-9]+);/gi,
      (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole,
    );
}

/** 行内语法剥离；行内代码与反斜杠转义先换占位符，避免被后续规则误伤。 */
function convertInline(text: string): string {
  const stash: string[] = [];
  const protect = (value: string): string => {
    stash.push(value);
    return `${PLACEHOLDER_OPEN}${stash.length - 1}${PLACEHOLDER_CLOSE}`;
  };
  let out = text.replace(INLINE_CODE_RE, (_whole, _ticks, code: string) => protect(code));
  out = out.replace(ESCAPE_RE, (_whole, char: string) => protect(char));
  out = out
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
    .replace(/<([^\s<>@]+@[^\s<>]+)>/g, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])/g, "$1")
    .replace(/(?<![\w_])_(?![\s_])(.+?)(?<![\s_])_(?![\w_])/g, "$1");
  out = decodeEntities(out);
  return out.replace(/\uE000(\d+)\uE001/g, (_whole, index: string) => stash[Number(index)] ?? "");
}

/**
 * Markdown → 纯文本（回复页脚的「复制为纯文本」）。
 * 覆盖会话里实际会出现的 GFM 子集：标题/强调/链接/图片/行内代码/围栏代码/引用/
 * 列表/表格/分隔线/实体；围栏内容与行内代码按源码保留，不剥格式。
 * 不做完整 CommonMark 解析（那需要新增解析器依赖），未覆盖的语法按原样保留。
 */
export function markdownToPlainText(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let fence: { char: string; length: number } | null = null;

  for (const raw of lines) {
    const fenceMatch = FENCE_RE.exec(raw);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = { char: marker[0], length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length) fence = null;
      // 围栏行（含语言标注）只是格式标记，不进纯文本
      continue;
    }
    if (fence) {
      out.push(raw);
      continue;
    }

    let line = raw;
    while (BLOCKQUOTE_RE.test(line)) line = line.replace(BLOCKQUOTE_RE, "");
    if (HR_RE.test(line)) {
      out.push("");
      continue;
    }
    if (TABLE_DIVIDER_RE.test(line)) continue;
    line = line.replace(HEADING_RE, "");

    if (TABLE_ROW_RE.test(line)) {
      const cells = line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => convertInline(cell.trim()))
        .filter((cell) => cell.length > 0);
      out.push(cells.join(" | "));
      continue;
    }
    out.push(convertInline(line));
  }

  return out
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
