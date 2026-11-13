import { useMemo } from "react";
import { useT } from "../../../hooks/useT";
import { parseNotebook } from "../../../utils/notebook";
import { MarkdownDoc } from "../../markdown/MarkdownDoc";
import { CodeHighlight } from "../../ui/CodeHighlight";
import panelStyles from "./FilePanel.module.css";
import styles from "./NotebookPreview.module.css";

export function NotebookPreview({ path, content }: { path: string; content: string }) {
  const t = useT();
  const notebook = useMemo(() => parseNotebook(content), [content]);
  if (!notebook) {
    return (
      <>
        <p className={panelStyles.truncatedNote}>{t("panels.files.notebookInvalid")}</p>
        <CodeHighlight code={content} filePath={path} className={panelStyles.previewContent} />
      </>
    );
  }
  return (
    <div className={styles.wrap}>
      {notebook.truncated && (
        <p className={panelStyles.truncatedNote}>{t("panels.files.truncatedNote")}</p>
      )}
      {notebook.cells.map((cell, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: notebook cell order is fixed in this read-only snapshot
        <section className={styles.cell} key={`${index}:${cell.type}`}>
          <div className={styles.cellHeader}>
            <span>
              {cell.type === "code"
                ? t("panels.files.notebookCode")
                : cell.type === "markdown"
                  ? t("panels.files.notebookMarkdown")
                  : t("panels.files.notebookOutput")}
            </span>
            {cell.executionCount !== null && <span>[{cell.executionCount}]</span>}
          </div>
          {cell.type === "markdown" ? (
            <MarkdownDoc
              text={cell.source}
              sourcePath={path}
              codeHighlight
              mermaid
              className={styles.markdownCell}
            />
          ) : (
            <CodeHighlight code={cell.source} filePath={path} lang={cell.language} />
          )}
          {cell.outputs.map((output, outputIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: outputs are immutable in this read-only snapshot
            <div className={styles.output} key={outputIndex}>
              {output.imageDataUrl ? (
                <img className={styles.outputImage} src={output.imageDataUrl} alt="" />
              ) : (
                <>
                  <div className={styles.outputLabel}>{t("panels.files.notebookOutput")}</div>
                  <CodeHighlight code={output.text ?? ""} filePath={`${path}.txt`} />
                </>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
