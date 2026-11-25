import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ConversationId,
  EntryId,
  EntryRecord,
  LiveState,
  TaskId,
} from "@earendil-works/pi-durable";
import { describe, expect, it } from "vitest";
import type { DurableSessionUpdate } from "../../shared/durableSession";
import { DurableProjection, type DurableProjectionAction } from "./durableProjection";

type View = Extract<DurableSessionUpdate, { type: "snapshot" }>["view"];
const sessionId = "test-session";
const conversationId = 1 as ConversationId;
const taskId = 10 as TaskId;

function message(text: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "test",
    provider: "faux",
    model: "test",
    stopReason: "pending",
    timestamp: 1,
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  } satisfies AssistantMessage;
}
function view(live: LiveState = {}, entries: EntryRecord[] = []): View {
  return { conversation: { id: conversationId }, entries, docs: { "pi.live": live } };
}
function live(text: string, attempt = 1): View {
  return view({
    run: { taskId, inputs: [], turns: 0 },
    generation: { attempt, message: message(text) },
  });
}
function events(actions: DurableProjectionAction[]) {
  return actions.flatMap((action) => (action.type === "events" ? action.events : []));
}
function entry(id: number, text: string): EntryRecord {
  return {
    id: id as EntryId,
    conversationId,
    byTaskId: taskId,
    kind: "pi.assistant",
    model: [{ ...message(text), stopReason: "stop" }],
  };
}
function attach(projection: DurableProjection, initial = view()) {
  return projection.apply({ type: "snapshot", sessionId, view: initial });
}

describe("Durable conversation projection", () => {
  it("hydrates live state without replay and emits only appended text afterward", () => {
    const projection = new DurableProjection(sessionId);
    expect(attach(projection, live("hello"))).toEqual([{ type: "hydrate", view: live("hello") }]);
    const next = events(projection.apply({ type: "live", sessionId, view: live("hello world") }));
    expect(next.filter((event) => event.type === "message_update")).toEqual([
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: " world" },
      },
    ]);
    expect(next.some((event) => event.type === "message_start")).toBe(false);
    expect(
      events(projection.apply({ type: "live", sessionId, view: live("hello world") })).filter(
        (event) => event.type === "message_update",
      ),
    ).toHaveLength(0);
  });

  it("reconciles a replaced partial and a new attempt instead of appending stale text", () => {
    const projection = new DurableProjection(sessionId);
    attach(projection, live("old partial"));
    const replaced = projection.apply({ type: "live", sessionId, view: live("replacement") });
    expect(
      replaced.some(
        (action) =>
          action.type === "reconcile" && action.message.content[0] && action.identity === "1:10:1",
      ),
    ).toBe(true);
    expect(events(replaced).filter((event) => event.type === "message_update")).toHaveLength(0);
    const retried = projection.apply({ type: "live", sessionId, view: live("new attempt", 2) });
    expect(
      retried.some((action) => action.type === "reconcile" && action.identity === "1:10:2"),
    ).toBe(true);
  });

  it("finalizes each entry and its usage once, including a failed attempt before retry", () => {
    const projection = new DurableProjection(sessionId);
    attach(projection, live("failed"));
    const failed = {
      ...entry(1, "failed"),
      model: [{ ...message("failed"), stopReason: "error" as const }],
    };
    const done = events(projection.apply({ type: "entries", sessionId, entries: [failed] }));
    expect(done.filter((event) => event.type === "message_end")).toHaveLength(1);
    expect(
      events(projection.apply({ type: "entries", sessionId, entries: [failed] })),
    ).toHaveLength(0);
    const retry = events(projection.apply({ type: "live", sessionId, view: live("retry", 2) }));
    expect(retry.filter((event) => event.type === "message_start")).toHaveLength(1);
    expect(retry.filter((event) => event.type === "message_update")).toHaveLength(2);
    const completed = events(
      projection.apply({ type: "entries", sessionId, entries: [entry(2, "retry")] }),
    );
    const ending = completed.find((event) => event.type === "message_end");
    expect(ending?.type === "message_end" && ending.message.usage?.totalTokens).toBe(3);
  });

  it("reconstructs a tool that completed between live snapshots from committed entries", () => {
    const projection = new DurableProjection(sessionId);
    attach(projection);
    const assistant = entry(1, "");
    const toolAnswer: EntryRecord = {
      ...assistant,
      model: [
        {
          ...message(""),
          content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } }],
          stopReason: "toolUse",
        },
      ],
    };
    const result: EntryRecord = {
      id: 2 as EntryId,
      conversationId,
      kind: "pi.tool-result",
      model: [
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "read",
          content: [{ type: "text", text: "saved" }],
          isError: false,
          timestamp: 2,
          durationMs: 7,
        },
      ],
    };
    const projected = events(
      projection.apply({ type: "entries", sessionId, entries: [toolAnswer, result] }),
    );
    expect(projected.filter((event) => event.type === "tool_execution_start")).toEqual([
      {
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "read",
        args: { path: "a.ts" },
      },
    ]);
    expect(projected.filter((event) => event.type === "tool_execution_end")).toMatchObject([
      { durationMs: 7, result: { content: [{ type: "text", text: "saved" }] } },
    ]);
    expect(
      events(projection.apply({ type: "entries", sessionId, entries: [toolAnswer, result] })),
    ).toHaveLength(0);
  });

  it("settles only at the ownership boundary and preserves unknown entries and errors", () => {
    const projection = new DurableProjection(sessionId);
    attach(projection, live("answer"));
    const answer = entry(1, "answer");
    expect(
      events(projection.apply({ type: "entries", sessionId, entries: [answer] })).some(
        (event) => event.type === "agent_settled",
      ),
    ).toBe(false);
    expect(
      events(projection.apply({ type: "live", sessionId, view: view({}, [answer]) })).some(
        (event) => event.type === "agent_settled",
      ),
    ).toBe(false);
    expect(
      events(projection.apply({ type: "settled", sessionId, view: view({}, [answer]) })).filter(
        (event) => event.type === "agent_settled",
      ),
    ).toHaveLength(1);
    expect(
      events(projection.apply({ type: "settled", sessionId, view: view({}, [answer]) })).filter(
        (event) => event.type === "agent_settled",
      ),
    ).toHaveLength(0);
    const custom: EntryRecord = {
      id: 2 as EntryId,
      conversationId,
      kind: "custom.notice",
      data: "hello",
    };
    expect(projection.apply({ type: "entries", sessionId, entries: [custom] })).toEqual([
      { type: "entry", entry: custom },
    ]);
    expect(projection.apply({ type: "error", sessionId, error: "storage failed" })).toEqual([
      { type: "error", error: "storage failed" },
    ]);
  });

  it("refuses cross-session data and data before hydration", () => {
    const projection = new DurableProjection(sessionId);
    expect(() => projection.apply({ type: "entries", sessionId, entries: [] })).toThrow(
      /hydration/,
    );
    expect(() =>
      projection.apply({ type: "snapshot", sessionId: "another", view: view() }),
    ).toThrow(/session mismatch/);
    attach(projection);
    expect(() =>
      projection.apply({
        type: "entries",
        sessionId,
        entries: [{ ...entry(1, "bad"), conversationId: 9 as ConversationId }],
      }),
    ).toThrow(/conversation mismatch/);
  });
});
