import type { SessionPushMessage } from "../../shared/ipc";
import type { NotificationScenarioId } from "../../shared/notification";
import { createSessionRunSignalTracker } from "./sessionRunSignals";

/** 场景播放回调；由 notificationService.play 承接。 */
export type SessionSoundPlay = (
  scenario: NotificationScenarioId,
  sessionId: string,
  reason?: string,
) => void;

/**
 * 会话推送 → 终态提示音场景（docs/design/18），供 useNotificationSounds 订阅。
 *
 * run 收口的判定（运行门禁 / 失败去重 / willRetry 续跑）统一在
 * `utils/sessionRunSignals`，输入栏伙伴的表情也吃同一份信号——这里只做
 * 「收口语义 → 提示音场景」的映射，不要再把状态机搬回来。
 */
export function createSessionSoundTriggers(
  play: SessionSoundPlay,
): (message: SessionPushMessage) => void {
  return createSessionRunSignalTracker((sessionId, signal) => {
    switch (signal.kind) {
      case "started":
        return;
      case "completed":
        play("completed", sessionId);
        return;
      case "failed":
        play("failed", sessionId, signal.reason);
        return;
      case "interrupted":
        play("interrupted", sessionId);
        return;
      case "truncated":
        play("needsAttention", sessionId, "output truncated");
        return;
      case "crashed":
        play("needsAttention", sessionId, signal.reason);
        return;
    }
  });
}
