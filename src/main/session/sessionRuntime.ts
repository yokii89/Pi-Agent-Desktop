import type { SessionId, SessionStartRequest } from "../../shared/ipc";
import { agentRuntimeManager } from "../agentRuntime/agentRuntimeManager";
import { desktopSessions } from "../agentRuntime/desktopSessions";

/** Application lifecycle adapter. Stored identities are resolved only by DesktopSessions/repository. */
export const hasSession = (id: SessionId): boolean => desktopSessions.has(id);
export const listLiveSessions = (): SessionId[] => desktopSessions.list();
export const getSessionPid = (id: SessionId): number | null =>
  hasSession(id) ? agentRuntimeManager.pid() : null;
export const getSessionProcessToken = (id: SessionId): object | null => desktopSessions.token(id);
export const hasPendingSessionRequests = (id: SessionId): boolean => desktopSessions.pending(id);
export const startSession = (request: SessionStartRequest): Promise<string> =>
  desktopSessions.start(request);
export const disposeSession = (id: SessionId): Promise<void> => desktopSessions.close(id);
export const waitForSessionDisposal = (id: SessionId): Promise<void> => desktopSessions.close(id);
export const liveSessionIdForFile = (key: string): string | null => desktopSessions.liveId(key);
export const disposeIdle = (id: SessionId) => desktopSessions.closeIdle(id);

/** Busy remains latched until ownership-aware settled, even when pi.live.run has disappeared. */
export async function fetchSessionState(id: SessionId, _timeoutMs?: number) {
  const attachment = desktopSessions.require(id);
  const token = attachment;
  const epoch = attachment.epoch;
  await desktopSessions.command(id, { op: "snapshot", sessionId: attachment.storedId });
  const current = desktopSessions.require(id);
  const busy = current !== token || current.epoch !== epoch || desktopSessions.busy(id);
  return {
    isStreaming: busy,
    isCompacting: busy,
    isRetrying: busy,
    pendingMessageCount: busy ? 1 : 0,
  };
}
