import { describe, expect, it } from "vitest";
import type { PiAgentEvent } from "../../../shared/ipc";
import { type SessionEntry, sessionEntriesReducer } from "../../stores/sessionTranscript";
import { findFirstTokenWaitingRunId } from "./firstTokenWaiting";

function replay(events: PiAgentEvent[], initial: SessionEntry[] = []): SessionEntry[] {
  return sessionEntriesReducer(initial, { type: "events", events });
}

function start(): SessionEntry[] {
  return replay([{ type: "agent_start" }]);
}

describe("first-token waiting follows visible model activity", () => {
  it("keeps waiting through message_start and empty text_start, then yields to text", () => {
    let entries = start();
    const runId = entries[0].id;
    expect(findFirstTokenWaitingRunId(entries)).toBe(runId);
    entries = replay(
      [
        { type: "message_start", message: { role: "assistant", content: [] } },
        { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } },
      ],
      entries,
    );
    expect(findFirstTokenWaitingRunId(entries)).toBe(runId);
    entries = replay(
      [
        {
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "回复" },
        },
      ],
      entries,
    );
    expect(findFirstTokenWaitingRunId(entries)).toBeNull();
    // 下一次模型调用的空消息不能让已经有输出的本轮重新显示首字等待。
    entries = replay(
      [{ type: "message_start", message: { role: "assistant", content: [] } }],
      entries,
    );
    expect(findFirstTokenWaitingRunId(entries)).toBeNull();
  });

  it.each<PiAgentEvent>([
    { type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } },
    {
      type: "tool_execution_start",
      toolCallId: "read-1",
      toolName: "read",
      args: { path: "README.md" },
    },
  ])("yields when a visible thinking/tool row starts: $type", (event) => {
    expect(findFirstTokenWaitingRunId(replay([event], start()))).toBeNull();
  });

  it("does not treat a background job notice as a model response", () => {
    const entries = start();
    const withNotice = replay(
      [
        {
          type: "message_start",
          message: {
            role: "custom",
            customType: "bash-job",
            content: [{ type: "text", text: "Job finished" }],
            display: true,
          },
        },
      ],
      entries,
    );
    expect(withNotice.at(-1)?.kind).toBe("custom");
    expect(findFirstTokenWaitingRunId(withNotice)).toBe(entries[0].id);
  });

  it("clears on stop, errors and completion; a new run gets its own wait", () => {
    const entries = start();
    expect(
      findFirstTokenWaitingRunId(sessionEntriesReducer(entries, { type: "userStop" })),
    ).toBeNull();
    expect(
      findFirstTokenWaitingRunId(
        sessionEntriesReducer(entries, { type: "processError", message: "Disconnected" }),
      ),
    ).toBeNull();
    const completed = replay([{ type: "agent_settled", aborted: false }], entries);
    expect(findFirstTokenWaitingRunId(completed)).toBeNull();
    const next = replay([{ type: "agent_start" }], completed);
    expect(findFirstTokenWaitingRunId(next)).toBe(next.at(-1)?.id);
    expect(findFirstTokenWaitingRunId(next)).not.toBe(entries[0].id);
  });

  it("does not claim model waiting during retry backoff or for synthetic history", () => {
    const entries = start();
    const retrying = replay([{ type: "auto_retry_start", attempt: 1, maxAttempts: 3 }], entries);
    expect(findFirstTokenWaitingRunId(retrying)).toBeNull();
    const synthetic = entries.map((entry) =>
      entry.kind === "run" ? { ...entry, synthetic: true } : entry,
    );
    expect(findFirstTokenWaitingRunId(synthetic)).toBeNull();
    expect(findFirstTokenWaitingRunId([])).toBeNull();
  });
});
