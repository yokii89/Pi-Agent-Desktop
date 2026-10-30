import type { ManagedProcess } from "../../shared/ipc";

/**
 * 进程列表展示顺序：存活在前（按登记顺序），已结束在后（新的在前），
 * 用户手动忽略过的不再展示。监控卡与详情页签共用同一口径。
 */
export function orderProcesses(processes: readonly ManagedProcess[]): ManagedProcess[] {
  const ranked = processes.filter((proc) => proc.status !== "ignored");
  return ranked.sort((a, b) => {
    const aAlive = a.status === "alive" ? 0 : 1;
    const bAlive = b.status === "alive" ? 0 : 1;
    if (aAlive !== bAlive) return aAlive - bAlive;
    if (aAlive === 0) return a.registeredAt - b.registeredAt;
    return b.registeredAt - a.registeredAt;
  });
}
