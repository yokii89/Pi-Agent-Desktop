import type { ManagedSkillsIntent } from "../../shared/managedSkillCommand";

let pending: ManagedSkillsIntent | null = null;
const listeners = new Set<() => void>();

/** One-shot navigation intent survives mounting the Extensions page; no persistent UI state. */
export const managedSkillsNavigation = {
  get: () => pending,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  open(intent: ManagedSkillsIntent): void {
    pending = intent;
    for (const listener of listeners) listener();
  },
  consume(intent: ManagedSkillsIntent): void {
    if (pending !== intent) return;
    pending = null;
    for (const listener of listeners) listener();
  },
};
