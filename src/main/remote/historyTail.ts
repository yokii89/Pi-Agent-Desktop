import { createHash, randomUUID } from "node:crypto";
import type { PiChatMessage, SessionPushMessage } from "../../shared/ipc";
import { HISTORY_TAIL_BYTES, type HistoryTail } from "../../shared/remote";
import { EMPTY_TAIL, type HistoryView } from "./historySync";
import { projectRemoteMessages } from "./readAdapter";

interface PendingTail extends HistoryTail {
  id: string;
  endedAt?: number;
  finalText?: string;
  observedHead?: string;
}

/** A bounded preview of the current response. The transcript itself is indexed from disk. */
export class RemoteHistoryTail {
  private readonly tails = new Map<string, PendingTail>();

  observe(event: SessionPushMessage): void {
    const { sessionId } = event;
    if (event.type === "exit") {
      this.tails.delete(sessionId);
      return;
    }
    const updates =
      event.type === "eventBatch" ? event.payload : event.type === "event" ? [event.payload] : [];
    const update = [...updates]
      .reverse()
      .find(
        (item) =>
          (item.type === "message_start" ||
            item.type === "message_update" ||
            item.type === "message_end") &&
          item.message?.role === "assistant",
      );
    const terminal = updates.some(
      (item) => item.type === "agent_settled" || item.type === "agent_end",
    );
    const pending = this.tails.get(sessionId);
    if (terminal && pending && pending.endedAt === undefined) pending.endedAt = Date.now();
    if (!update || !("message" in update) || !update.message) return;
    this.set(
      sessionId,
      update.message,
      update.type === "message_start",
      update.type === "message_end",
    );
  }

  private set(sessionId: string, raw: PiChatMessage, start: boolean, end: boolean): void {
    const previous = this.tails.get(sessionId);
    const id = !start && previous && !previous.endedAt ? previous.id : randomUUID();
    const projected = projectRemoteMessages([raw]);
    const chunk = projected.at(-1);
    if (!chunk && !start) return;
    const messages: HistoryTail["messages"] = chunk
      ? [
          {
            ...chunk,
            id,
            text: `${chunk.text.length > 1_200 || projected.length > 1 ? "…" : ""}${chunk.text.slice(-1_200)}`,
            state: "running",
          },
        ]
      : [];
    if (Buffer.byteLength(JSON.stringify(messages)) > HISTORY_TAIL_BYTES - 256) messages.length = 0;
    const revision = messages.length
      ? createHash("sha256").update(JSON.stringify(messages)).digest("hex")
      : EMPTY_TAIL.revision;
    this.tails.delete(sessionId);
    this.tails.set(sessionId, {
      id,
      messages,
      revision,
      ...(previous?.id === id && previous.observedHead !== undefined
        ? { observedHead: previous.observedHead }
        : {}),
      ...(end ? { endedAt: Date.now(), finalText: chunk?.text } : {}),
    });
    if (this.tails.size > 16) {
      const oldest = this.tails.keys().next().value;
      if (oldest) this.tails.delete(oldest);
    }
  }

  current(sessionId: string | null, view: HistoryView): HistoryTail {
    if (!sessionId) return EMPTY_TAIL;
    const tail = this.tails.get(sessionId);
    if (!tail) return EMPTY_TAIL;
    const head = view.prefixes.at(-1) ?? "empty";
    let latest: string | undefined;
    for (let i = view.messages.length - 1; i >= 0; i--) {
      if (view.messages[i].role !== "assistant") continue;
      latest = view.messages[i].text;
      break;
    }
    const persisted = latest === tail.finalText && head !== tail.observedHead;
    if (tail.endedAt && (persisted || Date.now() - tail.endedAt > 3_000)) {
      this.tails.delete(sessionId);
      return EMPTY_TAIL;
    }
    tail.observedHead ??= head;
    return { revision: tail.revision, messages: tail.messages };
  }
}
