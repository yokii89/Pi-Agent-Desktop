import { describe, expect, it } from "vitest";
import type { ViewAgentEvent } from "../../../shared/view";
import { agentConversationEntries } from "./agentConversationEntries";

function event(
  id: string,
  kind: ViewAgentEvent["kind"],
  patch: Partial<ViewAgentEvent> = {},
): ViewAgentEvent {
  return { id, kind, content: id, ...patch };
}

describe("agent conversation rendering model", () => {
  it("groups adjacent assistant text, thinking and tools while preserving conversation boundaries", () => {
    const events = [
      event("u1", "user"),
      event("thinking", "thinking"),
      event("tool", "tool", {
        toolName: "read",
        input: '{"path":"README.md"}',
        state: "completed",
      }),
      event("answer", "assistant", { timestamp: 1234 }),
      event("notice", "notice"),
      event("followup", "assistant"),
      event("u2", "user"),
    ];
    const entries = agentConversationEntries(events);
    expect(entries.map((entry) => [entry.kind, entry.id])).toEqual([
      ["user", "u1"],
      ["assistant", "thinking"],
      ["notice", "notice"],
      ["assistant", "followup"],
      ["user", "u2"],
    ]);
    const assistant = entries[1];
    expect(assistant).toMatchObject({
      at: 1234,
      blocks: [
        { kind: "thinking", contentIndex: 0 },
        { kind: "tool", contentIndex: 1, toolKind: "read", subject: "README.md" },
        { kind: "text", contentIndex: 2, text: "answer" },
      ],
    });
    expect(events[1]).toEqual(event("thinking", "thinking"));
  });

  it.each([
    ["queued", "pending"],
    ["running", "running"],
    ["completed", "ok"],
    ["stopped", "cancelled"],
    ["error", "error"],
  ] as const)("maps tool state %s to %s without inventing execution times", (state, status) => {
    const entries = agentConversationEntries([
      event("call", "tool", {
        toolName: "bash",
        input: '{"command":"git status"}',
        content: "output",
        timestamp: 1234,
        state,
      }),
    ]);
    expect(entries[0]).toMatchObject({
      blocks: [
        {
          toolCallId: "call",
          status,
          subject: "git status",
          argsText: '{"command":"git status"}',
          resultText: "output",
          result: { kind: "terminal", command: "git status", output: "output" },
          startedAt: null,
          endedAt: null,
          durationMs: null,
        },
      ],
    });
  });

  it("keeps raw and truncated arguments readable and supports plain bash commands", () => {
    const entries = agentConversationEntries([
      event("partial", "tool", { toolName: "unknown", input: '{"path":"truncated…', content: "" }),
      event("bash", "tool", {
        toolName: "bash",
        input: "echo hello",
        content: "hello",
        state: "completed",
      }),
    ]);
    expect(entries[0]).toMatchObject({
      blocks: [
        { argsText: '{"path":"truncated…', args: null, status: "pending", result: null },
        { args: { command: "echo hello" }, subject: "echo hello", status: "ok" },
      ],
    });
  });

  it("retains extension notices and errors as separate main conversation entries", () => {
    expect(
      agentConversationEntries([
        event("notice", "notice", {
          title: "bash-job",
          content: "Job finished\nDetails",
          timestamp: 100,
        }),
        event("error", "error", {
          title: "Agent failed",
          content: "Failure details",
          timestamp: 200,
        }),
      ]),
    ).toEqual([
      {
        kind: "custom",
        id: "notice",
        customType: "bash-job",
        text: "Job finished\nDetails",
        at: 100,
      },
      { kind: "error", id: "error", title: "Agent failed", message: "Failure details", at: 200 },
    ]);
  });

  it("preserves stream identity and explicit streaming flags as snapshots grow", () => {
    const first = agentConversationEntries([
      event("reply", "assistant", { content: "a", state: "running" }),
    ]);
    const next = agentConversationEntries([
      event("reply", "assistant", { content: "answer", state: "completed" }),
    ]);
    expect(first[0]).toMatchObject({ id: "reply", blocks: [{ text: "a", streaming: true }] });
    expect(next[0]).toMatchObject({ id: "reply", blocks: [{ text: "answer", streaming: false }] });
  });
});
