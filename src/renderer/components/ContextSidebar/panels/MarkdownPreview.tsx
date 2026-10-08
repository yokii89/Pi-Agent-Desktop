import { useT } from "../../../hooks/useT";
import { MarkdownDoc } from "../../markdown/MarkdownDoc";
import { CodeHighlight } from "../../ui/CodeHighlight";
import panelStyles from "./FilePanel.module.css";
import styles from "./MarkdownPreview.module.css";

export type MarkdownViewMode = "preview" | "source";

interface MarkdownPreviewProps {
  /** md 文件绝对路径（Markdown 内相对引用按它所在目录解析）。 */
  path: string;
  content: string;
  /** 主进程读取超 1MB 截断时为 true（预览/源码两态都提示）。 */
  truncated: boolean;
  /** 两态切换状态由 FilePanel 持有：跨文件切换、返回文件树后保持。 */
  mode: MarkdownViewMode;
  onModeChange: (mode: MarkdownViewMode) => void;
  /** `path:line` 打开时的目标行（1-based）：仅源码态可定位，预览态忽略。 */
  focusLine?: number | null;
}

/** 文件面板 Markdown 预览：文档流渲染 / 源码高亮两态切换（docs/文件面板文件渲染方案.md §3.5）。 */
export function MarkdownPreview({
  path,
  content,
  truncated,
  mode,
  onModeChange,
  focusLine,
}: MarkdownPreviewProps) {
  const t = useT();
  return (
    <div className={styles.wrap}>
      <div className={styles.modeBar}>
        <button
          type="button"
          aria-pressed={mode === "preview"}
          className={mode === "preview" ? styles.modeBtnActive : styles.modeBtn}
          onClick={() => onModeChange("preview")}
        >
          {t("panels.files.mdPreview")}
        </button>
        <button
          type="button"
          aria-pressed={mode === "source"}
          className={mode === "source" ? styles.modeBtnActive : styles.modeBtn}
          onClick={() => onModeChange("source")}
        >
          {t("panels.files.mdSource")}
        </button>
      </div>
      {truncated && <p className={panelStyles.truncatedNote}>{t("panels.files.truncatedNote")}</p>}
      <div className={styles.body}>
        {mode === "preview" ? (
          <MarkdownDoc text={content} sourcePath={path} codeHighlight />
        ) : (
          <CodeHighlight code={content} filePath={path} focusLine={focusLine} />
        )}
      </div>
    </div>
  );
}
