import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { LiveState } from "@earendil-works/pi-durable";
import { DURABLE_COMMAND_ENTRY, durableDisplayMessages } from "../../shared/durableExtension";
import { DESKTOP_RETRY_ATTEMPTS } from "../../shared/durableProtocol";
import type { DurableProjectionAction, DurableSessionUpdate } from "../../shared/durableSession";

export type { DurableProjectionAction } from "../../shared/durableSession";

import type { PiAgentEvent, PiChatMessage, PiStreamDelta } from "../../shared/ipc";

type View = Extract<DurableSessionUpdate, { type: "snapshot" }>["view"];

interface PartialAnswer {
  identity: string;
  taskId: number;
  message: AssistantMessage;
}

/** Projects one runtime session. Hydration is replacement; only new committed entries emit completion/usage. */
export class DurableProjection {
  private conversationId?: number;
  private lastEntry = 0;
  private partial?: PartialAnswer;
  private running = false;
  private queue = "";
  private retry = "";
  private compaction = "";
  private failure = "";
  private readonly calls = new Map<string, { name: string; args: unknown }>();
  private readonly started = new Set<string>();
  private readonly ended = new Set<string>();

  constructor(private readonly sessionId: string) {}

  apply(update: DurableSessionUpdate): DurableProjectionAction[] {
    if (update.sessionId !== this.sessionId)
      throw new Error("Durable projection session mismatch.");
    if (update.type === "error") return [{ type: "error", error: update.error }];
    if (update.type === "snapshot") {
      this.conversationId = update.view.conversation.id;
      this.lastEntry = update.view.entries.at(-1)?.id ?? update.view.before ?? 0;
      this.calls.clear();
      this.started.clear();
      this.ended.clear();
      this.partial = this.readPartial(update.view);
      this.running = !!this.live(update.view).run;
      this.queue = "";
      for (const entry of update.view.entries) {
        for (const message of entry.model ?? []) this.rememberCalls(message);
      }
      // Hydration includes pending tools and live state; replaying start events would duplicate UI rows.
      for (const slot of this.live(update.view).tools ?? []) {
        this.started.add(slot.callId);
        if (slot.status === "done") this.ended.add(slot.callId);
      }
      return [{ type: "hydrate", view: update.view }];
    }
    if (this.conversationId === undefined)
      throw new Error("Durable projection requires hydration first.");
    const actions: DurableProjectionAction[] = [];
    const events: PiAgentEvent[] = [];
    const flush = () => {
      if (events.length) actions.push({ type: "events", events: events.splice(0) });
    };
    if (update.type === "entries") {
      for (const entry of update.entries) {
        if (entry.conversationId !== this.conversationId)
          throw new Error("Durable entry conversation mismatch.");
        if (entry.id <= this.lastEntry) continue;
        this.lastEntry = entry.id;
        if (
          ![
            "pi.user",
            "pi.assistant",
            "pi.tool-result",
            "pi.system",
            DURABLE_COMMAND_ENTRY,
          ].includes(entry.kind)
        ) {
          flush();
          actions.push({ type: "entry", entry });
          continue;
        }
        for (const message of durableDisplayMessages(entry)) {
          this.rememberCalls(message);
          if (message.role === "system") continue;
          if (message.role === "toolResult") {
            this.startTool(message.toolCallId, message.toolName, events);
            if (!this.ended.has(message.toolCallId)) {
              this.ended.add(message.toolCallId);
              this.calls.delete(message.toolCallId);
              events.push({
                type: "tool_execution_end",
                toolCallId: message.toolCallId,
                toolName: message.toolName,
                result: {
                  content: message.content,
                  details: message.details,
                  nestedCalls: message.nestedCalls,
                  diagnostics: entry.data,
                },
                isError: message.isError,
                durationMs: message.durationMs,
              });
            }
            continue;
          }
          if (message.role === "assistant") {
            this.startRun(events);
            if (!this.partial || this.partial.taskId !== entry.byTaskId) {
              events.push({ type: "message_start", message: chat(message, true) });
            }
            events.push({ type: "message_end", message: chat(message) });
            this.partial = undefined;
          } else if (message.role === "user") {
            this.startRun(events);
            events.push({ type: "durable_user", entryId: entry.id, message: chat(message) });
          }
        }
      }
    } else {
      if (update.view.conversation.id !== this.conversationId)
        throw new Error("Durable view conversation mismatch.");
      const live = this.live(update.view);
      if (live.run) this.startRun(events);
      const next = this.readPartial(update.view);
      if (next) {
        if (!this.partial || this.partial.identity !== next.identity) {
          // A failed attempt must be finalized by its saved entry before the next attempt starts.
          // If it was folded out, force replacement instead of appending to its stale partial.
          if (this.partial) {
            flush();
            actions.push({
              type: "reconcile",
              identity: next.identity,
              message: chat(next.message),
            });
          } else {
            events.push({ type: "message_start", message: chat(next.message, true) });
            if (!this.appendDeltas(undefined, next.message, events)) {
              flush();
              actions.push({
                type: "reconcile",
                identity: next.identity,
                message: chat(next.message),
              });
            }
          }
        } else if (!this.appendDeltas(this.partial.message, next.message, events)) {
          flush();
          actions.push({ type: "reconcile", identity: next.identity, message: chat(next.message) });
        }
        this.partial = next;
      }
      for (const slot of live.tools ?? []) {
        if (slot.status === "pending" || slot.status === "done") continue;
        this.startTool(slot.callId, slot.name, events);
        if (slot.output !== undefined || slot.details !== undefined) {
          events.push({
            type: "tool_execution_update",
            toolCallId: slot.callId,
            partialResult: {
              content: [{ type: "text", text: slot.output ?? "" }],
              details: slot.details,
            },
          });
        }
      }
      for (const nested of live.nestedTools ?? []) {
        if (!this.started.has(nested.callId)) {
          this.started.add(nested.callId);
          events.push({
            type: "tool_execution_start",
            toolCallId: nested.callId,
            toolName: nested.name,
            args: nested.arguments,
            parentToolCallId: nested.parentCallId,
          });
        }
        if (nested.status === "done" && !this.ended.has(nested.callId)) {
          this.ended.add(nested.callId);
          events.push({
            type: "tool_execution_end",
            toolCallId: nested.callId,
            toolName: nested.name,
            parentToolCallId: nested.parentCallId,
            isError: nested.summary?.isError,
            durationMs: nested.summary?.durationMs,
            result: {
              content: [{ type: "text", text: nested.output ?? nested.summary?.error ?? "" }],
              details: nested.details,
            },
          });
        }
      }
      this.projectStatus(live, events);
      this.projectQueue(update.view, events);
      if (update.type === "settled" && this.running) {
        this.running = false;
        this.partial = undefined;
        events.push({ type: "agent_end" });
        events.push({ type: "agent_settled", aborted: live.runFailure?.reason === "aborted" });
      }
    }
    flush();
    return actions;
  }

