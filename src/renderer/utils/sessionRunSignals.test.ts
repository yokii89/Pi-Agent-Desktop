import { describe, expect, it } from "vitest";
import type { PiAgentEvent, SessionPushMessage } from "../../shared/ipc";
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

const kinds = (events: Event[]): SessionRunSignal["kind"][] => events.map((e) => e.signal);

/** 只关心终态：滤掉 agent_start 的 started，便于断言「一场只发一次终态」。 */
function terminals(events: Event[]): SessionRunSignal["kind"][] {
  return kinds(events).filter((k) => k !== "started");
}

function assistantEnd(stopReason: string): PiAgentEvent {
  return { type: "message_end", message: { role: "assistant", content: [], stopReason } };
}

/**
 * 伙伴表情只吃 `started` / `crashed` 这两类信号（提示音见 sessionSoundTriggers.test.ts）：
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

/**
 * 收口矩阵（docs/design/76 §5.4）：终态以 agent_end(willRetry≠true) 为准，
 * agent_settled 只兜底「没有终态 agent_end」的 run，且 aborted 优先于残留 stopReason。
 */
describe("createSessionRunSignalTracker 收口", () => {
  it("重试退避期被中断：auto_retry_end 不抢先发 failed，settled(aborted) 只发一次 interrupted", () => {
    const { events, push } = harness();
    push({ type: "event", payload: { type: "agent_start" } });
    push({ type: "event", payload: assistantEnd("error") });
    push({ type: "event", payload: { type: "agent_end", willRetry: true } });
    push({
      type: "event",
      payload: { type: "auto_retry_end", success: false, finalError: "Retry cancelled" },
    });
    expect(terminals(events)).toEqual([]);
    push({ type: "event", payload: { type: "agent_settled", aborted: true } });
    expect(terminals(events)).toEqual(["interrupted"]);
  });

  it("首条 assistant 前被中断：agent_end 已收口，settled(aborted) 不双发", () => {
    const { events, push } = harness();
    push({ type: "event", payload: { type: "agent_start" } });
    push({ type: "event", payload: assistantEnd("aborted") });
    push({ type: "event", payload: { type: "agent_end" } });
    push({ type: "event", payload: { type: "agent_settled", aborted: true } });
    expect(terminals(events)).toEqual(["interrupted"]);
  });

  it("没有终态 agent_end 时 settled(aborted) 兜底；未见 agent_start 的 settled 静默", () => {
    const { events, push } = harness();
    // 预热 / 空闲实例也会推 settled，不能凭空发终态
    push({ type: "event", payload: { type: "agent_settled", aborted: true } });
    expect(events).toEqual([]);
    push({ type: "event", payload: { type: "agent_start" } });
    push({ type: "event", payload: { type: "agent_settled", aborted: true } });
    expect(terminals(events)).toEqual(["interrupted"]);
    push({ type: "event", payload: { type: "agent_settled", aborted: true } });
    expect(terminals(events)).toEqual(["interrupted"]);
  });

  it("正常完成：agent_end 收口后 settled(aborted=false) 不双发", () => {
    const { events, push } = harness();
    push({ type: "event", payload: { type: "agent_start" } });
    push({ type: "event", payload: assistantEnd("turnEnd") });
    push({ type: "event", payload: { type: "agent_end" } });
    push({ type: "event", payload: { type: "agent_settled", aborted: false } });
    expect(terminals(events)).toEqual(["completed"]);
  });

  it("重试耗尽：终态 agent_end(error) 收口一次 failed，其后的 auto_retry_end 与 settled 不补发", () => {
    const { events, push } = harness();
    push({ type: "event", payload: { type: "agent_start" } });
    push({ type: "event", payload: assistantEnd("error") });
    push({ type: "event", payload: { type: "agent_end", willRetry: true } });
    push({ type: "event", payload: { type: "agent_start" } });
    push({ type: "event", payload: assistantEnd("error") });
    push({ type: "event", payload: { type: "agent_end" } });
    push({
      type: "event",
      payload: { type: "auto_retry_end", success: false, finalError: "overloaded_error" },
    });
    push({ type: "event", payload: { type: "agent_settled", aborted: false } });
    expect(terminals(events)).toEqual(["failed"]);
  });

  it("aborted 优先于残留 stopReason：上一 attempt 的 error 不能把中断判成失败", () => {
    const { events, push } = harness();
    push({ type: "event", payload: { type: "agent_start" } });
    push({ type: "event", payload: assistantEnd("error") });
    push({ type: "event", payload: { type: "agent_settled", aborted: true } });
    expect(terminals(events)).toEqual(["interrupted"]);
  });

  it("旧 pi 无 aborted 字段：settled 回退 stopReason 启发式", () => {
    const { events, push } = harness();
    push({ type: "event", payload: { type: "agent_start" } });
    push({ type: "event", payload: assistantEnd("error") });
    push({ type: "event", payload: { type: "agent_end", willRetry: true } });
    push({ type: "event", payload: { type: "agent_settled" } });
    expect(terminals(events)).toEqual(["failed"]);

    const second = harness();
    second.push({ type: "event", payload: { type: "agent_start" } });
    second.push({ type: "event", payload: assistantEnd("length") });
    second.push({ type: "event", payload: { type: "agent_end", willRetry: true } });
    second.push({ type: "event", payload: { type: "agent_settled" } });
    expect(terminals(second.events)).toEqual(["truncated"]);
  });

  it("settled 不吞 stderr 已发的一次性 failed", () => {
    const { events, push } = harness();
    push({ type: "event", payload: { type: "agent_start" } });
    push({ type: "error", payload: "boom" });
    push({ type: "event", payload: { type: "agent_settled", aborted: false } });
    expect(terminals(events)).toEqual(["failed"]);
  });

  it("eventBatch 里的 settled 与单条 event 同口径", () => {
    const { events, push } = harness();
    push({
      type: "eventBatch",
      payload: [
        { type: "agent_start" },
        assistantEnd("error"),
        { type: "agent_end", willRetry: true },
        { type: "auto_retry_end", success: false, finalError: "Retry cancelled" },
        { type: "agent_settled", aborted: true },
      ],
    } as unknown as { type: "eventBatch"; payload: never[] });
    expect(terminals(events)).toEqual(["interrupted"]);
  });
});
