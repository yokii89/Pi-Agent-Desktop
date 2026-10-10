import { t } from "../../shared/i18n";
import type { SessionTranscriptPayload } from "../../shared/ipc";

/**
 * 「导出记录」的纯逻辑：会话消息 → Markdown 文档 + 落盘文件名净化。
 * 与 fs/saveImageName.ts 同款拆分——本模块不依赖 Electron，可在不启动 app 的前提下被测；
 * 保存对话框与写盘在 exportSession.ts。
 */

/** 文件名主干长度上限（Windows 单段 255 字符，留出扩展名与「 (2)」去重序号余量）。 */
const MAX_STEM_CHARS = 80;
/** 工具失败原文的导出截断长度（完整堆栈对"记录"没有价值，只留判断依据）。 */
const MAX_TOOL_ERROR_CHARS = 400;
/** Windows 目录段非法字符 + 控制符/零宽等「其它」类码位（\p{C}）。 */
const ILLEGAL_NAME_CHARS = /[\p{C}<>:"/\\|?*]/gu;
/** Windows 保留设备名：即便带扩展名也不能当文件名（CON.md 写入即失败）。 */
const WIN_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export interface ExportDocMeta {
  /** 文档标题（会话标题，空白时调用方已回退默认名）。 */
  title: string;
  /** 会话 JSONL 绝对路径（写入文档头部元信息）。 */
  file: string;
  /** 导出时刻（Unix ms）；缺省取当前时间。 */
  exportedAt?: number;
}

/** 标题默认文件名：净化不可信标题，保证结果是单个 .md 文件名而非路径。 */
export function toExportFileName(raw: string | undefined): string {
  const stem = (raw ?? "")
    .split(/[\\/]/)
    .pop()
    ?.replace(ILLEGAL_NAME_CHARS, "")
    .replace(/\.(markdown|md)$/i, "")
    .replace(/[. ]+$/, "")
    .slice(0, MAX_STEM_CHARS)
    .replace(/[. ]+$/, "")
    .trim();
  const base = stem || t("session.export.defaultName");
  return `${WIN_RESERVED_NAMES.test(base) ? `_${base}` : base}.md`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** 从消息 content 提取纯文本（text 块 / 字符串 / 嵌套 content 的通用提取）。 */
function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const part = textOf(item);
      if (part !== null && part.length > 0) parts.push(part);
    }
    return parts.length > 0 ? parts.join("\n") : null;
  }
  const record = asRecord(value);
  if (!record) return null;
  if (typeof record.text === "string") return record.text;
  if (typeof record.thinking === "string") return record.thinking;
  if (record.content !== undefined) return textOf(record.content);
  return null;
}

/** 折叠块：思考与工具调用折叠展示，避免长会话正文被推理过程淹没。 */
function detailsBlock(summary: string, body: string): string {
  return [`<details>`, `<summary>${summary}</summary>`, "", body, "", `</details>`].join("\n");
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** 用户消息：正文字符串 + 图片附件计数（图片本身是 base64，不写入文档）。 */
function renderUserMessage(content: unknown[]): string | null {
  const texts: string[] = [];
  let images = 0;
  for (const block of content) {
    const record = asRecord(block);
    if (record && record.type === "image") {
      images += 1;
      continue;
    }
    const text = textOf(block);
    if (text !== null && text.length > 0) texts.push(text);
  }
  const parts: string[] = [];
  if (texts.length > 0) parts.push(texts.join("\n"));
  if (images > 0) parts.push(`_${t("session.export.image")} ×${images}_`);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** 助手消息：正文原样；思考与工具调用折叠；工具参数可能是对象，统一成 JSON 文本。 */
function renderAssistantMessage(content: unknown[]): string | null {
  const parts: string[] = [];
  for (const block of content) {
    const record = asRecord(block);
    if (!record) continue;
    if (record.type === "text" && typeof record.text === "string" && record.text.trim()) {
      parts.push(record.text);
      continue;
    }
    if (record.type === "thinking") {
      const thinking =
        typeof record.thinking === "string"
          ? record.thinking
          : typeof record.text === "string"
            ? record.text
            : "";
      if (thinking.trim()) {
        parts.push(detailsBlock(t("session.export.thinking"), thinking));
      }
      continue;
    }
    if (record.type === "toolCall") {
      const name = typeof record.name === "string" ? record.name : "";
      const args = record.arguments;
      const argsText =
        args === undefined || args === null
          ? ""
          : typeof args === "string"
            ? args
            : JSON.stringify(args, null, 2);
      const body = argsText ? ["```json", argsText, "```"].join("\n") : "";
      parts.push(detailsBlock(`${t("session.export.toolCall")}：${name}`, body));
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** 工具失败：只留失败结果（正常工具输出不进文档，会淹没对话主线）。 */
function renderToolError(message: {
  content: unknown[];
  toolName?: string;
  isError?: boolean;
}): string | null {
  if (message.isError !== true) return null;
  const text = textOf(message.content);
  if (!text) return null;
  const clipped =
    text.length > MAX_TOOL_ERROR_CHARS ? `${text.slice(0, MAX_TOOL_ERROR_CHARS)}…` : text;
  const name = message.toolName ? ` \`${message.toolName}\`` : "";
  // 引用块逐行加 "> "，多行报错在 Markdown 里保持成块
  return `> **${t("session.export.toolError")}**${name}：${clipped.replace(/\n/g, "\n> ")}`;
}

/** 会话消息 → Markdown 文档（导出记录的正文格式；标题行 + 元信息 + 逐条消息）。 */
export function buildSessionMarkdown(
  payload: SessionTranscriptPayload,
  meta: ExportDocMeta,
): string {
  const sections: string[] = [];
  const head = [
    `# ${meta.title.replace(/\s+/g, " ").trim()}`,
    "",
    `- ${t("session.export.metaFile")}：\`${meta.file}\``,
  ];
  if (payload.startedAt !== null) {
    head.push(`- ${t("session.export.metaStarted")}：${formatTime(payload.startedAt)}`);
  }
  head.push(`- ${t("session.export.metaExported")}：${formatTime(meta.exportedAt ?? Date.now())}`);
  sections.push(head.join("\n"));
  sections.push("---");
  if (payload.truncated) {
    sections.push(`> ${t("session.export.truncated")}`);
  }
  for (const message of payload.messages) {
    let body: string | null = null;
    let role: string | null = null;
    if (message.role === "user") {
      body = renderUserMessage(message.content);
      role = t("session.export.roleUser");
    } else if (message.role === "assistant") {
      body = renderAssistantMessage(message.content);
      role = t("session.export.roleAssistant");
    } else if (message.role === "toolResult") {
      body = renderToolError(message);
    }
    if (body === null) continue;
    sections.push(role ? `**${role}**\n\n${body}` : body);
  }

  return `${sections.join("\n\n")}\n`;
}
