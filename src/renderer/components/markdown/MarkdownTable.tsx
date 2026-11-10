import { Copy, ImageSquare } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { useT } from "../../hooks/useT";
import { clipboardService } from "../../services/clipboardService";
import { useUiStore } from "../../stores/uiStore";
import { elementToPng } from "../../utils/elementToPng";
import { type TableHastNode, tableToMarkdown } from "../../utils/tableToMarkdown";
import styles from "./markdown.module.css";

interface MarkdownTableProps {
  /** react-markdown 传入的 hast 表格节点：「复制 Markdown」从 AST 还原，不读 DOM。 */
  node?: TableHastNode;
  /** 右上角工具条开关（会话区开，文件面板 / ExtensionView 只保留表格本体）。 */
  tools: boolean;
  children?: ReactNode;
}

/**
 * GFM 表格外壳（docs/design/135）：圆角卡片 + 横向滚动容器 + 会话区右上角工具条。
 * 圆角与裁剪归滚动容器（`overflow-x: auto` 自带裁剪），表格本身只画内部网格线，
 * 这样表头底色能跟着卡片一起被裁成圆角。
 */
export function MarkdownTable({ node, tools, children }: MarkdownTableProps) {
  const t = useT();
  const { showToast } = useUiStore();
  const [rendering, setRendering] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const copyMarkdown = (): void => {
    const markdown = node ? tableToMarkdown(node) : "";
    if (markdown === "") {
      showToast(t("common.copyFailed"));
      return;
    }
    void navigator.clipboard
      .writeText(markdown)
      .then(() => showToast(t("common.copied")))
      .catch(() => showToast(t("common.copyFailed")));
  };

  const copyImage = (): void => {
    const el = scrollRef.current;
    if (!el || rendering) return;
    setRendering(true);
    void elementToPng(el)
      .then((png) => clipboardService.writeImageDataUrl(png.dataUrl))
      .then(() => showToast(t("common.tableImageCopied")))
      .catch(() => showToast(t("common.copyFailed")))
      .finally(() => setRendering(false));
  };

  return (
    <div className={styles.tableWrap}>
      <div className={styles.tableScroll} ref={scrollRef}>
        <table>{children}</table>
      </div>
      {tools && (
        <div className={styles.tableTools}>
          <button
            type="button"
            className={styles.tableTool}
            title={t("common.copyTableImage")}
            aria-label={t("common.copyTableImage")}
            disabled={rendering}
            onClick={copyImage}
          >
            <ImageSquare size={16} weight="regular" />
          </button>
          <button
            type="button"
            className={styles.tableTool}
            title={t("common.copyTableMarkdown")}
            aria-label={t("common.copyTableMarkdown")}
            onClick={copyMarkdown}
          >
            <Copy size={16} weight="regular" />
          </button>
        </div>
      )}
    </div>
  );
}
