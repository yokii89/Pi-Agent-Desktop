import { useEffect, useRef } from "react";
import type { SessionPushMessage } from "../../shared/ipc";
import type { NotificationScenarioId } from "../../shared/notification";
import { extensionViewService } from "../services/extensionViewService";
import { notificationService } from "../services/notificationService";
import { pideskApi } from "../services/pideskApi";
import { sessionService } from "../services/sessionService";
import { settingsService } from "../services/settingsService";
import { useSessionMeta } from "../stores/sessionStore";
import { sessionTitle } from "../utils/sessionTitle";

type PiEvent = Extract<SessionPushMessage, { type: "event" }>["payload"];

function play(
  scenario: NotificationScenarioId,
  sessionId: string | undefined,
  reason?: string,
  source: "session" | "terminal" | "extension" = "session",
): void {
  notificationService.play({ scenario, sessionId, reason, source });
}

/**
 * 订阅会话事件流，把 agent 终态映射为提示音场景（docs/design/18）。
 * 独立于 sessionStore：不改会话桶状态，只旁路听事件。
 *
 * 失败音去重：auto_retry_end(success=false) 与随后的 agent_end(error)
 * 会连着到达，同一 run 只响一次 failed。
 */
function bindSessionTriggers(): () => void {
  const stopReasons = new Map<string, string | undefined>();
  const running = new Set<string>();
  /** 本 run 已播过 failed 的会话，避免重试耗尽 + agent_end 双响。 */
  const failedPlayed = new Set<string>();

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
      if (event.success === false && !failedPlayed.has(sessionId)) {
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
      running.delete(sessionId);
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

  return sessionService.subscribe((message: SessionPushMessage) => {
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
      if (!failedPlayed.has(sessionId)) {
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
  });
}

/**
 * 应用内挂载：设置同步 + 会话/终端/扩展 View 提示音与桌面 toast 触发。
 * 在 SessionProvider 内使用（依赖 useSessionMeta.activeSessionId 等）。
 */
export function useNotificationSounds(): void {
  const {
    activeSessionId,
    allSessions,
    sessionTitles,
    getSessionFileById,
    openSessionFile,
    firstUserText,
  } = useSessionMeta();

  const metaRef = useRef({
    activeSessionId,
    allSessions,
    sessionTitles,
    getSessionFileById,
    openSessionFile,
    firstUserText,
  });
  metaRef.current = {
    activeSessionId,
    allSessions,
    sessionTitles,
    getSessionFileById,
    openSessionFile,
    firstUserText,
  };

  useEffect(() => {
    void notificationService.init();
  }, []);

  useEffect(() => {
    notificationService.setActiveSessionResolver(() => activeSessionId);
  }, [activeSessionId]);

  // toast 文案与回跳：读 ref 避免会话列表刷新时反复重绑
  useEffect(() => {
    notificationService.setToastSessionResolver((sessionId) => {
      const {
        allSessions: sessions,
        sessionTitles: titles,
        getSessionFileById: byId,
        activeSessionId: activeId,
        firstUserText: activeFirstUser,
      } = metaRef.current;
      const file = (sessionId ? byId(sessionId) : null) ?? undefined;
      const summary = file ? sessions.find((s) => s.file === file) : undefined;
      const custom = file ? titles[file] : undefined;
      // 历史列表尚未刷到该文件时，active 桶的首条用户消息可作标题兜底
      const activeFallback =
        sessionId && sessionId === activeId ? activeFirstUser?.trim() || undefined : undefined;
      const name = summary ? sessionTitle(summary, custom) : custom?.trim() || activeFallback;
      return { sessionTitle: name, sessionFile: file };
    });
    return () => notificationService.setToastSessionResolver(null);
  }, []);

  useEffect(() => {
    const api = pideskApi();
    if (!api?.notification?.onActivated) return;
    return api.notification.onActivated((payload) => {
      const { getSessionFileById: byId, openSessionFile: open } = metaRef.current;
      const file = payload.sessionFile ?? (payload.sessionId ? byId(payload.sessionId) : null);
      if (file) void open(file);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void settingsService.get().then((settings) => {
      if (!cancelled) notificationService.applySettings(settings?.notification);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubSession = bindSessionTriggers();

    const unsubView = extensionViewService.subscribe((message) => {
      if (message.type !== "open") return;
      if (message.placement !== "modal" && message.placement !== "widget") return;
      if (!Array.isArray(message.actions) || message.actions.length === 0) return;
      play(
        "needsAttention",
        message.sessionId,
        message.title || "extension confirmation",
        "extension",
      );
    });

    const api = pideskApi();
    const unsubTerminal = api?.terminal?.onOutput
      ? api.terminal.onOutput((msg) => {
          if (msg.type !== "exit") return;
          notificationService.play({
            scenario: "terminalExit",
            reason: `terminal ${msg.id} exit ${msg.payload}`,
            source: "terminal",
          });
        })
      : undefined;

    return () => {
      unsubSession();
      unsubView();
      unsubTerminal?.();
    };
  }, []);
}
