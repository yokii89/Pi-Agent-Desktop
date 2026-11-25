import type { SessionDisposeIdleResult, SessionId } from "../../shared/ipc";
import { hasSessionModal } from "../view/viewHost";
import { pendingUiCount } from "./extensionUi";
import { getRuntimeState, hasModeTransition } from "./runtimeCoordinator";
import {
  disposeIdle,
  fetchSessionState,
  getSessionProcessToken,
  hasPendingSessionRequests,
} from "./sessionRuntime";

const STATE_PROBE_TIMEOUT_MS = 5000;

function canClose(sessionId: SessionId): boolean {
  const state = getRuntimeState(sessionId);
  return (
    (state === "ready" || state === "idle") &&
    !hasModeTransition(sessionId) &&
    !hasPendingSessionRequests(sessionId) &&
    pendingUiCount(sessionId) === 0 &&
    !hasSessionModal(sessionId)
  );
}

/** 手动结束空闲 pi：核对 RPC 真值及同一进程身份，历史与后台项目进程保留。 */
export async function disposeIdleSession(sessionId: SessionId): Promise<SessionDisposeIdleResult> {
  const token = getSessionProcessToken(sessionId);
  if (!token) return "not-running";
  if (!canClose(sessionId)) return "busy";

  const state = await fetchSessionState(sessionId, STATE_PROBE_TIMEOUT_MS);
  const currentToken = getSessionProcessToken(sessionId);
  if (!currentToken) return "not-running";
  if (currentToken !== token || !canClose(sessionId)) return "busy";
  if (!state || typeof state !== "object" || Array.isArray(state)) return "busy";
  const value = state as Record<string, unknown>;
  if (
    value.isStreaming !== false ||
    value.isCompacting !== false ||
    value.pendingMessageCount !== 0 ||
    value.isRetrying === true
  ) {
    return "busy";
  }

  // 最后复核与关停间不让出事件循环；期间新 prompt 或模式事务不能插入。
  return disposeIdle(sessionId);
}
