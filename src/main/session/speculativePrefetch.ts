/**
 * Speculative 会话预热（docs/design/16 Phase G / §8.2–8.3）。
 * 默认关闭；仅用空余额度；显式 send/view-action 永远优先且可晋升实例。
 */

import type { PrefetchMetrics, PrefetchNotifyRequest, SessionId } from "../../shared/contribution";
import { getSettings } from "../settings/settings";
import { hasSession, listLiveSessions } from "./piSession";
import { normalizePrefetchIntent, prefetchDwellMs, requiresIdleSystem } from "./prefetchPolicy";
import {
  ensureSessionReady,
  listRuntimeSnapshots,
  prefetchStats,
  reclaimSpeculativeSessions,
  reclaimStaleSpeculativeSessions,
  recordReadyLatency,
} from "./runtimeCoordinator";
import { isSpeculativeCreatedBy } from "./speculativeReclaim";

let stableTimer: ReturnType<typeof setTimeout> | null = null;
let lastHint: PrefetchNotifyRequest | null = null;

function clearStableTimer(): void {
  if (stableTimer) {
    clearTimeout(stableTimer);
    stableTimer = null;
  }
}

/** 是否仍有空余额度给 speculative（始终为显式启动预留 1 个名额）。 */
export function hasSpareQuotaForPrefetch(): boolean {
  const max = Math.max(1, Math.floor(getSettings().maxParallelSessions || 8));
  const live = listLiveSessions().length;
  return live <= max - 2;
}

/** 系统是否适合预热：无 busy agent（粗粒度「非高负载」代理）。 */
export function isSystemIdleForPrefetch(): boolean {
  return listRuntimeSnapshots(true).every((r) => r.state !== "busy" && r.state !== "starting");
}

async function tryPrefetch(hint: PrefetchNotifyRequest): Promise<void> {
  if (!getSettings().sessionPrefetchEnabled) return;
  // 至少要能定位到会话（file 或 sessionId）
  if (!hint.sessionFile && !hint.sessionId) return;
  if (hint.sessionId && hasSession(hint.sessionId)) return;

  // 先回收无用 speculative，腾出额度
  reclaimSpeculativeSessions();

  if (!hasSpareQuotaForPrefetch()) {
    prefetchStats.skippedLimit += 1;
    return;
  }
  // 弱信号要求系统空闲；用户明确打开时豁免（docs/design/44 A1）
  if (requiresIdleSystem(hint.intent) && !isSystemIdleForPrefetch()) return;

  prefetchStats.attempts += 1;
  try {
    await ensureSessionReady({
      sessionId: hint.sessionId,
      sessionFile: hint.sessionFile ?? undefined,
      cwd: hint.cwd ?? undefined,
      // 无 sessionFile = 待用新会话预热（docs/design/44 A2）：未晋升前对渲染层不可见
      reason: hint.sessionFile ? "speculative-prefetch" : "new-chat-prefetch",
    });
    // 开关可能在 ready 等待期间关闭；新产生的 speculative 也必须回收。
    if (!getSettings().sessionPrefetchEnabled || lastHint !== hint) reclaimSpeculativeSessions();
  } catch {
    // 预热失败静默；不得影响 UI
  }
}

/**
 * 渲染层在 active 会话切换 / 打开历史时通知。
 * 仅当开关打开时排程稳定停留后的 prefetch。
 */
export function notifyActiveSessionForPrefetch(req: PrefetchNotifyRequest): void {
  const hint: PrefetchNotifyRequest = { ...req, intent: normalizePrefetchIntent(req.intent) };
  lastHint = hint;
  clearStableTimer();
  // A3：hint 一变即定向清理不匹配的预热实例（含顶掉在途 starting），用户已离开的不再空转
  reclaimStaleSpeculativeSessions({ sessionId: hint.sessionId, sessionFile: hint.sessionFile });
  if (!getSettings().sessionPrefetchEnabled) return;
  stableTimer = setTimeout(() => {
    stableTimer = null;
    void tryPrefetch(hint);
  }, prefetchDwellMs(hint.intent));
  stableTimer.unref?.();
}

/** 设置开关变化时清理排程。 */
export function onPrefetchSettingChanged(enabled: boolean): void {
  if (!enabled) {
    clearStableTimer();
    // 关闭开关：回收仍为 speculative 的无用实例，行为退回 P0
    reclaimSpeculativeSessions();
  } else if (lastHint) {
    notifyActiveSessionForPrefetch(lastHint);
  }
}

export function getPrefetchMetrics(): PrefetchMetrics {
  const snapshots = listRuntimeSnapshots(true);
  const samples = [...prefetchStats.readySamples];
  const sendSamples = [...prefetchStats.sendSamples];
  const percentile = (values: number[], p: number): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx] ?? null;
  };
  return {
    enabled: getSettings().sessionPrefetchEnabled === true,
    viewActionReadyMs: samples,
    p50ReadyMs: percentile(samples, 50),
    p95ReadyMs: percentile(samples, 95),
    sendReadyMs: sendSamples,
    p50SendReadyMs: percentile(sendSamples, 50),
    p95SendReadyMs: percentile(sendSamples, 95),
    prefetchAttempts: prefetchStats.attempts,
    prefetchSkippedLimit: prefetchStats.skippedLimit,
    speculativeReclaimed: prefetchStats.reclaimed,
    speculativeAlive: snapshots.filter((r) => isSpeculativeCreatedBy(r.createdBy)).length,
    prefetchHits: prefetchStats.hits,
    prefetchMisses: prefetchStats.misses,
  };
}

export function __resetPrefetchForTests(): void {
  clearStableTimer();
  lastHint = null;
  prefetchStats.attempts = 0;
  prefetchStats.skippedLimit = 0;
  prefetchStats.reclaimed = 0;
  prefetchStats.readySamples.length = 0;
  prefetchStats.sendSamples.length = 0;
  prefetchStats.hits = 0;
  prefetchStats.misses = 0;
}

export type { SessionId };
export { recordReadyLatency };
