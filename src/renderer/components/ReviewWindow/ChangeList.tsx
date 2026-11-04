import { Minus, Plus, Trash } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import type { GitChange } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { revealInNearestScroller } from "../../utils/revealInScroller";
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

/** 列表行只展示文件名（避免目录段挤占宽度），完整路径靠行 title 悬浮查看。 */
function baseName(repoPath: string): string {
  const idx = repoPath.lastIndexOf("/");
  return idx === -1 ? repoPath : repoPath.slice(idx + 1);
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
  const scrollRef = useRef<HTMLDivElement>(null);

  // 选中条目滚进视野：会话区编辑汇总卡点开靠后的文件时，不滚就只看得到详情、见不到高亮行。
  // revealInNearestScroller 只在超出容器时动，所以行内点击（已可见）这一趟是空操作。
  // biome-ignore lint/correctness/useExhaustiveDependencies: changes 不直接读，但它是「行重新渲染」的依据（选中键未变而列表换层时要重新定位）
  useEffect(() => {
    if (!selectedKey) return;
    const host = scrollRef.current;
    if (!host) return;
    const row = Array.from(host.querySelectorAll<HTMLElement>("[data-change-key]")).find(
      (el) => el.dataset.changeKey === selectedKey,
    );
    if (row) revealInNearestScroller(row, "y");
  }, [selectedKey, changes]);

  return (
    <div className={styles.listScroll} ref={scrollRef}>
      <ul className={styles.list}>
        {changes.map((change) => {
          const key = `${change.layer}|${change.path}`;
          const name = baseName(change.path);
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
                  data-change-key={key}
                  title={fullTitle}
                >
                  <span className={[styles.badge, badge.toneClass].join(" ")} aria-hidden="true">
                    {badge.letter}
                  </span>
                  <span className={styles.fileCol}>
                    <span className={styles.fileName}>{name}</span>
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
