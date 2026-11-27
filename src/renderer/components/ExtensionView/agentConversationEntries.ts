import type { ViewAgentEvent } from "../../../shared/view";
import type {
  AssistantEntry,
  CustomEntry,
  ErrorEntry,
  NoticeEntry,
  UserEntry,
} from "../../stores/sessionTranscript";
import {
  actionLabel,
  buildToolResult,
  classifyTool,
  parseToolArgs,
  type ToolStatus,
} from "../../stores/toolPayload";

export type AgentConversationEntry =
  | UserEntry
  | AssistantEntry
  | CustomEntry
  | NoticeEntry
  | ErrorEntry;

const TOOL_STATUS: Record<NonNullable<ViewAgentEvent["state"]>, ToolStatus> = {
  idle: "ok",
  queued: "pending",
  running: "running",
  completed: "ok",
  stopped: "cancelled",
  error: "error",
};

/** Adapt read-only workspace events to the main conversation's rendering model. */
export function agentConversationEntries(events: ViewAgentEvent[]): AgentConversationEntry[] {
  const entries: AgentConversationEntry[] = [];
  for (const event of events) {
    if (event.kind === "user") {
      entries.push({ kind: "user", id: event.id, text: event.content });
      continue;
    }
    if (event.kind === "notice") {
      entries.push(
        event.title
          ? {
              kind: "custom",
              id: event.id,
              customType: event.title,
              text: event.content,
              at: event.timestamp ?? 0,
            }
          : { kind: "notice", id: event.id, text: event.content, at: event.timestamp ?? 0 },
      );
      continue;
    }
    if (event.kind === "error") {
      entries.push({
        kind: "error",
        id: event.id,
        title: event.title ?? "",
        message: event.content,
        at: event.timestamp ?? 0,
      });
      continue;
    }

    // Keep adjacent model responses together so the shared UI can group thinking and tools.
    const previous = entries[entries.length - 1];
    const assistant: AssistantEntry =
      previous?.kind === "assistant" ? previous : { kind: "assistant", id: event.id, blocks: [] };
    if (assistant !== previous) entries.push(assistant);
    assistant.at = event.timestamp ?? assistant.at;
    const contentIndex = assistant.blocks.length;
    if (event.kind !== "tool") {
      assistant.blocks.push({
        kind: event.kind === "assistant" ? "text" : "thinking",
        text: event.content,
        streaming: event.state === "running",
        contentIndex,
      });
      continue;
    }

    const name = event.toolName ?? event.title ?? "tool";
    const toolKind = classifyTool(name);
    const argsText = event.input ?? "";
    let args: unknown = null;
    try {
      args = JSON.parse(argsText);
    } catch {
      // bashExecution carries the command itself rather than a JSON arguments object.
      if (name === "bash" && argsText && !argsText.trimStart().startsWith("{")) {
        args = { command: argsText };
      }
    }
    const status = event.state ? TOOL_STATUS[event.state] : event.content ? "ok" : "pending";
    assistant.blocks.push({
      kind: "tool",
      toolCallId: event.id,
      name,
      toolKind,
      action: actionLabel(toolKind),
      subject: parseToolArgs(toolKind, args).subject,
      args,
      argsText,
      status,
      result:
        event.content || status === "ok" || status === "error"
          ? buildToolResult(toolKind, args, event.content, status === "error")
          : null,
      resultText: event.content || null,
      // The workspace timestamp is the message time, not a measured execution duration.
      startedAt: null,
      endedAt: null,
      durationMs: null,
      contentIndex,
    });
  }
  return entries;
}
