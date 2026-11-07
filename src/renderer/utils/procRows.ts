import type { TranslateFn } from "../../shared/i18n";
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

/**
 * 进程行的悬浮标题：命令行 + 附加行 + 登记口径。
 * 「后台作业」那一档是长任务转了后台（docs/design/133 §2），不写出来会被读成「起错了服务」；
 * 监控卡与浮卡的行都很窄，口径只进 tooltip，完整文案在详情页签的概览里。
 */
export function procRowTitle(
  t: TranslateFn,
  proc: ManagedProcess,
  extras: readonly string[] = [],
): string {
  const parts = [proc.commandLine || proc.name, ...extras, t(`proc.origin.${proc.origin}`)];
  if (proc.origin === "job") parts.push(t("proc.origin.job.hint"));
  return parts.join("\n");
}
