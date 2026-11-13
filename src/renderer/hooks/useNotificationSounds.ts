import { useEffect, useRef } from "react";
import type { NotificationScenarioId } from "../../shared/notification";
import { extensionViewService } from "../services/extensionViewService";
import { notificationService } from "../services/notificationService";
import { pideskApi } from "../services/pideskApi";
import { sessionService } from "../services/sessionService";
import { settingsService } from "../services/settingsService";
import { useSessionMeta } from "../stores/sessionStore";
import { createSessionSoundTriggers } from "../utils/sessionSoundTriggers";
import { toastSessionTitle } from "../utils/toastTitle";

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
 * 状态机（运行门禁 / 失败去重）在 utils/sessionSoundTriggers，这里只旁路接线。
 */
function bindSessionTriggers(): () => void {
  return sessionService.subscribe(
    createSessionSoundTriggers((scenario, sessionId, reason) => play(scenario, sessionId, reason)),
  );
}

/**
 * 应用内挂载：设置同步 + 会话/终端/扩展 View 提示音与桌面 toast 触发。
 * 在 SessionProvider 内使用（依赖 useSessionMeta.activeSessionId 等）。
 */
export function useNotificationSounds(): void {
  const {
    activeSessionId,
    allSessions,
    getSessionFileById,
    openSessionFile,
    firstUserText,
    readLastUserText,
  } = useSessionMeta();

  const metaRef = useRef({
    activeSessionId,
    allSessions,
    getSessionFileById,
    openSessionFile,
    firstUserText,
    readLastUserText,
  });
  metaRef.current = {
    activeSessionId,
    allSessions,
    getSessionFileById,
    openSessionFile,
    firstUserText,
    readLastUserText,
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
        getSessionFileById: byId,
        activeSessionId: activeId,
        firstUserText: activeFirstUser,
        readLastUserText: readLastUser,
      } = metaRef.current;
      const file = (sessionId ? byId(sessionId) : null) ?? undefined;
      const summary = file ? sessions.find((s) => s.file === file) : undefined;
      // 后台会话 / 冷桶尚无条目的极端情况下，active 桶的首条消息可当兜底
      const activeFirst = sessionId && sessionId === activeId ? activeFirstUser : undefined;
      const name = toastSessionTitle({
        lastUserText: readLastUser(sessionId ?? null),
        sessionName: summary?.sessionName,
        firstUserMessage: summary?.firstUserMessage ?? activeFirst,
      });
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
