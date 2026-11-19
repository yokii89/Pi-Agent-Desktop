import type { SessionPushMessage, SessionUiPush } from "../../shared/ipc";

const listeners = new Set<(message: SessionPushMessage) => void>();
const uiListeners = new Set<(message: SessionUiPush) => void>();
/** A shared event outlet for desktop rendering and authorized remote invalidation. */
export function subscribeSessionEvents(
  listener: (message: SessionPushMessage) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function publishSessionEvent(message: SessionPushMessage): void {
  for (const listener of listeners) {
    try {
      listener(message);
    } catch {
      /* A companion must not interrupt the desktop session. */
    }
  }
}

export function subscribeSessionUiEvents(listener: (message: SessionUiPush) => void): () => void {
  uiListeners.add(listener);
  return () => uiListeners.delete(listener);
}

export function publishSessionUiEvent(message: SessionUiPush): void {
  for (const listener of uiListeners) {
    try {
      listener(message);
    } catch {
      /* A companion must not interrupt the desktop session. */
    }
  }
}
