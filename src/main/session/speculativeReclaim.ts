/**
 * speculative 实例是否可回收/可被顶掉（docs/design/16 §8.3、docs/design/44 A3）。
 * 纯函数，供 runtimeCoordinator 与单测共用。
 */

import type { SessionRuntimeState } from "../../shared/contribution";

/** 预热型 createdBy（docs/design/44：existing-session 预热与新会话预热同属可回收族）。 */
const SPECULATIVE_CREATED_BY: ReadonlySet<string> = new Set([
  "speculative-prefetch",
  "new-chat-prefetch",
]);

/** 是否为预热创建（含未晋升的新会话预热）。 */
export function isSpeculativeCreatedBy(createdBy: string | null): boolean {
  return createdBy !== null && SPECULATIVE_CREATED_BY.has(createdBy);
}

interface ReclaimInput {
  createdBy: string | null;
  usedByUser: boolean;
  state: SessionRuntimeState;
  hasActivationTxn: boolean;
  childAlive: boolean;
}

/** 常规回收：未被用户使用、非 busy、无激活事务、子进程存活，且已就绪。 */
export function canReclaimSpeculative(input: ReclaimInput): boolean {
  if (!isSpeculativeCreatedBy(input.createdBy)) return false;
  if (input.usedByUser) return false;
  if (input.hasActivationTxn) return false;
  if (!input.childAlive) return false;
  return input.state === "idle" || input.state === "ready";
}

/**
 * supersede（docs/design/44 A3）：被更新 hint 顶掉的在途实例允许终止。
 * 仅在 hint 变化路径使用；显式启动路径仍走 canReclaimSpeculative，不放宽既有语义。
 */
export function canSupersedeSpeculative(input: ReclaimInput): boolean {
  if (!isSpeculativeCreatedBy(input.createdBy)) return false;
  if (input.usedByUser) return false;
  if (input.hasActivationTxn) return false;
  if (!input.childAlive) return false;
  return input.state === "starting";
}
