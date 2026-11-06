import type { PiChatMessage } from "../../shared/ipc";

/**
 * 扩展自定义消息（`pi.sendMessage()` → `role: "custom"`）的解析（docs/design/129 §8.4）。
 *
 * 这类消息**不是**聊天内容：它是扩展在替 pi 说话（「作业 J-7 结束了」）。因此只抽两件事——
 * 谁发的（customType，用于选择标签与图标）和说了什么（纯文本），渲染成紧凑通知条目，
 * 不套气泡、不参与「本轮概述」的统计。
 *
 * 只在 `display !== false` 时展示：pi 的 `display: false` 语义是「进上下文但不显示」，
 * 忽略它会把扩展刻意隐藏的消息翻出来。
 */

/** 扩展通知的展示数据（已与 pi 的消息结构解耦，组件只读这两个字段）。 */
export interface CustomNotice {
  /** 发送方扩展的消息类型（如 `bash-job`）；未知类型按通用通知渲染。 */
  customType: string;
  /** 纯文本正文（多段以换行分隔）。 */
  text: string;
}

const FALLBACK_TYPE = "extension";

/** 消息内容 → 纯文本。只认 text/content，不折叠 thinking（自定义消息没有思考块）。 */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map(textOf)
      .filter((part) => part.length > 0)
      .join("\n");
  }
  if (typeof value === "object" && value !== null) {
    const record = value as { text?: unknown; content?: unknown };
    if (typeof record.text === "string") return record.text;
    if (record.content !== undefined) return textOf(record.content);
  }
  return "";
}

/** `role: "custom"` 的消息 → 通知数据；不是自定义消息、被要求隐藏、或没有正文时返回 null。 */
export function customNoticeFromMessage(message: PiChatMessage): CustomNotice | null {
  if (message.role !== "custom") return null;
  const record = message as unknown as { customType?: unknown; display?: unknown };
  if (record.display === false) return null;
  const text = textOf(message.content).trim();
  if (text.length === 0) return null;
  const customType =
    typeof record.customType === "string" && record.customType.trim().length > 0
      ? record.customType.trim()
      : FALLBACK_TYPE;
  return { customType, text };
}

/** 折叠状态下的一行摘要：取首个非空行。 */
export function customNoticeSummary(text: string): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? text;
}
