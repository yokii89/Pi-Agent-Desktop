import { useSyncExternalStore } from "react";

export interface SessionToolReveal {
  sessionId: string;
  toolCallId: string;
  revision: number;
}

let current: SessionToolReveal | null = null;
let revision = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Request one explicit transcript navigation; newly mounted collapsed groups see the same request. */
export function revealSessionToolCall(sessionId: string, toolCallId: string): void {
  if (!sessionId || !toolCallId) return;
  current = { sessionId, toolCallId, revision: ++revision };
  for (const listener of listeners) listener();
}

/** Clear only the navigation that completed; a newer click must survive a late scroll callback. */
export function completeSessionToolReveal(expectedRevision: number): void {
  if (current?.revision !== expectedRevision) return;
  current = null;
  for (const listener of listeners) listener();
}

export function getSessionToolReveal(): SessionToolReveal | null {
  return current;
}

export function useSessionToolReveal(): SessionToolReveal | null {
  return useSyncExternalStore(subscribe, getSessionToolReveal, getSessionToolReveal);
}
