import {
  ArrowsHorizontal,
  CaretLeft,
  CaretRight,
  Copy,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
} from "@phosphor-icons/react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FsReadPdfResult } from "../../../../shared/ipc";
import { useDevicePixelRatio } from "../../../hooks/useDevicePixelRatio";
import { useT } from "../../../hooks/useT";
import { useUiStore } from "../../../stores/uiStore";
import { copyTextToClipboard } from "../../../utils/clipboard";
import { loadPdfJs, type PdfJsModule } from "../../../utils/pdfLoader";
import { getPdfResourceOptions } from "../../../utils/pdfResources";
import {
  getPdfViewportSize,
  PDF_MAX_ZOOM,
  PDF_MIN_ZOOM,
  stepPdfZoom,
} from "../../../utils/pdfViewport";
import { previewPageStep } from "../../../utils/previewPageKeys";
import panelStyles from "./FilePanel.module.css";
import styles from "./PdfPreview.module.css";

interface PdfPreviewProps {
  result: FsReadPdfResult;
  onCloseSearch: () => void;
}

/** 单页文本项（含字形定位的那一支；标记内容项会被过滤掉）。 */
type PdfTextItem = Extract<
  Awaited<ReturnType<PDFPageProxy["getTextContent"]>>["items"][number],
  { str: string }
