import { describe, expect, it } from "vitest";
import type { SessionPushMessage } from "../../shared/ipc";
import { createSessionRunSignalTracker, type SessionRunSignal } from "./sessionRunSignals";

type Event = { sessionId: string; signal: SessionRunSignal["kind"] };

function harness() {
  const events: Event[] = [];
  const handle = createSessionRunSignalTracker((sessionId, signal) => {
    events.push({ sessionId, signal: signal.kind });
  });
  const push = (message: Omit<SessionPushMessage, "sessionId"> & { sessionId?: string }): void => {
    handle({ ...message, sessionId: message.sessionId ?? "sess_a" } as SessionPushMessage);
  };
  return { events, push };
}

/**
 * 伙伴表情只吃 `started` / `crashed` 这两类信号（其余由提示音测试覆盖）：
 * started 用于把「投喂 → 进食」交接给「思考」，crashed 用于进程消失时报头晕。
 */
describe("createSessionRunSignalTracker", () => {
  it("agent_start 发 started；未见过 agent_start 的 agent_end 什么都不发", () => {
    const { events, push } = harness();
    push({ type: "event", payload: { type: "agent_end" } });
    expect(events).toEqual([]);
    push({ type: "event", payload: { type: "agent_start" } });
    expect(events).toEqual([{ sessionId: "sess_a", signal: "started" }]);
  });

  it("运行中进程退出发 crashed；闲置实例退出静默", () => {
    const { events, push } = harness();
    push({ type: "exit", payload: 0 });
    expect(events).toEqual([]);
    push({ type: "event", payload: { type: "agent_start" } });
    push({ type: "exit", payload: 1 });
    expect(events.map((event) => event.signal)).toEqual(["started", "crashed"]);
  });

  it("eventBatch 里的 agent_start 同样识别", () => {
    const { events, push } = harness();
    push({ type: "eventBatch", payload: [{ type: "agent_start" }] } as unknown as {
      type: "eventBatch";
      payload: never[];
    });
    expect(events).toEqual([{ sessionId: "sess_a", signal: "started" }]);
  });
});
