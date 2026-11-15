import { useT } from "../../../hooks/useT";
import { MarkdownDoc } from "../../markdown/MarkdownDoc";
import panelStyles from "./FilePanel.module.css";
import styles from "./MarkdownPreview.module.css";

export type MarkdownViewMode = "preview" | "source";

interface MarkdownPreviewProps {
  /** md 文件绝对路径（Markdown 内相对引用按它所在目录解析）。 */
  path: string;
  content: string;
  /** 主进程读取超 1MB 截断时为 true（预览/源码两态都提示）。 */
  truncated: boolean;
}

/** Markdown 排版预览；源码态由 FilePanel 的统一 CodeMirror 视图承接。 */
export function MarkdownPreview({ path, content, truncated }: MarkdownPreviewProps) {
  const t = useT();
  return (
    <div className={styles.wrap}>
      {truncated && <p className={panelStyles.truncatedNote}>{t("panels.files.truncatedNote")}</p>}
      <div className={styles.body} data-selectable-text="">
        <MarkdownDoc text={content} sourcePath={path} codeHighlight mermaid />
      </div>
    </div>
  );
}