>;

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
export function PdfPreview({ result, onCloseSearch }: PdfPreviewProps) {
  const t = useT();
  const { showToast } = useUiStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [documentState, setDocumentState] = useState<PDFDocumentProxy | null>(null);
  const [pdfjs, setPdfjs] = useState<PdfJsModule | null>(null);
  const [page, setPage] = useState(1);
  const [pdfPage, setPdfPage] = useState<PDFPageProxy | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const pixelRatio = useDevicePixelRatio();
  const size = useMemo(
    () =>
      pdfPage && availableWidth > 0
        ? getPdfViewportSize(pdfPage.getViewport({ scale: 1 }), availableWidth, zoom, pixelRatio)
        : null,
    [availableWidth, pdfPage, pixelRatio, zoom],
  );
  const previousSizeRef = useRef<{ page: PDFPageProxy; width: number; height: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (error) onCloseSearch();
  }, [error, onCloseSearch]);

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
    if (!documentState) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const step = previewPageStep(event);
      if (step === null) return;
      const wrap = canvasWrapRef.current;
      // Enlarged pages need the arrow keys for scrolling to off-screen content.
      if (
        wrap &&
        ((/Left|Right/.test(event.key) && wrap.scrollWidth > wrap.clientWidth) ||
          (/Up|Down/.test(event.key) && wrap.scrollHeight > wrap.clientHeight))
      ) {
        return;
      }
      event.preventDefault();
      setPage((value) => Math.min(documentState.numPages, Math.max(1, value + step)));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [documentState]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | null =
      null;
    setError(null);
    setDocumentState(null);
    setPdfjs(null);
    setPdfPage(null);
    setPage(1);
    setZoom(null);
    previousSizeRef.current = null;
    void loadPdfJs()
      .then(async (module) => {
        // PDF.js transfers typed-array buffers to its worker; keep IPC preview state reusable.
        loadingTask = module.getDocument({
          data: result.data.slice(),
          ...getPdfResourceOptions(),
        });
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
    let cancelled = false;
    setPdfPage(null);
    if (documentState) {
      void documentState.getPage(page).then(
        (value) => {
          if (!cancelled) setPdfPage(value);
        },
        () => {
          if (!cancelled) setError(t("panels.files.pdfPageFailed"));
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [documentState, page, t]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const layer = textLayerRef.current;
    const wrap = canvasWrapRef.current;
    if (!pdfjs || !pdfPage || !canvas || !layer || !wrap || !size) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    const render = async (): Promise<void> => {
      const previous = previousSizeRef.current;
      const pageElement = canvas.parentElement;
      const anchor =
        previous?.page === pdfPage && pageElement
          ? {
              x: (wrap.scrollLeft + wrap.clientWidth / 2 - pageElement.offsetLeft) / previous.width,
              y: (wrap.scrollTop + wrap.clientHeight / 2 - pageElement.offsetTop) / previous.height,
            }
          : null;
      const viewport = pdfPage.getViewport({ scale: size.scale });
      canvas.width = size.canvasWidth;
      canvas.height = size.canvasHeight;
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
      layer.replaceChildren();
      // PDF.js must know the output transform as well as the CSS viewport size.
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No canvas context");
      renderTask = pdfPage.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: [size.canvasWidth / size.width, 0, 0, size.canvasHeight / size.height, 0, 0],
      });

      if (anchor && pageElement) {
        wrap.scrollLeft = pageElement.offsetLeft + anchor.x * size.width - wrap.clientWidth / 2;
        wrap.scrollTop = pageElement.offsetTop + anchor.y * size.height - wrap.clientHeight / 2;
      } else {
        wrap.scrollTo(0, 0);
      }
      previousSizeRef.current = { page: pdfPage, width: size.width, height: size.height };

      // The selection layer stays in CSS pixels even when the canvas reaches its pixel budget.
      layer.style.setProperty("--total-scale-factor", String(size.scale));
      layer.style.setProperty("--scale-round-x", "1px");
      layer.style.setProperty("--scale-round-y", "1px");
      textLayer = new pdfjs.TextLayer({
        textContentSource: pdfPage.streamTextContent(),
        container: layer,
        viewport,
      });
      // TextLayer rounds its dimensions down; match the exact canvas size before rotating it.
      const unrotatedViewport = pdfPage.getViewport({ scale: size.scale, rotation: 0 });
      layer.style.width = `${unrotatedViewport.width}px`;
      layer.style.height = `${unrotatedViewport.height}px`;
      void textLayer.render().catch(() => {
        // 文本层失败不影响看图；选区能力降级而已
      });
      await renderTask.promise;
    };
    void render().catch(() => {
      if (!cancelled) setError(t("panels.files.pdfPageFailed"));
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [pdfPage, pdfjs, size, t]);

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
      <div className={styles.toolbar}>
        {documentState && (
          <>
            <div className={styles.controls}>
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
            <div className={styles.controls}>
              <button
                type="button"
                className={styles.button}
                disabled={!size || size.zoom <= PDF_MIN_ZOOM}
                onClick={() => size && setZoom((value) => stepPdfZoom(value ?? size.zoom, -1))}
                title={t("panels.files.pdfZoomOut")}
                aria-label={t("panels.files.pdfZoomOut")}
              >
                <MagnifyingGlassMinus size={16} weight="regular" />
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.zoomValue}`}
                disabled={!size}
                onClick={() => setZoom(1)}
                title={t("panels.files.pdfActualSize")}
                aria-label={t("panels.files.pdfActualSize")}
              >
                {size ? `${Math.round(size.zoom * 100)}%` : "—"}
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={!size || size.zoom >= PDF_MAX_ZOOM}
                onClick={() => size && setZoom((value) => stepPdfZoom(value ?? size.zoom, 1))}
                title={t("panels.files.pdfZoomIn")}
                aria-label={t("panels.files.pdfZoomIn")}
              >
                <MagnifyingGlassPlus size={16} weight="regular" />
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={!size}
                onClick={() => setZoom(null)}
                title={t("panels.files.pdfFitWidth")}
                aria-label={t("panels.files.pdfFitWidth")}
                aria-pressed={zoom === null}
              >
                <ArrowsHorizontal size={16} weight="regular" />
              </button>
            </div>
          </>
        )}
      </div>
      <section
        className={styles.canvasWrap}
        ref={canvasWrapRef}
        aria-label={t("panels.files.pdfPreview")}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable page needs keyboard access.
        tabIndex={0}
      >
        {documentState ? (
          <div className={styles.page}>
            <canvas ref={canvasRef} />
            <div ref={textLayerRef} className={styles.textLayer} data-selectable-text="" />
          </div>
        ) : (
          <p className={panelStyles.noMatch}>{t("panels.files.loading")}</p>
        )}
      </section>
    </div>
  );
}
