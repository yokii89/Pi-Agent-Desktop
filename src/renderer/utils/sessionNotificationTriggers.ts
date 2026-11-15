import type { SessionPushMessage } from "../../shared/ipc";
import type { NotificationScenarioId } from "../../shared/notification";
import { createSessionRunSignalTracker, type SessionRunSignalHandler } from "./sessionRunSignals";

/** 场景投递回调；声音与桌面通知分别交给 notificationService.play。 */
type SessionNotificationEmit = (
  scenario: NotificationScenarioId,
  sessionId: string,
  reason?: string,
) => void;

function scenarioEmitter(play: SessionNotificationEmit): SessionRunSignalHandler {
  return (sessionId, signal) => {
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
  };
}

/**
 * 会话推送 → 声音与桌面通知。共用场景映射，分别跟踪各自的收口时机：
 * 声音保留 agent_end（docs/design/18），桌面通知只认 agent_settled（docs/design/24）。
 */
export function createSessionNotificationTriggers(sinks: {
  sound: SessionNotificationEmit;
  toast: SessionNotificationEmit;
}): (message: SessionPushMessage) => void {
  const sound = createSessionRunSignalTracker(scenarioEmitter(sinks.sound));
  const toast = createSessionRunSignalTracker(scenarioEmitter(sinks.toast), "agent_settled");
  return (message) => {
    sound(message);
    toast(message);
  };
}
