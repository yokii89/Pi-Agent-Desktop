import { Minus, Plus, Trash } from "@phosphor-icons/react";
import type { GitChange } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import styles from "./ChangeList.module.css";

/** 状态 → 字母章文案与语义色。 */
const STATUS_BADGES: Record<GitChange["status"], { letter: string; toneClass: string }> = {
  added: { letter: "A", toneClass: styles.badgeAdd },
  modified: { letter: "M", toneClass: styles.badgeMod },
  deleted: { letter: "D", toneClass: styles.badgeDel },
  renamed: { letter: "R", toneClass: styles.badgeRen },
  copied: { letter: "C", toneClass: styles.badgeRen },
  conflicted: { letter: "!", toneClass: styles.badgeDel },
  untracked: { letter: "U", toneClass: styles.badgeUntracked },
};

function splitPath(repoPath: string): { name: string; dir: string } {
  const idx = repoPath.lastIndexOf("/");
  return idx === -1
    ? { name: repoPath, dir: "" }
    : { name: repoPath.slice(idx + 1), dir: repoPath.slice(0, idx) };
}

interface ChangeListProps {
  changes: GitChange[];
  /** 当前选中条目键（layer|path），详情栏正在显示的文件。 */
  selectedKey: string | null;
  busy: boolean;
  onRowClick: (change: GitChange) => void;
  onStage: (change: GitChange) => void;
  onUnstage: (change: GitChange) => void;
  onDiscard: (change: GitChange) => void;
}

/** 审查左栏的变更文件列表（展示组件；操作回调由 ChangesPane 提供）。 */
export function ChangeList({
  changes,
  selectedKey,
  busy,
  onRowClick,
  onStage,
  onUnstage,
  onDiscard,
}: ChangeListProps) {
  const t = useT();
  return (
    <div className={styles.listScroll}>
      <ul className={styles.list}>
        {changes.map((change) => {
          const key = `${change.layer}|${change.path}`;
          const { name, dir } = splitPath(change.path);
          const badge = STATUS_BADGES[change.status];
          const hasCounts = change.additions !== null || change.deletions !== null;
          const totalDelta = (change.additions ?? 0) + (change.deletions ?? 0);
          const isStaged = change.layer === "staged";
          const fullTitle = change.oldPath ? `${change.oldPath} → ${change.path}` : change.path;
          return (
            <li key={key} className={styles.item}>
              <div className={styles.rowWrap}>
                <button
                  type="button"
                  className={[styles.row, key === selectedKey ? styles.rowSelected : ""].join(" ")}
                  onClick={() => onRowClick(change)}
                  aria-pressed={key === selectedKey}
                  title={fullTitle}
                >
                  <span className={[styles.badge, badge.toneClass].join(" ")} aria-hidden="true">
                    {badge.letter}
                  </span>
                  <span className={styles.fileCol}>
                    <span className={styles.fileLine}>
                      <span className={styles.fileName}>{name}</span>
                      {dir && <span className={styles.filePath}>{dir}</span>}
                    </span>
                  </span>
                  <span className={styles.stats}>
                    {hasCounts && totalDelta > 0 ? (
                      <>
                        {change.additions !== null && change.additions > 0 && (
                          <span className={styles.statAdd}>+{change.additions}</span>
                        )}
                        {change.deletions !== null && change.deletions > 0 && (
                          <span className={styles.statDel}>−{change.deletions}</span>
                        )}
                      </>
                    ) : (
                      <span className={styles.statMuted} aria-hidden="true">
                        —
                      </span>
                    )}
                  </span>
                </button>
                <div className={styles.rowActions}>
                  {isStaged ? (
                    <button
                      type="button"
                      className={styles.rowAction}
                      disabled={busy}
                      title={t("panels.review.unstageFile")}
                      aria-label={t("panels.review.unstageFile")}
                      onClick={() => onUnstage(change)}
                    >
                      <Minus size={14} weight="bold" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.rowAction}
                      disabled={busy}
                      title={t("panels.review.stageFile")}
                      aria-label={t("panels.review.stageFile")}
                      onClick={() => onStage(change)}
                    >
                      <Plus size={14} weight="bold" />
                    </button>
                  )}
                  <button
                    type="button"
                    className={[styles.rowAction, styles.rowActionDanger].join(" ")}
                    disabled={busy}
                    title={t("panels.review.discardFile")}
                    aria-label={t("panels.review.discardFile")}
                    onClick={() => onDiscard(change)}
                  >
                    <Trash size={14} weight="regular" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
