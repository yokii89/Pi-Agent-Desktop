import { ArrowCounterClockwise, CaretDown, NotePencil } from "@phosphor-icons/react";
import { useState } from "react";
import { FileIcon } from "../../fileIcons";
import { useT } from "../../hooks/useT";
import { useReviewStore } from "../../stores/reviewStore";
import { useSessionMeta } from "../../stores/sessionStore";
import type { EditsFileStat, EditsSummaryEntry } from "../../stores/sessionTranscript";
import { useUiStore } from "../../stores/uiStore";
import { ROLLBACK_BLOCK_REASON_TEXT } from "../../utils/rollbackLastRound";
import styles from "./FileEditsSummary.module.css";
import { FileLink } from "./FileLink";

/** 默认只露前 3 个文件，其余收进「再显示 N 个文件」。 */
const VISIBLE_FILES = 3;

interface FileEditsSummaryProps {
  entry: EditsSummaryEntry;
  /** 是否为会话流中最后一张汇总卡：只有最新一张才接撤销/审阅，并优先读 lastRound。 */
  isLatest: boolean;
}

/**
 * 本轮文件编辑汇总卡：run 收口后出现在文档流末尾。
 * 展示路径一律为相对工作目录/仓库根的相对路径。
 * 历史卡：只读工具结果快照；最新卡：lastRound 就绪后切到 Git 统计（与撤销/审阅同源）。
 */
export function FileEditsSummary({ entry, isLatest }: FileEditsSummaryProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const {
    lastRound,
    repoRoot,
    canRollback,
    rollingBack,
    rollbackBlockReason,
    requestRollbackPrompt,
    setFilterMode,
  } = useReviewStore();
  const { sessionWorkingDir } = useSessionMeta();
  const { openReview } = useUiStore();

  const files = resolveDisplayFiles(entry, isLatest, lastRound, sessionWorkingDir, repoRoot);
  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
  // 无 git / 无 diff 时统计可能是 0：不展示 +0 -0，避免假精确
  const hasAnyStat = totalAdditions > 0 || totalDeletions > 0;
  const hidden = files.length - VISIBLE_FILES;
  const visible = expanded ? files : files.slice(0, VISIBLE_FILES);
  const roots = [repoRoot, sessionWorkingDir];
  /** 最新卡且已切到 Git lastRound：标题与撤销范围同源。 */
  const usingGitRound = isLatest && lastRound.length > 0;
  const title = !isLatest
    ? t("session.fileEdits.one", { count: files.length })
    : usingGitRound
      ? t("session.fileEdits.many", { count: files.length })
      : t("session.fileEdits.agent", { count: files.length });
  const undoTitle = canRollback
    ? ROLLBACK_BLOCK_REASON_TEXT.ready
    : ROLLBACK_BLOCK_REASON_TEXT[rollbackBlockReason];

  const handleOpenReview = () => {
    setFilterMode("lastRound");
    openReview();
  };

  // 确认弹窗由 reviewStore 驱动、全局宿主渲染（快捷键与按钮共用同一确认流）
  const handleUndo = () => {
    requestRollbackPrompt();
  };

  return (
    <aside className={styles.card} aria-label={t("session.fileEdits.aria")}>
      <div className={styles.head}>
        <span className={styles.iconBox} aria-hidden="true">
          <NotePencil size={18} weight="regular" />
        </span>
        <div className={styles.titleCol}>
          <span className={styles.title}>{title}</span>
          <div className={styles.metaRow}>
            {usingGitRound && (
              <span className={styles.sourceHint}>{t("session.fileEdits.sameAsUndo")}</span>
            )}
            {hasAnyStat && (
              <span className={styles.totals}>
                {totalAdditions > 0 && <span className={styles.add}>+{totalAdditions}</span>}
                {totalDeletions > 0 && <span className={styles.del}>-{totalDeletions}</span>}
              </span>
            )}
          </div>
        </div>
        {isLatest && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.undo}
              disabled={!canRollback || rollingBack}
              title={undoTitle}
              onClick={handleUndo}
            >
              {rollingBack ? (
                t("session.fileEdits.undoing")
              ) : (
                <>
                  {t("session.fileEdits.undo")}
                  <ArrowCounterClockwise size={14} weight="regular" />
                </>
              )}
            </button>
            <button type="button" className={styles.review} onClick={handleOpenReview}>
              {t("session.fileEdits.review")}
            </button>
          </div>
        )}
      </div>
      <ul className={styles.list}>
        {visible.map((file) => (
          <li key={file.path} className={styles.item}>
            <FileIcon fileName={baseName(file.path)} className={styles.fileIcon} />
            <FileLink
              path={toOpenPath(file.path, roots)}
              label={file.path}
              className={styles.filePath}
            />
            <span className={styles.stats}>
              {file.additions > 0 && <span className={styles.add}>+{file.additions}</span>}
              {file.deletions > 0 && <span className={styles.del}>-{file.deletions}</span>}
            </span>
          </li>
        ))}
      </ul>
      {!expanded && hidden > 0 && (
        <button type="button" className={styles.more} onClick={() => setExpanded(true)}>
          {t("session.fileEdits.showMore", { count: hidden })}
          <CaretDown size={12} weight="bold" />
        </button>
      )}
      {expanded && hidden > 0 && (
        <button type="button" className={styles.more} onClick={() => setExpanded(false)}>
          {t("session.fileEdits.collapse")}
        </button>
      )}
    </aside>
  );
}

