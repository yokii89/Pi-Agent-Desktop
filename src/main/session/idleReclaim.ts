/** 后台会话空闲回收：任何保护证据缺失时保留进程（docs/design/138）。 */
import { powerMonitor } from "electron";
import type { RuntimeViewingRequest, SessionId } from "../../shared/contribution";
import {
  SESSION_IDLE_SCAN_INTERVAL_MS,
  SESSION_IDLE_VIEWING_TTL_MS,
  sessionIdleReclaimThresholdMs,
} from "../../shared/sessionIdle";
import { decideIdleReclaim } from "../../shared/sessionIdleReclaimDecision";
import { getSettings } from "../settings/settings";
import { hasSessionModal } from "../view/viewHost";
import { hasLiveBackgroundJobs } from "./backgroundJobs";
import { pendingUiCount } from "./extensionUi";
import {
  disposeSession,
  fetchSessionState,
  getSessionProcessToken,
  hasPendingSessionRequests,
  hasSession,
  waitForSessionDisposal,
} from "./piSession";
import {
  deferRuntimeIdleReclaim,
  getWatchedSession,
  listIdleReclaimCandidates,
  noteRuntimeTouched,
  noteWatchedSession,
} from "./runtimeCoordinator";

const MAX_RECLAIMS_PER_SCAN = 2;
const STATE_PROBE_TIMEOUT_MS = 5000;
type ScheduledOccupancy = (sessionId: SessionId) => boolean;
let isScheduled: ScheduledOccupancy = () => false;
let scanTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let scanning: Promise<ScanResult> | null = null;
let viewingAt: number | null = null;
let lastScanAt: number | null = null;
let graceStartedAt: number | null = null;
let suspended = false;
// dispose / suspend / resume 使已开始的异步核对失效，旧扫描不得在恢复后继续关闭进程。
let epoch = 0;
const stats = { reclaimed: 0, lastScanAt: null as number | null };

export interface IdleReclaimStats {
  reclaimed: number;
  lastScanAt: number | null;
  thresholdMinutes: number;
}

/** 注入调度器占用查询；旧解绑函数不能移除后装的查询。 */
export function setScheduledOccupancy(fn: ScheduledOccupancy): () => void {
  isScheduled = fn;
  return () => {
    if (isScheduled === fn) isScheduled = () => false;
  };
}

/** 内存诊断快照，不参与用户界面。 */
export function getIdleReclaimStats(): IdleReclaimStats {
  return { ...stats, thresholdMinutes: getSettings().sessionIdleReclaimMinutes };
}

/** 只接受完整上报；坏消息不得清掉原有 active 保护。离开时重新计时。 */
export function noteViewingSession(req?: RuntimeViewingRequest): void {
  if (
    !req ||
    typeof req.sessionPage !== "boolean" ||
    !(req.sessionId === null || (typeof req.sessionId === "string" && req.sessionId.length > 0))
  )
    return;
  const watching = req.sessionPage ? req.sessionId : null;
  if (viewingAt !== null && Date.now() - viewingAt > SESSION_IDLE_VIEWING_TTL_MS) {
    graceStartedAt = Date.now();
  }
  const previous = getWatchedSession();
  if (previous && previous !== watching) noteRuntimeTouched(previous);
  noteWatchedSession(watching);
  viewingAt = Date.now();
  if (watching) noteRuntimeTouched(watching);
}

export interface ScanResult {
  reclaimed: SessionId[];
  /** 候选核对未通过或证据未知，均保留进程。 */
  unsure: SessionId[];
}

function threshold(): number {
  return sessionIdleReclaimThresholdMs(getSettings().sessionIdleReclaimMinutes);
}

function canScan(now: number, scanEpoch: number): boolean {
  const limit = threshold();
  return (
    epoch === scanEpoch &&
    !suspended &&
    limit > 0 &&
    viewingAt !== null &&
    now >= viewingAt &&
    now - viewingAt <= SESSION_IDLE_VIEWING_TTL_MS &&
    (graceStartedAt === null || (now >= graceStartedAt && now - graceStartedAt >= limit))
  );
}

function stillIdle(sessionId: SessionId, now: number): boolean {
  const candidate = listIdleReclaimCandidates().find((item) => item.sessionId === sessionId);
  if (!candidate) return false;
  const verdict = decideIdleReclaim(
    {
      ...candidate,
      childAlive: hasSession(sessionId),
      hasPendingRequests: hasPendingSessionRequests(sessionId),
      pendingUiCount: pendingUiCount(sessionId) + (hasSessionModal(sessionId) ? 1 : 0),
      isActive: getWatchedSession() === sessionId,
      isScheduled: isScheduled(sessionId),
      // 后台作业由后续异步快照独立核对，本函数只读同步保护条件。
      hasBackgroundJobs: false,
    },
    now,
    threshold(),
  );
  if (!verdict.reclaim && verdict.reason !== "not-idle-enough") deferRuntimeIdleReclaim(sessionId);
  return verdict.reclaim;
}

