import { createHash } from "node:crypto";
import { record } from "../../shared/durableProtocol";
import type { PiChatMessage } from "../../shared/ipc";
import type { HistoryView } from "./historySync";
import { projectRemoteMessages } from "./readAdapter";

const digest = (...values: unknown[]) =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");

/** Stable saved-message identities and prefix cursors for the existing companion protocol. */
export function durableRemoteHistory(key: string, raw: readonly PiChatMessage[]): HistoryView {
  const messages = projectRemoteMessages(raw).map((message, position) => ({
    ...message,
    id: digest(key, message.id, message.text),
    position,
    state: "done" as const,
  }));
  const prefixes: string[] = [];
  for (const message of messages) prefixes.push(digest(prefixes.at(-1), message));
  let pendingToolStart: number | null = null;
  let pending = new Set<string>();
  let position = 0;
  for (const message of raw) {
    if (message.role === "user" || message.role === "assistant") {
      pending = new Set(
        message.role === "assistant"
          ? message.content.flatMap((block) =>
              record(block) && block.type === "toolCall" && typeof block.id === "string"
                ? [block.id]
                : [],
            )
          : [],
      );
      pendingToolStart = pending.size ? position : null;
    }
    if (message.role === "toolResult" && message.toolCallId) {
      pending.delete(message.toolCallId);
      if (!pending.size) pendingToolStart = null;
    }
    position += projectRemoteMessages([message]).length;
  }
  return { identity: digest(key), messages, prefixes, pendingToolStart };
}
