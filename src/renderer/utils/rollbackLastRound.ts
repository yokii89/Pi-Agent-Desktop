import { t } from "../../shared/i18n";
import type { GitChange, GitRollbackResult } from "../../shared/ipc";

/**
 * 本轮撤销（lastRound rollback）的资格、文案与确认框数据模型。
 * 汇总卡与审阅面板共用，避免双入口语义漂移（docs/design/11）。
 */

export type RollbackBlockReason =
  | "ready"
  | "notRepo"
  | "noSnapshot"
  | "committed"
  | "empty"
  | "rolling"
  | "noSession";

const ROLLBACK_BLOCK_REASON_KEYS: Record<RollbackBlockReason, string> = {
  ready: "ui.rollback.block.ready",
  notRepo: "ui.rollback.block.notRepo",
  noSnapshot: "ui.rollback.block.noSnapshot",
  committed: "ui.rollback.block.committed",
  empty: "ui.rollback.block.empty",
  rolling: "ui.rollback.block.rolling",
  noSession: "ui.rollback.block.noSession",
};

/** 按当前语言取撤销资格说明。 */
export function rollbackBlockReasonText(reason: RollbackBlockReason): string {
  return t(ROLLBACK_BLOCK_REASON_KEYS[reason]);
}

/** 兼容旧调用：整表按键取文案（模块级 t，随语言切换）。 */
export const ROLLBACK_BLOCK_REASON_TEXT: Record<RollbackBlockReason, string> = new Proxy(
  {} as Record<RollbackBlockReason, string>,
  {
    get(_target, prop: string) {
      return rollbackBlockReasonText(prop as RollbackBlockReason);
    },
  },
);

export const ROLLBACK_DIALOG_TITLE_KEY = "ui.rollback.title";

/** 冲突路径在确认框中的最多直接展示条数。 */
export const CONFLICT_LIST_LIMIT = 5;

export interface RollbackInspect {
  /** 即将处理的去重路径总数（rename 计新旧两条）。 */
  total: number;
  /** 快照中存在的路径数（还原/恢复）；未知时 null。 */
  restoreCount: number | null;
  /** 快照中不存在的路径数（删除新建）；未知时 null。 */
  deleteCount: number | null;
  /** 轮末之后被修改、撤销会覆盖的既有文件。 */
  conflictOverwrite: string[];
  /** 轮末之后被修改、撤销会删除的新建文件。 */
  conflictDelete: string[];
  loading: boolean;
}

export function emptyRollbackInspect(total = 0, loading = false): RollbackInspect {
  return {
    total,
    restoreCount: null,
    deleteCount: null,
    conflictOverwrite: [],
    conflictDelete: [],
    loading,
  };
}

/** lastRound → 撤销将触碰的去重路径（含 rename 的 oldPath）。 */
export function rollbackTargetPaths(lastRound: Pick<GitChange, "path" | "oldPath">[]): string[] {
  const paths = new Set<string>();
  for (const change of lastRound) {
    paths.add(change.path);
    if (change.oldPath) paths.add(change.oldPath);
  }
  return [...paths];
}

export function buildRollbackSuccessToast(result: GitRollbackResult): string {
  return result.deleted > 0
    ? t("ui.rollback.successRestoreDelete", {
        restored: result.restored,
        deleted: result.deleted,
      })
    : t("ui.rollback.successRestore", { restored: result.restored });
}

export function buildRollbackFailToast(err: unknown): string {
  return err instanceof Error ? err.message : t("ui.rollback.failed");
}
