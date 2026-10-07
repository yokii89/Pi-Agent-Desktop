import type { GitDiffHunk } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import styles from "./DiffView.module.css";

/** 解析 `@@ -a,b +c,d @@` 取旧文件起始行与行数；解析失败返回 null。 */
function parseHunkRange(header: string): { oldStart: number; oldCount: number } | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(header);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] !== undefined ? Number(match[2]) : 1,
  };
}

/** 相邻 hunk 之间（或文件头到首个 hunk）未改动的行数；无法解析时返回 null。 */
function unmodifiedBefore(hunk: GitDiffHunk, prev: GitDiffHunk | null): number | null {
  const range = parseHunkRange(hunk.header);
  if (!range) return null;
  if (!prev) return Math.max(0, range.oldStart - 1);
  const prevRange = parseHunkRange(prev.header);
  if (!prevRange) return null;
  return Math.max(0, range.oldStart - (prevRange.oldStart + prevRange.oldCount));
}

/**
 * 统一 diff 视图（侧栏内联展开用）：hunks 间折叠为「N unmodified lines」，
 * 行号单列 + 左侧色条标识增删（参照 docs/审查页面ui）。
 * key 由行号/行内容组合推导（diff 行无稳定 id，且只做追加渲染）。
 */
export function DiffView({ hunks }: { hunks: GitDiffHunk[] }) {
  const t = useT();
  return (
    <div className={styles.diff}>
      {hunks.map((hunk, index) => {
        const first = hunk.lines[0];
        const hunkKey = `${hunk.header}#${first ? `${first.oldLine ?? "x"}:${first.newLine ?? "x"}` : "empty"}`;
        const gap = unmodifiedBefore(hunk, index > 0 ? hunks[index - 1] : null);
        return (
          <div key={hunkKey}>
            {gap !== null && gap > 0 && (
              <div className={styles.gap}>
                <span className={styles.gapCaret} aria-hidden="true">
                  ⌄
                </span>
                {gap === 1
                  ? t("ui.review.unmodifiedOne", { count: gap })
                  : t("ui.review.unmodifiedMany", { count: gap })}
              </div>
            )}
            {hunk.lines.map((line) => {
              const lineNo = line.kind === "del" ? line.oldLine : line.newLine;
              return (
                <div
                  key={`${line.kind}:${line.oldLine ?? "x"}:${line.newLine ?? "x"}`}
                  className={[
                    styles.row,
                    line.kind === "add" ? styles.rowAdd : line.kind === "del" ? styles.rowDel : "",
                  ].join(" ")}
                >
                  <span className={styles.num}>{lineNo ?? ""}</span>
                  <span className={styles.code}>{line.text.length > 0 ? line.text : " "}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
