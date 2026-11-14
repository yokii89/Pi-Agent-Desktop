import { CaretLeft, CaretRight, Copy } from "@phosphor-icons/react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import type { FsReadPdfResult } from "../../../../shared/ipc";
import { useT } from "../../../hooks/useT";
import { useUiStore } from "../../../stores/uiStore";
import { copyTextToClipboard } from "../../../utils/clipboard";
import panelStyles from "./FilePanel.module.css";
import styles from "./PdfPreview.module.css";

/** 动态加载的 pdfjs 主模块（同时提供 TextLayer：文本层必须与渲染同一个实例）。 */
type PdfJsModule = typeof import("pdfjs-dist/build/pdf.mjs");

interface PdfPreviewProps {
  result: FsReadPdfResult;
}

/** 单页文本项（含字形定位的那一支；标记内容项会被过滤掉）。 */
type PdfTextItem = Extract<
  Awaited<ReturnType<PDFPageProxy["getTextContent"]>>["items"][number],
  { str: string }
>;

const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_PAGE_SCALE = 1.35;

/**
 * 文本项 → 纯文本：PDF 会把一个词拆成多个 run（字体/字重切换处），
 * 所以不能无脑加空格；只有同一行里两段之间留出可见空隙（超过 0.15 个字高）才补一个空格。
 */
function pageText(items: readonly PdfTextItem[]): string {
  let out = "";
  let cursorX: number | null = null;
  for (const item of items) {
    if (item.str.length > 0) {
      const x = item.transform[4];
      const gap = cursorX === null ? 0 : x - cursorX;
      const needSpace =
        out.length > 0 && !out.endsWith(" ") && !out.endsWith("\n") && gap > item.height * 0.15;
      if (needSpace) out += " ";
      out += item.str;
      cursorX = x + item.width;
    }
    if (item.hasEOL) {
      out += "\n";
      cursorX = null;
    }
  }
  return out;
}

/**
 * PDF 只读预览：按页把页面画进 canvas，再叠一层透明文本层（pdfjs TextLayer）
 * ——没有文本层就只能看不能选，也复制不出任何内容。
 */
export function PdfPreview({ result }: PdfPreviewProps) {
  const t = useT();
  const { showToast } = useUiStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [documentState, setDocumentState] = useState<PDFDocumentProxy | null>(null);
  const [pdfjs, setPdfjs] = useState<PdfJsModule | null>(null);
  const [page, setPage] = useState(1);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = canvasWrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailableWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | null =
      null;
    setError(null);
    setDocumentState(null);
    setPdfjs(null);
    setPage(1);
    void import("pdfjs-dist/build/pdf.mjs")
      .then(async (module) => {
        module.GlobalWorkerOptions.workerSrc = workerUrl;
        // PDF.js transfers typed-array buffers to its worker; keep IPC preview state reusable.
        loadingTask = module.getDocument({ data: result.data.slice() });
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        const document = await loadingTask.promise;
        if (!cancelled) {
          setPdfjs(module);
          setDocumentState(document);
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const message =
          reason instanceof Error && /password/i.test(reason.message)
            ? t("panels.files.pdfPassword")
            : t("panels.files.pdfLoadFailed");
        setError(message);
      });
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [result, t]);

  useEffect(() => {
    if (!pdfjs || !documentState || !canvasRef.current || availableWidth <= 0) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    void documentState
      .getPage(page)
      .then(async (pdfPage) => {
        if (cancelled || !canvasRef.current) return;
        const naturalViewport = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(MAX_PAGE_SCALE, availableWidth / naturalViewport.width);
        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        const pixelRatio = window.devicePixelRatio || 1;
        const ratio = Math.min(
          pixelRatio,
          Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)),
        );
        canvas.width = Math.ceil(viewport.width * ratio);
        canvas.height = Math.ceil(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        renderTask = pdfPage.render({ canvas: canvas, canvasContext: context, viewport });

        // 文本层与画布同尺寸叠放：文字全透明，只提供选框与无障碍文本
        const layer = textLayerRef.current;
        if (layer) {
          layer.replaceChildren();
          // pdfjs 6 用 --total-scale-factor 计算字号与图层尺寸（round() 需要两个 round 步长变量）
          layer.style.setProperty("--total-scale-factor", String(scale));
          layer.style.setProperty("--scale-round-x", "1px");
          layer.style.setProperty("--scale-round-y", "1px");
          layer.style.width = `${viewport.width}px`;
          layer.style.height = `${viewport.height}px`;
          textLayer = new pdfjs.TextLayer({
            textContentSource: pdfPage.streamTextContent(),
            container: layer,
            viewport,
          });
          void textLayer.render().catch(() => {
            // 文本层失败不影响看图；选区能力降级而已
          });
        }

        return renderTask.promise;
      })
      .catch(() => {
        if (!cancelled) setError(t("panels.files.pdfPageFailed"));
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [availableWidth, documentState, page, pdfjs, t]);

  /** 「复制本页文本」：走 pdfjs 的文本内容，与屏幕上的文本层同源。 */
  const copyPage = (): void => {
    if (!documentState) return;
    void documentState
      .getPage(page)
      .then((pdfPage) => pdfPage.getTextContent())
      .then((content) => {
        const text = pageText(content.items.filter((item) => "str" in item)).trim();
        return copyTextToClipboard(text).then((ok) =>
          showToast(ok ? t("toast.copied") : t("toast.copyFailed")),
        );
      })
      .catch(() => showToast(t("toast.copyFailed")));
  };

  if (error) return <p className={panelStyles.noMatch}>{error}</p>;
  return (
    <div className={styles.wrap}>
      {documentState && (
        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.button}
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
            title={t("panels.files.backPrevious")}
          >
            <CaretLeft size={16} weight="regular" />
          </button>
          <span>{t("panels.files.pdfPage", { page, total: documentState.numPages })}</span>
          <button
            type="button"
            className={styles.button}
            disabled={page >= documentState.numPages}
            onClick={() => setPage((value) => value + 1)}
            title={t("panels.files.forwardNext")}
          >
            <CaretRight size={16} weight="regular" />
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={copyPage}
            title={t("panels.files.copyPageText")}
          >
            <Copy size={16} weight="regular" />
          </button>
        </div>
      )}
      <div className={styles.canvasWrap} ref={canvasWrapRef}>
        {documentState ? (
          <div className={styles.page}>
            <canvas ref={canvasRef} />
            <div ref={textLayerRef} className={styles.textLayer} data-selectable-text="" />
          </div>
        ) : (
          <p className={panelStyles.noMatch}>{t("panels.files.loading")}</p>
        )}
      </div>
    </div>
  );
}
