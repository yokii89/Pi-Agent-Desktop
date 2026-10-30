/**
 * 「提交或推送」浮窗的纯派生逻辑（docs/design/100）：增删统计、千分位、可提交判定。
 *
 * 与 sessionMonitorData 同一口径：判定全在这里，组件只负责展示与调用 reviewStore
 * 的写操作，不启 UI 也能直接断言。
 */
import type { GitChange } from "../../../shared/ipc";

/** 增删行汇总；二进制文件的 numstat 为 null，按 0 计（文件数仍如实计入）。 */
export interface CommitDiffStat {
  additions: number;
  deletions: number;
}

export function sumDiffStat(changes: readonly GitChange[]): CommitDiffStat {
  let additions = 0;
  let deletions = 0;
  for (const change of changes) {
    if (change.additions !== null) additions += change.additions;
    if (change.deletions !== null) deletions += change.deletions;
  }
  return { additions, deletions };
}

/** 千分位（+1,995 的口径），按界面语言分组。 */
export function formatStat(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

export interface CommitAvailability {
  message: string;
  /** 勾选「包含未暂存变更」：提交前先把未暂存/未跟踪改动加入暂存区。 */
  includeUnstaged: boolean;
  /** 工作区全部变更条目数。 */
  changeCount: number;
  /** 已暂存条目数。 */
  stagedCount: number;
  /** 有在途写操作（暂存/提交/推送）。 */
  busy: boolean;
}

/** 提交按钮可用性：说明非空 + 有可提交的改动 + 没有在途写操作。 */
export function canCommit(availability: CommitAvailability): boolean {
  if (availability.busy) return false;
  if (!availability.message.trim()) return false;
  return availability.includeUnstaged ? availability.changeCount > 0 : availability.stagedCount > 0;
}
