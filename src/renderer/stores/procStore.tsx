import type { ManagedProcess, SessionId } from "../../shared/ipc";
import { procService } from "../services/procService";

/** On-demand renderer snapshot used by session-end confirmation; lifecycle authority stays in main. */
type ProcState = ReadonlyMap<SessionId, readonly ManagedProcess[]>;
let state: ProcState = new Map();

export const procStore = {
  list(sessionId: SessionId | null | undefined): readonly ManagedProcess[] {
    if (!sessionId) return [];
    return state.get(sessionId) ?? [];
  },
  aliveCount(sessionId: SessionId | null | undefined): number {
    return procStore.list(sessionId).filter((proc) => proc.status === "alive").length;
  },
  /** Cache the result of an explicit main-process reconciliation. */
  applySession(sessionId: SessionId, processes: readonly ManagedProcess[]): void {
    const next = new Map(state);
    next.set(sessionId, processes);
    state = next;
  },
};

const refreshInFlight = new Map<SessionId, Promise<void>>();

/** Fetch a session's current process snapshot; concurrent callers share the same request. */
export function refreshSessionProcesses(sessionId: SessionId): Promise<void> {
  const inFlight = refreshInFlight.get(sessionId);
  if (inFlight) return inFlight;
  const task = Promise.resolve()
    .then(async () => {
      try {
        procStore.applySession(sessionId, await procService.list(sessionId));
      } catch {
        // Process enumeration is advisory for the confirmation dialog.
      }
    })
    .finally(() => {
      refreshInFlight.delete(sessionId);
    });
  refreshInFlight.set(sessionId, task);
  return task;
}
