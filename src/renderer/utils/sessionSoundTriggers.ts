import type { SessionPushMessage } from "../../shared/ipc";
import type { NotificationScenarioId } from "../../shared/notification";

/** 场景播放回调；由 notificationService.play 承接。 */
export type SessionSoundPlay = (
  scenario: NotificationScenarioId,
  sessionId: string,
  reason?: string,
) => void;

/**
 * 会话推送 → 终态提示音场景的纯状态机（docs/design/18），供 useNotificationSounds 订阅。
 *
 * 终态音（completed/failed/interrupted/needsAttention）只对「亲眼见过 agent_start 的
 * run」播放：切换历史会话、预热实例（speculative-prefetch）与空闲存活实例也会产生
 * stderr 推送甚至 agent_end（渲染层重载后 running 清空），但它们没有在运行，不该响。
 * 渲染层重载后本状态机重建，后台在途 run 的收尾就此静音（store 仍会标未读兜底）。
 *
 * 失败音去重：auto_retry_end(success=false) 与随后的 agent_end(error) 会连着到达，
 * 同一 run 只响一次 failed。
 */
export function createSessionSoundTriggers(
  play: SessionSoundPlay,
): (message: SessionPushMessage) => void {
  const stopReasons = new Map<string, string | undefined>();
  const running = new Set<string>();
  /** 本 run 已播过 failed 的会话，避免重试耗尽 + agent_end 双响。 */
  const failedPlayed = new Set<string>();

  type PiEvent = Extract<SessionPushMessage, { type: "event" }>["payload"];

  const handleEvent = (sessionId: string, event: PiEvent): void => {
    if (event.type === "agent_start") {
      running.add(sessionId);
      failedPlayed.delete(sessionId);
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
      if (event.success === false && running.has(sessionId) && !failedPlayed.has(sessionId)) {
        failedPlayed.add(sessionId);
        play("failed", sessionId, event.finalError ?? "auto retry failed");
      }
      return;
    }
    if (event.type === "agent_end") {
      // willRetry：自动重试/压缩续跑尚未收口，不播终态音
      if (event.willRetry === true) return;
      const reason = stopReasons.get(sessionId);
      stopReasons.delete(sessionId);
      const wasRunning = running.delete(sessionId);
      if (!wasRunning) return;
      if (reason === "error") {
        if (!failedPlayed.has(sessionId)) play("failed", sessionId, "agent error");
        failedPlayed.delete(sessionId);
      } else if (reason === "aborted") {
        failedPlayed.delete(sessionId);
        play("interrupted", sessionId);
      } else if (reason === "length") {
        failedPlayed.delete(sessionId);
        play("needsAttention", sessionId, "output truncated");
      } else {
        failedPlayed.delete(sessionId);
        play("completed", sessionId);
      }
      return;
    }
    if (event.type === "agent_settled") {
      // settled 为收口确认，终态以 agent_end 为准，避免双响
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
      // 也不在此标记 failedPlayed：预热期的噪音不得吞掉后续首个真实失败音。
      if (running.has(sessionId) && !failedPlayed.has(sessionId)) {
        failedPlayed.add(sessionId);
        play("failed", sessionId, message.payload);
      }
      return;
    }
    if (message.type === "exit") {
      // 运行中进程消失 → 需要关注；idle 后手动结束不打扰
      if (running.has(sessionId) && !failedPlayed.has(sessionId)) {
        play("needsAttention", sessionId, `process exit code=${message.payload}`);
      }
      running.delete(sessionId);
      stopReasons.delete(sessionId);
      failedPlayed.delete(sessionId);
    }
  };
}
