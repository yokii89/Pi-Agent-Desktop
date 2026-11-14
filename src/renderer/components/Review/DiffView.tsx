import { useRef, useState } from "react";
import type { GitDiffHunk } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { useUiStore } from "../../stores/uiStore";
import { copyTextToClipboard } from "../../utils/clipboard";
import { ContextMenu } from "../ui/ContextMenu";
import type { MenuItem } from "../ui/Menu";
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

/** 右键菜单的落点与该行文本（行文本用于「复制这一行」）。 */
interface DiffMenuState {
  x: number;
  y: number;
  /** 被右键的那一行原文；空行时为 ""（该条目禁用）。 */
  line: string;
  /** 右键时 diff 内已有选区的话，这里保存选区文本。 */
  selected: string;
}

interface DiffViewProps {
  hunks: GitDiffHunk[];
  /** 相对仓库根的文件路径：提供时右键菜单多一条「复制路径」。 */
  filePath?: string;
}

/**
 * 统一 diff 视图（侧栏内联展开用）：hunks 间折叠为「N unmodified lines」，
 * 行号单列 + 左侧色条标识增删（参照 docs/审查页面ui）。
 * key 由行号/行内容组合推导（diff 行无稳定 id，且只做追加渲染）。
 *
 * 代码正文可鼠标选取（行号槽仍为 none），右键给「复制选中 / 复制这一行 / 复制路径」：
 * 审阅时把一行扔进输入栏或外部工具是最常见动作，只读视图不该只让人看。
 */
export function DiffView({ hunks, filePath }: DiffViewProps) {
  const t = useT();
  const { showToast } = useUiStore();
  const rootRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<DiffMenuState | null>(null);

  const copy = (text: string): void => {
    void copyTextToClipboard(text).then((ok) =>
      showToast(ok ? t("toast.copied") : t("toast.copyFailed")),
    );
  };

  const openMenu = (event: React.MouseEvent, line: string): void => {
    event.preventDefault();
    const selection = window.getSelection();
    const root = rootRef.current;
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const insideSelection =
      root !== null &&
      range !== null &&
      root.contains(range.commonAncestorContainer) &&
      selection !== null &&
      !selection.isCollapsed;
    setMenu({
      x: event.clientX,
      y: event.clientY,
      line,
      selected: insideSelection ? (selection?.toString() ?? "") : "",
    });
  };

  const menuItems: MenuItem[] = menu
    ? [
        {
          key: "selection",
          label: t("ui.review.copySelection"),
          disabled: menu.selected.trim().length === 0,
          onSelect: () => copy(menu.selected),
        },
        {
          key: "line",
          label: t("ui.review.copyLine"),
          disabled: menu.line.trim().length === 0,
          onSelect: () => copy(menu.line),
        },
        ...(filePath
          ? [
              {
                key: "path",
                label: t("panels.files.copyPath"),
                dividerBefore: true,
                onSelect: () => copy(filePath),
              },
            ]
          : []),
      ]
    : [];

  return (
    <div ref={rootRef} className={styles.diff} data-selectable-text="">
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
                // biome-ignore lint/a11y/noStaticElementInteractions: diff 行是只读文本，右键只用来开复制菜单
                <div
                  key={`${line.kind}:${line.oldLine ?? "x"}:${line.newLine ?? "x"}`}
                  className={[
                    styles.row,
                    line.kind === "add" ? styles.rowAdd : line.kind === "del" ? styles.rowDel : "",
                  ].join(" ")}
                  onContextMenu={(event) => openMenu(event, line.text)}
                >
                  <span className={styles.num}>{lineNo ?? ""}</span>
                  <span className={styles.code}>{line.text.length > 0 ? line.text : " "}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      {menu && (
        <ContextMenu
          position={{ x: menu.x, y: menu.y }}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