  private projectStatus(live: LiveState, events: PiAgentEvent[]): void {
    const retry = live.generation?.retry;
    const key = retry ? JSON.stringify([live.run?.taskId, live.generation?.attempt, retry]) : "";
    if (key !== this.retry) {
      if (retry)
        events.push({
          type: "auto_retry_start",
          attempt: (live.generation?.attempt ?? 0) + 1,
          maxAttempts: DESKTOP_RETRY_ATTEMPTS,
          errorMessage: retry.error,
        });
      else if (this.retry) events.push({ type: "auto_retry_end", success: !live.runFailure });
      this.retry = key;
    }
    const compaction = JSON.stringify(live.compactions?.map((item) => item.taskId) ?? []);
    if (compaction !== this.compaction) {
      if (live.compactions?.length)
        events.push({ type: "compaction_start", reason: live.compactions[0].trigger });
      else if (this.compaction && this.compaction !== "[]")
        events.push({ type: "compaction_end", errorMessage: live.compactionFailure?.error });
      this.compaction = compaction;
    }
    const failure = JSON.stringify(live.runFailure ?? null);
    if (
      failure !== this.failure &&
      live.runFailure &&
      !["aborted", "nothing_to_answer"].includes(live.runFailure.reason)
    ) {
      events.push({
        type: "durable_projection",
        ref: { kind: "durable", id: this.sessionId },
        action: { type: "error", error: live.runFailure.detail ?? live.runFailure.reason },
      });
    }
    this.failure = failure;
  }

