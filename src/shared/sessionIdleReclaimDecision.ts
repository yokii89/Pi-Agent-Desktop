/**
 * 空闲回收判定（docs/design/138）：纯函数，供 idleReclaim 与单测共用。
 *
 * 只放行「用户态、非 active、非 busy、无在途事务」的后台会话：
 * - busy / starting 正在跑任务，杀掉等于中断用户工作；
 * - 有激活事务（模式切换、prompt 屏障）在途，杀掉会让渲染层等的应答永远不来；
 * - 有未答扩展对话框，杀掉会留下一个用户点了没反应的死界面；
 * - 定时任务正占着该会话，杀掉后下一轮要重付 ~5.5s 冷启动（docs/design/44）；
 * - **还有存活的后台进程**（docs/design/138 §3.4）：长任务跑在后台时 turn 已经交还，
 *   会话的 runtime 状态就是 idle，看上去"停了 8 小时"实际上仍在等命令回执
 *   （15h 下载 / 转码 / dev server，docs/design/129/133）。
 */

import type { SessionRuntimeState } from "./contribution";

export interface IdleReclaimInput {
  sessionId: string;
  /** `lastActivityAt ?? startedAt`；两者都缺失返回 null（无从判定，不回收）。 */
  lastActivityAt: number | null;
  state: SessionRuntimeState;
  /** 子进程是否存活（不存活无需回收，状态归一即可）。 */
  childAlive: boolean;
  /** 有激活事务在途（包含 prompt 屏障）。 */
  hasActivationTxn: boolean;
  /** RPC 已发出但尚未应答，不能用 runtime 的 idle 推断请求已结束。 */
  hasPendingRequests: boolean;
  /** 等待用户作答的扩展对话框数量。 */
  pendingUiCount: number;
  /** 渲染层当前正在查看的会话（active 永不按空闲回收）。 */
  isActive: boolean;
  /** 定时任务正在使用该会话。 */
  isScheduled: boolean;
  /** 该会话登记表里还有存活的后台进程（服务或长任务）。 */
  hasBackgroundJobs: boolean;
}

export interface IdleReclaimDecision {
  reclaim: boolean;
  /** 不回收的原因（诊断 / 单测断言用，不对外展示）。 */
  reason:
    | "reclaim"
    | "disabled"
    | "no-activity"
    | "not-idle"
    | "child-dead"
    | "activation-txn"
    | "pending-rpc"
    | "pending-ui"
    | "scheduled"
    | "background-jobs"
    | "active-view"
    | "not-idle-enough";
}

/**
 * 判定单个会话是否可回收。
 * @param thresholdMs 空闲阈值（0 = 关闭）；now 由调用方给，便于单测注入。
 */
export function decideIdleReclaim(
  input: IdleReclaimInput,
  now: number,
  thresholdMs: number,
): IdleReclaimDecision {
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0)
    return { reclaim: false, reason: "disabled" };
  if (!input.childAlive) return { reclaim: false, reason: "child-dead" };
  if (input.isActive) return { reclaim: false, reason: "active-view" };
  if (input.isScheduled) return { reclaim: false, reason: "scheduled" };
  if (input.hasBackgroundJobs) return { reclaim: false, reason: "background-jobs" };
  if (input.hasActivationTxn) return { reclaim: false, reason: "activation-txn" };
  if (input.hasPendingRequests) return { reclaim: false, reason: "pending-rpc" };
  if (input.pendingUiCount > 0) return { reclaim: false, reason: "pending-ui" };
  // ready 是探针还没推进到 idle 的短暂态，与 idle 同属"没人用"
  if (input.state !== "idle" && input.state !== "ready") {
    return { reclaim: false, reason: "not-idle" };
  }
  if (
    input.lastActivityAt === null ||
    !Number.isFinite(input.lastActivityAt) ||
    !Number.isFinite(now)
  )
    return { reclaim: false, reason: "no-activity" };
  if (now - input.lastActivityAt < thresholdMs)
    return { reclaim: false, reason: "not-idle-enough" };
  return { reclaim: true, reason: "reclaim" };
}

/** 批量候选：保序返回可回收的 sessionId（调用方负责 dispose 与名额释放）。 */
export function pickIdleReclaimIds(
  inputs: readonly IdleReclaimInput[],
  now: number,
  thresholdMs: number,
): string[] {
  const out: string[] = [];
  for (const input of inputs) {
    if (decideIdleReclaim(input, now, thresholdMs).reclaim) out.push(input.sessionId);
  }
  return out;
}