/** 不从缺失字段推断空闲，兼容不了的旧协议保留实例。 */
function confirmsIdle(state: unknown): boolean {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const value = state as Record<string, unknown>;
  return (
    value.isStreaming === false &&
    value.isCompacting === false &&
    value.pendingMessageCount === 0 &&
    value.isRetrying !== true
  );
}

/** 同一时刻只有一轮扫描，恢复事件与周期扫描合流。 */
export function scanIdleSessions(now = Date.now()): Promise<ScanResult> {
  if (scanning) return scanning;
  const run = scan(now, epoch);
  scanning = run;
  void run
    .finally(() => {
      if (scanning === run) scanning = null;
    })
    .catch(() => undefined);
  return run;
}

async function scan(now: number, scanEpoch: number): Promise<ScanResult> {
  const result: ScanResult = { reclaimed: [], unsure: [] };
  // 时钟回拨、跳跃或定时器长时间停摆后重新等满阈值，不把睡眠算成连续空闲。
  if (
    lastScanAt !== null &&
    (now < lastScanAt || now - lastScanAt > SESSION_IDLE_SCAN_INTERVAL_MS * 2)
  ) {
    graceStartedAt = now;
  }
  lastScanAt = now;
  stats.lastScanAt = now;
  if (!canScan(now, scanEpoch)) return result;

  for (const { sessionId } of listIdleReclaimCandidates()) {
    if (result.reclaimed.length >= MAX_RECLAIMS_PER_SCAN || !canScan(Date.now(), scanEpoch)) break;
    if (!stillIdle(sessionId, now)) continue;
    const processToken = getSessionProcessToken(sessionId);
    if (!processToken) continue;
    try {
      if (await hasLiveBackgroundJobs(sessionId)) {
        deferRuntimeIdleReclaim(sessionId);
        result.unsure.push(sessionId);
        continue;
      }
      // 枚举可能很慢，探针之前先复核；await 之后必须再复核同一进程及所有本地保护。
      if (
        !canScan(Date.now(), scanEpoch) ||
        !stillIdle(sessionId, Date.now()) ||
        getSessionProcessToken(sessionId) !== processToken
      ) {
        result.unsure.push(sessionId);
        continue;
      }
      const state = await fetchSessionState(sessionId, STATE_PROBE_TIMEOUT_MS);
      if (!confirmsIdle(state)) {
        deferRuntimeIdleReclaim(sessionId);
        result.unsure.push(sessionId);
        continue;
      }
      if (
        !canScan(Date.now(), scanEpoch) ||
        getSessionProcessToken(sessionId) !== processToken ||
        !stillIdle(sessionId, Date.now())
      ) {
        result.unsure.push(sessionId);
        continue;
      }
      // 最后一次同步核对与 dispose 之间没有 await，不能插入新的 IPC / stdout 事件。
      disposeSession(sessionId);
      result.reclaimed.push(sessionId);
      stats.reclaimed += 1;
    } catch {
      deferRuntimeIdleReclaim(sessionId);
      result.unsure.push(sessionId);
    }
  }
  await Promise.all(
    result.reclaimed.map((id) => waitForSessionDisposal(id).catch(() => undefined)),
  );
  return result;
}

/** 初始化周期扫描与电源事件（幂等）。 */
export function initIdleReclaim(): void {
  if (initialized) return;
  initialized = true;
  void scanIdleSessions().catch(() => undefined);
  scanTimer = setInterval(
    () => void scanIdleSessions().catch(() => undefined),
    SESSION_IDLE_SCAN_INTERVAL_MS,
  );
  scanTimer.unref?.();
  powerMonitor.on("suspend", handleSuspend);
  powerMonitor.on("resume", handleResume);
}

/** 结束后，尚未返回的探测也失去回收权限。 */
export function disposeIdleReclaim(): void {
  epoch += 1;
  initialized = false;
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
  powerMonitor.off("suspend", handleSuspend);
  powerMonitor.off("resume", handleResume);
}

function handleSuspend(): void {
  suspended = true;
  epoch += 1;
}

function handleResume(): void {
  suspended = false;
  epoch += 1;
  graceStartedAt = Date.now();
  lastScanAt = graceStartedAt;
  viewingAt = null;
}

/** 测试隔离：停止定时器并使所有旧扫描失效。 */
export function __resetIdleReclaimForTests(): void {
  disposeIdleReclaim();
  stats.reclaimed = 0;
  stats.lastScanAt = null;
  lastScanAt = null;
  viewingAt = null;
  graceStartedAt = null;
  suspended = false;
  scanning = null;
  isScheduled = () => false;
}
