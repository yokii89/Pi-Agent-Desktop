import type { BrowserConsoleError, BrowserContextItem } from "../services/browserService";

/**
 * 页面上下文 payload 组装：文本优先，让 AI 用结构化描述唯一定位元素。
 * 截图是显式兜底（kind === "screenshot" 或用户主动附加的元素截图），默认不发。
 */

/** outerHTML 在 payload 中的上限。 */
const PAYLOAD_HTML_LIMIT = 1200;
/** 随上下文发送的最近控制台错误条数。 */
const PAYLOAD_ERROR_LIMIT = 5;

function formatConsoleError(error: BrowserConsoleError): string {
  const location = error.source
    ? ` (${error.source.split("/").at(-1) ?? error.source}${error.line !== null ? `:${error.line}` : ""})`
    : "";
  return `- ${error.message.replace(/\s+/g, " ").slice(0, 300)}${location}`;
}

function itemSection(item: BrowserContextItem, index: number): string[] {
  const lines: string[] = [];
  if (item.kind === "screenshot") {
    lines.push(`## 截图 ${index}`);
    lines.push(`- 页面 URL: ${item.url}`);
    if (item.screenshot) lines.push(`- 截图文件: ${item.screenshot.path}`);
    return lines;
  }
  // 文本优先：用可读身份 + selector + 可见文本唯一定位，而不是靠图像
  lines.push(`## 元素 ${index}: ${item.label}`);
  lines.push(`- tag: ${item.tag}`);
  if (item.selector) lines.push(`- selector: ${item.selector}`);
  if (item.a11y) lines.push(`- 无障碍: ${item.a11y}`);
  if (item.textSummary) lines.push(`- 文本摘要: ${item.textSummary}`);
  if (item.rect) {
    lines.push(
      `- 位置/尺寸: x ${Math.round(item.rect.x)}, y ${Math.round(item.rect.y)}, ${Math.round(item.rect.width)}×${Math.round(item.rect.height)}`,
    );
  }
  lines.push(`- 视口: ${item.viewport.width}×${item.viewport.height}`);
  if (item.styles) lines.push(`- 关键样式: ${item.styles}`);
  if (item.outerHTML) {
    lines.push(`- outerHTML: ${item.outerHTML.slice(0, PAYLOAD_HTML_LIMIT)}`);
  }
  // 仅在用户显式附加了元素截图时才带上路径（默认加入对话时已剥离）
  if (item.screenshot) lines.push(`- 元素截图: ${item.screenshot.path}`);
  return lines;
}

export function buildPageContext(input: {
  text: string;
  items: BrowserContextItem[];
  consoleErrors: BrowserConsoleError[];
}): string {
  const { items, consoleErrors } = input;
  const first = items[0];
  const lines: string[] = [];
  lines.push("[页面上下文 · 来自 PiDesk 浏览器面板]");
  if (first) {
    lines.push(`页面 URL: ${first.url}`);
    lines.push(
      `视口: ${first.viewport.width}×${first.viewport.height} | 采集时间: ${new Date(
        Math.max(...items.map((item) => item.at)),
      ).toLocaleString()}`,
    );
  }
  for (const [offset, item] of items.entries()) {
    lines.push("", ...itemSection(item, offset + 1));
  }
  const errors = consoleErrors.slice(-PAYLOAD_ERROR_LIMIT);
  if (errors.length > 0) {
    lines.push("", "## 控制台最近错误");
    for (const error of errors) lines.push(formatConsoleError(error));
  }
  const text = input.text.trim();
  if (text) {
    lines.push("", "## 用户说明", text);
  }
  return lines.join("\n");
}
