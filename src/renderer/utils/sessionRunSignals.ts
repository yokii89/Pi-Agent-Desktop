import type { SessionPushMessage } from "../../shared/ipc";

/**
 * 一次 run 的收口语义。提示音与输入栏伙伴共用同一份判定（docs/design/18）：
 * 终态只对「亲眼见过 agent_start 的 run」成立——切换历史会话、预热实例与
 * 空闲存活实例也会产生 stderr 推送甚至 agent_end（渲染层重载后 running 清空），
 * 但它们没有在运行，不该被当成一次真实收口。
 *
 * 失败去重：auto_retry_end(success=false) 与随后的 agent_end(error) 会连着到达，
 * 同一 run 只发一次 failed。
 */
export type SessionRunSignal =
  | { kind: "started" }
  | { kind: "completed" }
  | { kind: "failed"; reason: string }
  | { kind: "interrupted" }
  | { kind: "truncated" }
  | { kind: "crashed"; reason: string };

export type SessionRunSignalHandler = (sessionId: string, signal: SessionRunSignal) => void;

export function createSessionRunSignalTracker(
  emit: SessionRunSignalHandler,
): (message: SessionPushMessage) => void {
  const stopReasons = new Map<string, string | undefined>();
  const running = new Set<string>();
  /** 本 run 已发过 failed 的会话，避免重试耗尽 + agent_end 双发。 */
  const failedEmitted = new Set<string>();

  type PiEvent = Extract<SessionPushMessage, { type: "event" }>["payload"];

  const handleEvent = (sessionId: string, event: PiEvent): void => {
    if (event.type === "agent_start") {
      running.add(sessionId);
      failedEmitted.delete(sessionId);
      emit(sessionId, { kind: "started" });
      return;
    }
    if (event.type === "message_end") {
      const msg = event.message;
      if (msg?.role === "assistant" && msg.stopReason) {
        stopReasons.set(sessionId, msg.stopReason);
      }
      return;
    }
    if (event.type === "auto_retry_end") {
      if (event.success === false && running.has(sessionId) && !failedEmitted.has(sessionId)) {
        failedEmitted.add(sessionId);
        emit(sessionId, { kind: "failed", reason: event.finalError ?? "auto retry failed" });
      }
      return;
    }
    if (event.type === "agent_end") {
      // willRetry：自动重试/压缩续跑尚未收口，不算终态
      if (event.willRetry === true) return;
      const reason = stopReasons.get(sessionId);
      stopReasons.delete(sessionId);
      const wasRunning = running.delete(sessionId);
      if (!wasRunning) return;
      if (reason === "error") {
        if (!failedEmitted.has(sessionId))
          emit(sessionId, { kind: "failed", reason: "agent error" });
        failedEmitted.delete(sessionId);
      } else if (reason === "aborted") {
        failedEmitted.delete(sessionId);
        emit(sessionId, { kind: "interrupted" });
      } else if (reason === "length") {
        failedEmitted.delete(sessionId);
        emit(sessionId, { kind: "truncated" });
      } else {
        failedEmitted.delete(sessionId);
        emit(sessionId, { kind: "completed" });
      }
      return;
    }
    if (event.type === "agent_settled") {
      // settled 为收口确认，终态以 agent_end 为准，避免双发
      running.delete(sessionId);
      stopReasons.delete(sessionId);
    }
  };

  return (message: SessionPushMessage): void => {
    const sessionId = message.sessionId;
    if (message.type === "event") {
      handleEvent(sessionId, message.payload);
      return;
    }
    if (message.type === "eventBatch") {
      for (const event of message.payload) handleEvent(sessionId, event);
      return;
    }
    if (message.type === "error") {
      // stderr 行/进程异常不区分失败与噪音，且预热、空闲实例也会写 stderr：
      // 只有 run 在途时才视为失败信号，否则静默（store 仍会记 processError 展示）。
      // 也不在此标记 failedEmitted：预热期的噪音不得吞掉后续首个真实失败。
      if (running.has(sessionId) && !failedEmitted.has(sessionId)) {
        failedEmitted.add(sessionId);
        emit(sessionId, { kind: "failed", reason: message.payload });
      }
      return;
    }
    if (message.type === "exit") {
      // 运行中进程消失 → 崩溃；idle 后手动结束不打扰
      if (running.has(sessionId) && !failedEmitted.has(sessionId)) {
        emit(sessionId, { kind: "crashed", reason: `process exit code=${message.payload}` });
      }
      running.delete(sessionId);
      stopReasons.delete(sessionId);
      failedEmitted.delete(sessionId);
    }
  };
}
