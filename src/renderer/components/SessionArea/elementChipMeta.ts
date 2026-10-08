import type { BrowserContextItem } from "../../services/browserService";

/** 标签语义色档位：按角色归类，不为每个 HTML 标签单开一色。 */
export type ElementTagTone = "interactive" | "text" | "structure" | "media" | "other";

const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "details",
  "option",
  "optgroup",
  "legend",
  "datalist",
]);

const TEXT_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "span",
  "em",
  "strong",
  "b",
  "i",
  "small",
  "blockquote",
  "pre",
  "code",
  "q",
  "cite",
  "abbr",
  "time",
  "mark",
  "del",
  "ins",
  "sub",
  "sup",
  "kbd",
  "samp",
  "var",
]);

const MEDIA_TAGS = new Set([
  "img",
  "svg",
  "video",
  "audio",
  "canvas",
  "picture",
  "iframe",
  "embed",
  "object",
  "track",
  "source",
  "map",
  "area",
]);

const STRUCTURE_TAGS = new Set([
  "html",
  "body",
  "div",
  "section",
  "main",
  "header",
  "footer",
  "nav",
  "aside",
  "article",
  "form",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "colgroup",
  "col",
  "figure",
  "figcaption",
  "hr",
  "br",
  "template",
  "slot",
  "dialog",
  "menu",
]);

/** CSS Modules 哈希类（如 `Box_1a2b3`、`index_x7k2n`）——跳过，避免短标签无意义。 */
const HASHISH_CLASS = /^[A-Za-z]+_[A-Za-z0-9]{4,}$/;

/** tag → 语义色档；未知 / 自定义元素归 other。 */
export function tagTone(tag: string): ElementTagTone {
  const normalized = tag.toLowerCase();
  if (INTERACTIVE_TAGS.has(normalized)) return "interactive";
  if (TEXT_TAGS.has(normalized)) return "text";
  if (MEDIA_TAGS.has(normalized)) return "media";
  if (STRUCTURE_TAGS.has(normalized)) return "structure";
  return "other";
}

/**
 * 从 selector 提取展示用 class：优先第一个「人类可读」类名，
 * 全是哈希时退回第一个，没有 class 则返回 null。
 */
export function shortClass(selector: string): string | null {
  const matches = selector.match(/\.([\w-]+)/g);
  if (!matches?.length) return null;
  let first: string | null = null;
  for (const raw of matches) {
    const name = raw.slice(1);
    if (!name) continue;
    if (!first) first = name;
    if (!HASHISH_CLASS.test(name)) return name;
  }
  return first;
}

/** 芯片上的 class 区文案：`.Box-body` / 截图标签 / 空 class 时的占位 `el`。 */
export function elementClassText(
  item: Pick<BrowserContextItem, "kind" | "label" | "selector">,
  screenshotLabel: string,
): string {
  if (item.kind === "screenshot") return item.label || screenshotLabel;
  const name = shortClass(item.selector);
  return name ? `.${name}` : "";
}

/** 空 class 占位（斜体弱化，避免芯片左右跳动）。 */
export const EMPTY_CLASS_PLACEHOLDER = "el";

/** 徽章文案：tag 名，截图形态固定 img。 */
export function elementBadgeText(item: Pick<BrowserContextItem, "kind" | "tag">): string {
  if (item.kind === "screenshot") return "img";
  return item.tag || "el";
}

/** tooltip / aria 用的完整描述。 */
export function elementChipTitle(
  item: Pick<BrowserContextItem, "label" | "selector" | "textSummary">,
): string {
  return `${item.selector || item.label}${item.textSummary ? ` · ${item.textSummary}` : ""}`;
}

/** 芯片整体语义色（截图视为媒体）。 */
export function elementTone(item: Pick<BrowserContextItem, "kind" | "tag">): ElementTagTone {
  if (item.kind === "screenshot") return "media";
  return tagTone(item.tag);
}
