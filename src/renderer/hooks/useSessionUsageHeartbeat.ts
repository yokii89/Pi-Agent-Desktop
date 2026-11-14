import { useEffect } from "react";
import { SESSION_IDLE_ACTIVE_HEARTBEAT_MS } from "../../shared/sessionIdle";
import { runtimeService } from "../services/contributionService";
import { useSessionMeta } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";

/** 心跳间隔与主进程共用同一个真值（`shared/sessionIdle`）。 */
const HEARTBEAT_MS = SESSION_IDLE_ACTIVE_HEARTBEAT_MS;

/**
 * 会话使用心跳（docs/design/138）。
 *
 * 主进程的空闲回收只认「用户动作」：active 会话豁免回收，并且每在会话页停留一分钟
 * 就刷新一次使用时刻。这个 hook 就是那条信号源——
 *
 * - 隐藏时仍上报身份，但不续期任何会话；visibilitychange 立即通知主进程；
 * - 窗口失焦仍算在看（多显示器、对照阅读），只在最小化/隐藏时停；
 * - 上报失败不影响界面；主进程在心跳过期后暂停回收。
 *
 * 为什么是轮询而不是事件：主进程要知道的是「现在还在看」，一次性事件表达不了"持续"。
 */
export function useSessionUsageHeartbeat(): void {
  const { activeSessionId } = useSessionMeta();
  const { page } = useUiStore();
  const sessionPage = page === "session";

  useEffect(() => {
    let alive = true;

    const report = (): void => {
      if (!alive) return;
      void runtimeService
        .noteViewing({ sessionId: activeSessionId, sessionPage: sessionPage && !document.hidden })
        .catch(() => undefined);
    };
    report();
    const timer = setInterval(report, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", report);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", report);
    };
  }, [activeSessionId, sessionPage]);
}
