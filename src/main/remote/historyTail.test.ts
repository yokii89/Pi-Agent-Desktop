import { describe, expect, it, vi } from "vitest";
import type { PiChatMessage } from "../../shared/ipc";
import { EMPTY_TAIL, type HistoryView } from "./historySync";
import { RemoteHistoryTail } from "./historyTail";

const empty: HistoryView = { identity: "file", messages: [], prefixes: [] };
const raw = (text: string): PiChatMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
});

describe("bounded remote generation tail", () => {
  it("keeps a stable preview identity and clears it as soon as the final text is persisted", () => {
    const tails = new RemoteHistoryTail();
    tails.observe({
      sessionId: "session",
      type: "event",
      payload: { type: "message_start", message: raw("hello") },
    });
    const first = tails.current("session", empty);
    tails.observe({
      sessionId: "session",
      type: "event",
      payload: {
        type: "message_update",
        message: raw("hello world"),
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: " world" },
      },
    });
    const second = tails.current("session", empty);
    expect(second.messages[0].id).toBe(first.messages[0].id);
    expect(second.revision).not.toBe(first.revision);
    tails.observe({
      sessionId: "session",
      type: "event",
      payload: { type: "message_end", message: raw("hello world") },
    });
    const persisted: HistoryView = {
      identity: "file",
      prefixes: ["new"],
      messages: [
        { id: "stable", position: 0, role: "assistant", state: "done", text: "hello world" },
      ],
    };
    expect(tails.current("session", persisted)).toEqual(EMPTY_TAIL);
  });

  it("bounds large previews and does not leak thinking, tool arguments or local paths", () => {
    const tails = new RemoteHistoryTail();
    const message = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "hidden thought" },
        { type: "toolCall", id: "call", name: "bash", arguments: { secret: "hidden argument" } },
        { type: "text", text: `${"文".repeat(15_000)} C:\\Users\\name\\private.txt` },
      ],
    } as PiChatMessage;
    tails.observe({
      sessionId: "session",
      type: "event",
      payload: { type: "message_start", message },
    });
    const tail = tails.current("session", empty);
    expect(tail.messages[0].text.startsWith("…")).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(tail))).toBeLessThan(8_192);
    expect(JSON.stringify(tail)).not.toMatch(/hidden thought|hidden argument|private.txt/);
    tails.observe({ sessionId: "session", type: "exit", payload: 1 });
    expect(tails.current("session", empty)).toEqual(EMPTY_TAIL);
  });

  it("settles previews if a process finishes without message_end", () => {
    vi.useFakeTimers();
    try {
      const tails = new RemoteHistoryTail();
      tails.observe({
        sessionId: "session",
        type: "event",
        payload: { type: "message_start", message: raw("partial") },
      });
      tails.observe({ sessionId: "session", type: "event", payload: { type: "agent_settled" } });
      vi.advanceTimersByTime(3_001);
      expect(tails.current("session", empty)).toEqual(EMPTY_TAIL);
    } finally {
      vi.useRealTimers();
    }
  });
});
