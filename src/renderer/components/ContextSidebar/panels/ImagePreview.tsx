import { useEffect, useRef, useState } from "react";
import type { FsPreviewImageResult } from "../../../../shared/ipc";
import { useT } from "../../../hooks/useT";
import type {
  ImagePreviewRequest,
  ImagePreviewResponse,
} from "../../../utils/imagePreviewProtocol";
import panelStyles from "./FilePanel.module.css";

/** Static rasters use a bounded worker surface; animated/vector formats keep native rendering. */
export function ImagePreview({
  result,
  path,
  onImageSize,
  onOpenInSystem,
}: {
  result: FsPreviewImageResult;
  path: string;
  onImageSize: (size: string | null) => void;
  onOpenInSystem: () => void;
}) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [native, setNative] = useState(
    !["image/png", "image/jpeg", "image/bmp"].includes(result.mime),
  );
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");

  useEffect(() => {
    onImageSize(null);
    if (native) return;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let worker: Worker;
    try {
      worker = new Worker(new URL("../../../workers/imagePreview.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      setNative(true);
      return;
    }
    let disposed = false;
    let id = 0;
    let lastWidth = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resize = (): void => {
      // Bucketing and debouncing avoid re-decoding for each pixel of a sidebar drag.
      const css = getComputedStyle(wrap);
      const width =
        wrap.clientWidth - Number.parseFloat(css.paddingLeft) - Number.parseFloat(css.paddingRight);
      if (width <= 0) return;
      const targetWidth = Math.min(2048, Math.ceil((width * window.devicePixelRatio) / 64) * 64);
      if (targetWidth === lastWidth) return;
      lastWidth = targetWidth;
      const request: ImagePreviewRequest = {
        id: ++id,
        url: result.url,
        mime: result.mime,
        width: targetWidth,
      };
      worker.postMessage(request);
    };
    worker.onmessage = (event: MessageEvent<ImagePreviewResponse>): void => {
      const message = event.data;
      if (disposed || message.id !== id) {
        if (message.type === "bitmap") message.bitmap.close();
        return;
      }
      if (message.type === "native") {
        setNative(true);
        return;
      }
      if (message.type === "error") {
        worker.terminate();
        setStatus("failed");
        return;
      }
      try {
        const context = canvas.getContext("2d");
        if (!context) {
          setNative(true);
          return;
        }
        canvas.width = message.bitmap.width;
        canvas.height = message.bitmap.height;
        canvas.style.width = `${message.width}px`;
        context.drawImage(message.bitmap, 0, 0);
        onImageSize(`${message.width}×${message.height}`);
        setStatus("loaded");
      } finally {
        message.bitmap.close();
      }
    };
    worker.onerror = () => setNative(true);
    const scheduleResize = (): void => {
      clearTimeout(timer);
      timer = setTimeout(resize, 150);
    };
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(wrap);
    window.addEventListener("resize", scheduleResize);
    resize();
    return () => {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", scheduleResize);
      worker.terminate();
      canvas.width = canvas.height = 1;
    };
  }, [native, result.url, result.mime, onImageSize]);

  return (
    <div ref={wrapRef} className={panelStyles.imageWrap} aria-busy={status === "loading"}>
      {status !== "failed" &&
        (native ? (
          <img
            className={panelStyles.image}
            src={result.url}
            alt={path}
            decoding="async"
            draggable={false}
            onLoad={(event) => {
              onImageSize(
                `${event.currentTarget.naturalWidth}×${event.currentTarget.naturalHeight}`,
              );
              setStatus("loaded");
            }}
            onError={() => {
              onImageSize(null);
              setStatus("failed");
            }}
          />
        ) : (
          <canvas
            ref={canvasRef}
            className={panelStyles.image}
            role="img"
            aria-label={path}
            hidden={status !== "loaded"}
          />
        ))}
      {status !== "loaded" && (
        <div className={panelStyles.binaryWrap} data-selectable-text="">
          <p className={panelStyles.binaryMeta} role="status">
            {status === "failed" ? t("common.imageLoadFailed", { src: path }) : t("common.loading")}
          </p>
          {status === "failed" && (
            <button type="button" className={panelStyles.binaryAction} onClick={onOpenInSystem}>
              {t("panels.files.openInSystem")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
