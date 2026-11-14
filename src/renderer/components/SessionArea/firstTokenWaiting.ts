import type { SessionEntry } from "../../stores/sessionTranscript";

/**
 * 找出仍在等待首个可见模型活动的 run。空 message_start / text_start 不代表首字到达；
 * 扩展通知也不能代替模型响应。思考、工具或正文出现后，等待提示让位给工作流。
 */
export function findFirstTokenWaitingRunId(entries: readonly SessionEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.kind === "run") {
      return entry.status === "running" && !entry.synthetic && !entry.retry ? entry.id : null;
    }
    if (entry.kind === "custom") continue;
    if (
      entry.kind === "assistant" &&
      entry.blocks.every((block) => block.kind === "text" && !block.text.trim())
    ) {
      continue;
    }
    return null;
  }
  return null;
}
