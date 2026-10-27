import { describe, expect, it } from "vitest";
import type { SessionPushMessage } from "../../shared/ipc";
import type { NotificationScenarioId } from "../../shared/notification";
import { createSessionSoundTriggers } from "./sessionSoundTriggers";

type Play = { scenario: NotificationScenarioId; sessionId: string; reason?: string };

function harness() {
  const plays: Play[] = [];
  const handle = createSessionSoundTriggers((scenario, sessionId, reason) => {
    plays.push({ scenario, sessionId, reason });
  });
  const push = (message: Omit<SessionPushMessage, "sessionId"> & { sessionId?: string }): void => {
    handle({ ...message, sessionId: message.sessionId ?? "sess_a" } as SessionPushMessage);
  };
  const run = (stopReason?: string, sessionId?: string): void => {
    push({ type: "event", payload: { type: "agent_start" }, sessionId });
    push({
      type: "event",
      payload: {
        type: "message_end",
        message: { role: "assistant", content: [], stopReason: stopReason ?? "turnEnd" },
      },
      sessionId,
    });
    push({ type: "event", payload: { type: "agent_end" }, sessionId });
  };
  return { plays, push, run };
}

describe("createSessionSoundTriggers", () => {
  it("正常 run 结束播 completed", () => {
    const { plays, run } = harness();
    run();
    expect(plays).toEqual([{ scenario: "completed", sessionId: "sess_a", reason: undefined }]);
  });

  it("未见过 agent_start 的 agent_end 不响（切历史 / 渲染层重载）", () => {
    const { plays, push } = harness();
    push({
      type: "event",
      payload: {
        type: "message_end",
        message: { role: "assistant", content: [], stopReason: "turnEnd" },
      },
    });
    push({ type: "event", payload: { type: "agent_end" } });
    expect(plays).toEqual([]);
  });

  it("未运行实例的 stderr 推送不响，且不吞掉后续真实失败音", () => {
    const { plays, push } = harness();
    // 预热/空闲实例的 stderr 噪音
    push({ type: "error", payload: "some warning" });
    expect(plays).toEqual([]);
    // 同一会话随后真实 run 失败，仍要响
    push({
      type: "event",
      payload: {
        type: "message_end",
        message: { role: "assistant", content: [], stopReason: "error" },
      },
    });
    push({ type: "event", payload: { type: "agent_start" } });
    push({ type: "error", payload: "boom" });
    push({ type: "event", payload: { type: "agent_end" } });
    expect(plays).toEqual([{ scenario: "failed", sessionId: "sess_a", reason: "boom" }]);
  });

  it("运行中 stderr 与 agent_end(error) 同 run 只响一次 failed", () => {
    const { plays, push } = harness();
    push({ type: "event", payload: { type: "agent_start" } });
    push({ type: "error", payload: "boom" });
    push({
      type: "event",
      payload: {
        type: "message_end",
        message: { role: "assistant", content: [], stopReason: "error" },
      },
    });
    push({ type: "event", payload: { type: "agent_end" } });
    expect(plays.filter((p) => p.scenario === "failed")).toHaveLength(1);
  });

  it("willRetry 的 agent_end 不收口，重试耗尽后 agent_end(error) 播 failed", () => {
    const { plays, push } = harness();
    push({ type: "event", payload: { type: "agent_start" } });
    push({
      type: "event",
      payload: { type: "agent_end", willRetry: true },
    });
    expect(plays).toEqual([]);
    push({
      type: "event",
      payload: {
        type: "message_end",
        message: { role: "assistant", content: [], stopReason: "error" },
      },
    });
    push({ type: "event", payload: { type: "agent_end" } });
    expect(plays).toEqual([{ scenario: "failed", sessionId: "sess_a", reason: "agent error" }]);
  });

  it("auto_retry_end(success=false) 不再直接发声：耗尽后由终态 agent_end(error) 播一次 failed", () => {
    const { plays, push } = harness();
    push({ type: "event", payload: { type: "agent_start" } });
    push({
      type: "event",
      payload: {
        type: "message_end",
        message: { role: "assistant", content: [], stopReason: "error" },
      },
    });
    push({ type: "event", payload: { type: "agent_end", willRetry: true } });
    push({ type: "event", payload: { type: "agent_start" } });
    push({
      type: "event",
      payload: {
        type: "message_end",
        message: { role: "assistant", content: [], stopReason: "error" },
      },
    });
    push({ type: "event", payload: { type: "agent_end" } });
    expect(plays).toEqual([{ scenario: "failed", sessionId: "sess_a", reason: "agent error" }]);
    // 耗尽的 auto_retry_end 在其后到达，不能再补一声；settled 也已收口
    push({ type: "event", payload: { type: "auto_retry_end", success: false, finalError: "x" } });
    push({ type: "event", payload: { type: "agent_settled", aborted: false } });
    expect(plays).toHaveLength(1);
  });

  it("不在途的 auto_retry_end 不响", () => {
    const { plays, push } = harness();
    push({ type: "event", payload: { type: "auto_retry_end", success: false, finalError: "x" } });
    expect(plays).toEqual([]);
  });

  it("重试退避期被中断：播 interrupted，不播 failed", () => {
    const { plays, push } = harness();
    push({ type: "event", payload: { type: "agent_start" } });
    push({
      type: "event",
      payload: {
        type: "message_end",
        message: { role: "assistant", content: [], stopReason: "error" },
      },
    });
    push({ type: "event", payload: { type: "agent_end", willRetry: true } });
    push({
      type: "event",
      payload: { type: "auto_retry_end", success: false, finalError: "Retry cancelled" },
    });
    expect(plays.filter((p) => p.scenario === "failed")).toHaveLength(0);
    push({ type: "event", payload: { type: "agent_settled", aborted: true } });
    expect(plays.map((p) => p.scenario)).toEqual(["interrupted"]);
  });

  it("abort 播 interrupted、length 播 needsAttention", () => {
    const { plays, run } = harness();
    run("aborted");
    run("length");
    expect(plays.map((p) => p.scenario)).toEqual(["interrupted", "needsAttention"]);
  });

  it("运行中进程 exit 播 needsAttention；空闲实例 exit 不响", () => {
    const { plays, push, run } = harness();
    push({ type: "exit", payload: 0 });
    expect(plays).toEqual([]);
    run();
    push({ type: "exit", payload: 1 });
    expect(plays).toEqual([{ scenario: "completed", sessionId: "sess_a", reason: undefined }]);
  });

  it("eventBatch 与单条 event 同口径", () => {
    const { plays, push } = harness();
    push({
      type: "eventBatch",
      payload: [
        { type: "agent_start" },
        { type: "message_end", message: { role: "assistant", content: [], stopReason: "turnEnd" } },
        { type: "agent_end" },
      ],
    } as unknown as { type: "eventBatch"; payload: never[] });
    expect(plays.map((p) => p.scenario)).toEqual(["completed"]);
  });
});
