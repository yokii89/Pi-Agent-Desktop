/**
 * 会话进程空闲回收（docs/design/138）的常量与归一化。
 *
 * 为什么需要：用户态会话进程 `usedByUser = true` 之后没有任何自动退出路径
 * （唯一释放入口是侧栏「结束进程」/ 应用退出），而一个热 pi 进程 RSS ≈177MB
 * （docs/design/44 §1），并行上限默认 8 → 上限 ≈1.5GB。长时间挂着不用的会话
 * 应当按空闲时长自动释放。
 *
 * 口径是「无用户动作」而不是「无消息」：读历史、切回会话、作答扩展对话框
 * 都算使用，只有真的没人管才算空闲。
 */

/** 默认空闲回收阈值（分钟）：30 分钟没有用户动作就释放。 */
export const DEFAULT_SESSION_IDLE_RECLAIM_MINUTES = 30;

/** 可选阈值档位（分钟，0 = 关闭）。只允许这几种值，渲染层下拉与主进程校验共用。 */
export const SESSION_IDLE_RECLAIM_OPTIONS = [0, 15, 30, 60, 120] as const;

/** 扫描周期：阈值最小 15 分钟，分钟级粒度足够，不必为它单独挂 per-session 定时器。 */
export const SESSION_IDLE_SCAN_INTERVAL_MS = 60_000;

/** 会话窗口处于前台时，active 会话的「使用」心跳间隔（主进程据此认人还在看）。 */
export const SESSION_IDLE_ACTIVE_HEARTBEAT_MS = 60_000;

/** 心跳失联时无法确认用户当前看的会话，暂停整轮自动回收。 */
export const SESSION_IDLE_VIEWING_TTL_MS = SESSION_IDLE_ACTIVE_HEARTBEAT_MS * 3;

/** 阈值上限：两天。超过这个量级的配置跟「关闭」没有区别，直接拒绝。 */
const MAX_IDLE_MINUTES = 60 * 48;

/** 是否为登记的阈值档位（下拉与主进程校验共用，含 0 = 关闭）。 */
export function isSessionIdleReclaimOption(value: unknown): value is number {
  return (SESSION_IDLE_RECLAIM_OPTIONS as readonly number[]).includes(value as number);
}

/** 归一化空闲回收阈值：非法值回退默认，0 保留为「关闭」。 */
export function normalizeSessionIdleReclaimMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SESSION_IDLE_RECLAIM_MINUTES;
  }
  const minutes = Math.floor(value);
  if (minutes < 0) return DEFAULT_SESSION_IDLE_RECLAIM_MINUTES;
  return Math.min(minutes, MAX_IDLE_MINUTES);
}

/** 阈值 → 空闲毫秒；0（关闭）返回 0，调用方据此短路。 */
export function sessionIdleReclaimThresholdMs(minutes: number): number {
  return normalizeSessionIdleReclaimMinutes(minutes) * 60_000;
}
