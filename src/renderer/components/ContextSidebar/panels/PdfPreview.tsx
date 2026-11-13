import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import type { FsReadPdfResult } from "../../../../shared/ipc";
import { useT } from "../../../hooks/useT";
import panelStyles from "./FilePanel.module.css";
import styles from "./PdfPreview.module.css";

interface PdfPreviewProps {
  result: FsReadPdfResult;
}

const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_PAGE_SCALE = 1.35;

export function PdfPreview({ result }: PdfPreviewProps) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [documentState, setDocumentState] = useState<PDFDocumentProxy | null>(null);
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
    setPage(1);
    void import("pdfjs-dist/build/pdf.mjs")
      .then(async (pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        // PDF.js transfers typed-array buffers to its worker; keep IPC preview state reusable.
        loadingTask = pdfjs.getDocument({ data: result.data.slice() });
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        const document = await loadingTask.promise;
        if (!cancelled) setDocumentState(document);
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
    if (!documentState || !canvasRef.current || availableWidth <= 0) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    void documentState
      .getPage(page)
      .then((pdfPage) => {
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
        return renderTask.promise;
      })
      .catch(() => {
        if (!cancelled) setError(t("panels.files.pdfPageFailed"));
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [availableWidth, documentState, page, t]);

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
        </div>
      )}
      <div className={styles.canvasWrap} ref={canvasWrapRef}>
        {documentState ? (
          <canvas ref={canvasRef} />
        ) : (
          <p className={panelStyles.noMatch}>{t("panels.files.loading")}</p>
        )}
      </div>
    </div>
  );
}
