import type { QueueIntent } from "../../shared/ipc";
import { formatFileMentionPrompt, type PositionedFileMention } from "./fileMentionFormat";
import { parseSteerCommand } from "./steerCommand";

/** 发送与撤回重发共用的正文序列化；剥离本地命令时同步修正内联文件位置。 */
export function buildComposerPrompt(
  rawText: string,
  mentions: PositionedFileMention[],
  attachmentPaths: readonly string[] = [],
): { text: string; body: string; intent: QueueIntent } {
  const parsed = parseSteerCommand(rawText);
  const removedPrefix = rawText.length - parsed.text.length;
  return {
    text: formatFileMentionPrompt(
      parsed.text,
      mentions.map((mention) => ({ ...mention, offset: mention.offset - removedPrefix })),
      attachmentPaths,
    ),
    body: parsed.text,
    // 空闲时 pi 忽略意图；保留 followUp 默认值以兜住本地运行态滞后的竞态。
    intent: parsed.steer ? "steer" : "followUp",
  };
}
