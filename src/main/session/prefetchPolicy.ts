/**
 * 预热触发策略（docs/design/44 A1）：纯函数，供 speculativePrefetch 与单测共用。
 */

import {
  PREFETCH_OPEN_DWELL_MS,
  PREFETCH_STABLE_MS,
  type PrefetchNotifyRequest,
} from "../../shared/contribution";

export type PrefetchIntent = NonNullable<PrefetchNotifyRequest["intent"]>;

/** 缺省与非法值一律归一为弱信号 `idle`。 */
export function normalizePrefetchIntent(intent: PrefetchNotifyRequest["intent"]): PrefetchIntent {
  return intent === "open" ? "open" : "idle";
}

/** 意图 → 触发延迟：明确打开用短 dwell，弱信号维持稳定停留口径。 */
export function prefetchDwellMs(intent: PrefetchIntent | undefined): number {
  return intent === "open" ? PREFETCH_OPEN_DWELL_MS : PREFETCH_STABLE_MS;
}

/**
 * 弱信号仍要求系统空闲；用户明确打开时不因其它会话 busy/starting 而放弃——
 * "在 A 会话跑任务时切到 B"恰恰是最需要预热的场景（docs/design/44 复核 ②）。
 */
export function requiresIdleSystem(intent: PrefetchIntent | undefined): boolean {
  return intent !== "open";
}
