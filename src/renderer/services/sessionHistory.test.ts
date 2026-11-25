import type { ConversationId, EntryId, EntryRecord } from "@earendil-works/pi-durable";
import { describe, expect, it, vi } from "vitest";
import type { SessionPushMessage, SessionTranscriptPayload } from "../../shared/ipc";
import { type SessionEntry, sessionEntriesReducer } from "../stores/sessionTranscript";
import { createSessionHistoryHydrator, readCompleteTranscript } from "./sessionHistory";

function entry(id: number): EntryRecord {
  return {
    id: id as EntryId,
    conversationId: 1 as ConversationId,
    kind: "test.notice",
    data: `saved-${id}`,
  };
}

function hydrate(entries: EntryRecord[], before?: number): SessionPushMessage {
  return {
    sessionId: "A",
    type: "event",
    payload: {
      type: "durable_projection",
      ref: { kind: "durable", id: "stored-A" },
      action: {
        type: "hydrate",
        view: {
          conversation: { id: 1 as ConversationId },
          entries,
          docs: {},
          ...(before === undefined ? {} : { before: before as EntryId }),
        },
      },
    },
  };
}

function latch<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("automatic complete session history", () => {
  it("reads every legacy page in chronological order before rebuilding the transcript", async () => {
    const messages = Array.from({ length: 205 }, (_, index) => ({
      role: "user",
      content: [{ type: "text", text: `legacy-${index}` }],
    }));
    const readPage = vi.fn(async (before = messages.length): Promise<SessionTranscriptPayload> => {
      const start = Math.max(0, before - 100);
      return {
        messages: messages.slice(start, before),
        startedAt: 123,
        truncated: start > 0,
        nextBefore: start || null,
      };
    });
    const complete = await readCompleteTranscript(readPage);
    expect(complete).toEqual({ messages, startedAt: 123, truncated: false, nextBefore: null });
    expect(readPage.mock.calls.map(([before]) => before)).toEqual([undefined, 105, 5]);
  });

  it("rejects a stalled history cursor instead of silently hiding earlier records or looping", async () => {
    const readPage = vi.fn(
      async (): Promise<SessionTranscriptPayload> => ({
        messages: [],
        startedAt: null,
        truncated: true,
        nextBefore: 10,
      }),
    );
    await expect(readCompleteTranscript(readPage)).rejects.toThrow("cursor did not advance");
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it("hydrates all Durable records before queued live events while other sessions keep updating", async () => {
    const records = Array.from({ length: 235 }, (_, index) => entry(index + 1));
    const held = latch<readonly EntryRecord[]>();
    const emitted: SessionPushMessage[] = [];
    let transcript: SessionEntry[] = [];
    const readPage = vi.fn(async (_sessionId: string, before: number) => {
      if (before === 136) return held.promise;
      return records
        .filter((record) => record.id < before)
        .slice(-100)
        .reverse();
    });
    const accept = createSessionHistoryHydrator(readPage, (message) => {
      emitted.push(message);
      if (message.sessionId === "A" && message.type === "event")
        transcript = sessionEntriesReducer(transcript, { type: "event", event: message.payload });
    });
    const live: SessionPushMessage = {
      sessionId: "A",
      type: "event",
      payload: {
        type: "durable_projection",
        ref: { kind: "durable", id: "stored-A" },
        action: { type: "entry", entry: entry(236) },
      },
    };
    const other: SessionPushMessage = { sessionId: "B", type: "exit", payload: 0 };
    accept(hydrate(records.slice(135), 135));
    accept(live);
    accept(other);
    expect(emitted).toEqual([other]);
    held.resolve(records.slice(35, 135).reverse());
    await vi.waitFor(() => expect(emitted).toHaveLength(3));
    expect(readPage.mock.calls).toEqual([
      ["A", 136],
      ["A", 36],
    ]);
    const restored = emitted[1];
    if (
      restored.type !== "event" ||
      restored.payload.type !== "durable_projection" ||
      restored.payload.action.type !== "hydrate"
    )
      throw new Error("Missing complete hydration.");
    expect(restored.payload.action.view.entries).toEqual(records);
    expect(restored.payload.action.view.before).toBeUndefined();
    expect(emitted[2]).toBe(live);
    expect(transcript.filter((item) => item.kind === "custom").map((item) => item.text)).toEqual(
      Array.from({ length: 236 }, (_, index) => `saved-${index + 1}`),
    );
  });

  it("reconstructs a tool call and result across the hydration boundary as one completed tool", async () => {
    const user: EntryRecord = {
      ...entry(1),
      kind: "pi.user",
      model: [{ role: "user", content: "Read a.ts", timestamp: 0 }],
    };
    const call: EntryRecord = {
      ...entry(2),
      kind: "pi.assistant",
      model: [
        {
          role: "assistant",
          api: "openai-completions",
          provider: "test",
          model: "test",
          timestamp: 1,
          stopReason: "toolUse",
          content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "a.ts" } }],
          usage: {
            input: 1,
            output: 2,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 3,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
      ],
    };
    const result: EntryRecord = {
      ...entry(3),
      kind: "pi.tool-result",
      model: [
        {
          role: "toolResult",
          toolCallId: "read-1",
          toolName: "read",
          timestamp: 2,
          isError: false,
          content: [{ type: "text", text: "saved output" }],
        },
      ],
    };
    let transcript: SessionEntry[] = [];
    const accept = createSessionHistoryHydrator(
      async () => [call, user],
      (message) => {
        if (message.type === "event")
          transcript = sessionEntriesReducer(transcript, { type: "event", event: message.payload });
      },
    );
    accept(hydrate([result], 2));
    await vi.waitFor(() => expect(transcript.length).toBeGreaterThan(0));
    const tools = transcript.flatMap((item) =>
      item.kind === "assistant" ? item.blocks.filter((block) => block.kind === "tool") : [],
    );
    expect(tools).toMatchObject([{ toolCallId: "read-1", status: "ok" }]);
    expect(transcript.filter((item) => item.kind === "run")).toMatchObject([
      { usage: { totalTokens: 3 } },
    ]);
  });

  it("surfaces a history read failure and releases queued events", async () => {
    const emitted: SessionPushMessage[] = [];
    const accept = createSessionHistoryHydrator(
      async () => {
        throw new Error("Cannot read saved history.");
      },
      (message) => emitted.push(message),
    );
    const initial = hydrate([entry(101)], 100);
    const exit: SessionPushMessage = { sessionId: "A", type: "exit", payload: 0 };
    accept(initial);
    accept(exit);
    await vi.waitFor(() => expect(emitted).toHaveLength(3));
    expect(emitted).toEqual([
      initial,
      { sessionId: "A", type: "error", payload: "Cannot read saved history." },
      exit,
    ]);
  });

  it("forwards complete snapshots immediately without fetching history", () => {
    const readPage = vi.fn();
    const emitted: SessionPushMessage[] = [];
    const accept = createSessionHistoryHydrator(readPage, (message) => emitted.push(message));
    const initial = hydrate([entry(1)]);
    accept(initial);
    expect(emitted).toEqual([initial]);
    expect(readPage).not.toHaveBeenCalled();
  });
});