/**
 * 展示用文件列表（path 一律相对路径）：
 * - 历史卡：只读工具结果快照，不被 lastRound 污染。
 * - 最新卡：lastRound 非空时切换为 Git 统计（与撤销/审阅同源）；
 *   lastRound 尚未就绪或非 Git 工作区时回退工具快照。
 */
function resolveDisplayFiles(
  entry: EditsSummaryEntry,
  isLatest: boolean,
  lastRound: { path: string; additions: number | null; deletions: number | null }[],
  cwd: string | null,
  repoRoot: string | null,
): EditsFileStat[] {
  const roots = [repoRoot, cwd];

  if (isLatest && lastRound.length > 0) {
    const toolByKey = new Map(entry.files.map((file) => [pathKey(file.path, roots), file]));
    // lastRound 可能同一路径出现 staged/unstaged 两条：展示按路径去重，与撤销 N 对齐
    const seen = new Set<string>();
    const files: EditsFileStat[] = [];
    for (const change of lastRound) {
      const key = pathKey(change.path, roots);
      if (seen.has(key)) continue;
      seen.add(key);
      const tool = toolByKey.get(key);
      files.push({
        // lastRound.path 已是仓库相对路径（/ 分隔）
        path: change.path,
        additions: change.additions ?? tool?.additions ?? 0,
        deletions: change.deletions ?? tool?.deletions ?? 0,
      });
    }
    return files;
  }

  return entry.files.map((file) => ({
    path: shortDisplayPath(file.path, roots) || file.path.replace(/\\/g, "/"),
    additions: file.additions,
    deletions: file.deletions,
  }));
}

/** 文件类型图标按末段文件名（含后缀）命中。 */
function baseName(raw: string): string {
  const segments = raw.split(/[\\/]/);
  return segments[segments.length - 1] ?? raw;
}

/** 打开用绝对路径：相对路径优先按 repoRoot（lastRound 语义），再回退 cwd。 */
function toOpenPath(relOrAbs: string, roots: (string | null)[]): string {
  if (isAbsolutePath(relOrAbs)) return relOrAbs;
  const rel = relOrAbs.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const root of roots) {
    if (!root) continue;
    const base = root.replace(/[\\/]+$/, "");
    return `${base}/${rel}`;
  }
  return relOrAbs;
}

function isAbsolutePath(raw: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("/") || raw.startsWith("\\\\");
}

/** 比较用路径 key：统一分隔符、剥掉根前缀、小写（Windows 不区分大小写）。 */
function pathKey(raw: string, roots: (string | null)[]): string {
  const rel = shortDisplayPath(raw, roots) ?? raw.replace(/\\/g, "/");
  return rel.replace(/^\.\//, "").toLowerCase();
}

/** 剥掉 repoRoot/cwd 前缀得到相对路径；已是相对路径则原样返回。 */
function shortDisplayPath(raw: string, roots: (string | null)[]): string | null {
  const norm = raw.replace(/\\/g, "/");
  if (!isAbsolutePath(raw)) {
    return norm.replace(/^\.\//, "");
  }
  for (const root of roots) {
    if (!root) continue;
    const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
    if (norm.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
      return norm.slice(base.length + 1);
    }
  }
  // 绝对路径但不在已知根下：仍尽量展示末段相对形态，避免整条盘符路径糊脸
  return null;
}
