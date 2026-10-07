/**
 * speculative 实例是否可回收（docs/design/16 §8.3）。
 * 纯函数，供 runtimeCoordinator 与单测共用。
 */

import type { SessionRuntimeState } from "../../shared/contribution";

export function canReclaimSpeculative(input: {
  createdBy: string | null;
  usedByUser: boolean;
  state: SessionRuntimeState;
  hasActivationTxn: boolean;
  childAlive: boolean;
}): boolean {
  if (input.createdBy !== "speculative-prefetch") return false;
  if (input.usedByUser) return false;
  if (input.hasActivationTxn) return false;
  if (!input.childAlive) return false;
  return input.state === "idle" || input.state === "ready";
}