  private startRun(events: PiAgentEvent[]): void {
    if (this.running) return;
    this.running = true;
    this.started.clear();
    this.ended.clear();
    events.push({ type: "agent_start" });
  }

  private rememberCalls(message: Message): void {
    if (message.role !== "assistant") return;
    for (const block of message.content) {
      if (block.type === "toolCall")
        this.calls.set(block.id, { name: block.name, args: block.arguments });
    }
  }

  private startTool(callId: string, name: string, events: PiAgentEvent[]): void {
    if (this.started.has(callId)) return;
    this.started.add(callId);
    events.push({
      type: "tool_execution_start",
      toolCallId: callId,
      toolName: name,
      args: this.calls.get(callId)?.args,
    });
  }

  private live(view: View): LiveState {
    return (view.docs["pi.live"] ?? {}) as LiveState;
  }

  private readPartial(view: View): PartialAnswer | undefined {
    const live = this.live(view);
    if (!live.run || !live.generation?.message) return undefined;
    return {
      identity: `${view.conversation.id}:${live.run.taskId}:${live.generation.attempt}`,
      taskId: live.run.taskId,
      message: live.generation.message as AssistantMessage,
    };
  }

  private appendDeltas(
    previous: AssistantMessage | undefined,
    next: AssistantMessage,
    events: PiAgentEvent[],
  ): boolean {
    const deltas: PiStreamDelta[] = [];
    if (previous && previous.content.length > next.content.length) return false;
    for (const [contentIndex, block] of next.content.entries()) {
      const old = previous?.content[contentIndex];
      if (old && old.type !== block.type) return false;
      let before = "";
      let after = "";
      if (block.type === "text") {
        before = old?.type === "text" ? old.text : "";
        after = block.text;
        if (!old) deltas.push({ type: "text_start", contentIndex });
        if (!after.startsWith(before)) return false;
        if (after.length > before.length)
          deltas.push({ type: "text_delta", contentIndex, delta: after.slice(before.length) });
      } else if (block.type === "thinking") {
        before = old?.type === "thinking" ? old.thinking : "";
        after = block.thinking;
        if (!old) deltas.push({ type: "thinking_start", contentIndex });
        if (!after.startsWith(before)) return false;
        if (after.length > before.length)
          deltas.push({ type: "thinking_delta", contentIndex, delta: after.slice(before.length) });
      } else if (block.type === "toolCall") {
        // Partial argument JSON is not prefix-stable after parsing. Replace on change; never append serialized objects.
        if (
          old?.type === "toolCall" &&
          (old.id !== block.id || JSON.stringify(old.arguments) !== JSON.stringify(block.arguments))
        )
          return false;
        if (!old) {
          deltas.push({ type: "toolcall_start", id: block.id, toolName: block.name, contentIndex });
          deltas.push({
            type: "toolcall_delta",
            delta: JSON.stringify(block.arguments),
            contentIndex,
          });
        }
      } else {
        return false;
      }
    }
    events.push(
      ...deltas.map(
        (assistantMessageEvent): PiAgentEvent => ({
          type: "message_update",
          assistantMessageEvent,
        }),
      ),
    );
    return true;
  }

  private projectQueue(view: View, events: PiAgentEvent[]): void {
    const inbox = view.docs["pi.inbox"]?.items;
    const steering: string[] = [];
    const followUp: string[] = [];
    if (Array.isArray(inbox)) {
      for (const item of inbox) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const content = item.content;
        const text =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content
                  .flatMap((block) => {
                    if (!block || typeof block !== "object" || Array.isArray(block)) return [];
                    return block.type === "text" && typeof block.text === "string"
                      ? [block.text]
                      : [];
                  })
                  .join("\n")
              : "";
        if (item.mode === "steer") steering.push(text);
        if (item.mode === "followUp") followUp.push(text);
      }
    }
    const key = JSON.stringify([steering, followUp]);
    if (key !== this.queue) {
      this.queue = key;
      events.push({ type: "queue_update", steering, followUp });
    }
  }
}

function chat(message: Message, empty = false): PiChatMessage {
  if (message.role === "system") return { role: "system", content: [] };
  const content =
    typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : [...message.content];
  return { ...message, content: empty ? [] : content };
}
