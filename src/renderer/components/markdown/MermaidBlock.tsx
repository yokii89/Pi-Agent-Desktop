import { Code, Copy, Graph, ImageSquare, MagnifyingGlassPlus } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { resolveFontUiStack } from "../../../shared/fontPresets";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { useT } from "../../hooks/useT";
import { clipboardService } from "../../services/clipboardService";
import { useUiStore } from "../../stores/uiStore";
import { elementToPng } from "../../utils/elementToPng";
import { namespaceMermaidSvg, renderMermaid } from "../../utils/mermaidRenderer";
import { ImageLightbox } from "../SessionArea/ImageLightbox";
import styles from "./MermaidBlock.module.css";
import fenceStyles from "./markdown.module.css";

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

type GraphState = { kind: "pending" } | { kind: "ok"; svg: string } | { kind: "failed" };

interface MermaidBlockProps {
  code: string;
  /** 围栏源码与解析失败的回退内容。 */
  source: ReactNode;
  codeCopy: boolean;
  /** 独立文件提供图像复制；已有围栏维持原来的操作组。 */
  imageCopy?: boolean;
  /** 独立文件把源码交回 FilePanel 的 CodeMirror；围栏继续在块内切换。 */
  onShowSource?: () => void;
}

/** Mermaid 围栏与独立文件共用出图、宽图滚动、主题和放大能力。 */
export function MermaidBlock({
  code,
  source,
  codeCopy,
  imageCopy = false,
  onShowSource,
}: MermaidBlockProps) {
  const t = useT();
  const theme = useResolvedTheme();
  const { showToast, fontUiPreset } = useUiStore();
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "_");
  const fontFamily = resolveFontUiStack(fontUiPreset);
  const [readyToRender, setReadyToRender] = useState(false);
  const fenceRef = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState<GraphState>({ kind: "pending" });
  const [showSource, setShowSource] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [copyingImage, setCopyingImage] = useState(false);
  const graphRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fence = fenceRef.current;
    if (!fence) return;
    // 长文档先展示源码占位；接近视口才下载引擎与布局，隐藏页签也不会抢占首屏。
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setReadyToRender(true);
        observer.disconnect();
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(fence);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!readyToRender) return;
    const controller = new AbortController();
    setShowSource(false);
    setZoomed(false);
    setGraph({ kind: "pending" });
    void renderMermaid(
      { code, theme: theme === "light" ? "default" : "dark", fontFamily },
      controller.signal,
    )
      .then((svg) => {
        if (controller.signal.aborted) return;
        setGraph(
          svg === null
            ? { kind: "failed" }
            : { kind: "ok", svg: namespaceMermaidSvg(svg, `pidesk-diagram-${instanceId}`) },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setGraph({ kind: "failed" });
      });
    return () => controller.abort();
  }, [code, theme, fontFamily, instanceId, readyToRender]);

  const svg = graph.kind === "ok" ? graph.svg : null;
  const showingGraph = svg !== null && !showSource;

  // Mermaid 只写 max-width；补同值 min-width，宽图按自然尺寸滚动，避免挤成小图。
  useEffect(() => {
    if (!svg || showSource) return;
    const target = graphRef.current?.querySelector("svg");
    if (!target) return;
    const natural = target.style.maxWidth;
    if (natural && natural !== "none" && natural !== "100%") target.style.minWidth = natural;
  }, [svg, showSource]);

  const copyGraphImage = (): void => {
    const element = graphRef.current;
    if (!element || copyingImage) return;
    setCopyingImage(true);
    void elementToPng(element, { expandWidth: true, expandHeight: true })
      .then((png) => clipboardService.writeImageDataUrl(png.dataUrl))
      .then(() => showToast(t("common.mermaid.imageCopied")))
      .catch(() => showToast(t("common.copyFailed")))
      .finally(() => setCopyingImage(false));
  };

  return (
    <div ref={fenceRef} className={fenceStyles.fence}>
      <div className={fenceStyles.fenceHeader}>
        <span className={fenceStyles.fenceLang}>mermaid</span>
        <div className={styles.actions}>
          {showingGraph && (
            <button
              type="button"
              className={fenceStyles.fenceCopy}
              title={t("common.mermaid.zoom")}
              aria-label={t("common.mermaid.zoom")}
              onClick={() => setZoomed(true)}
            >
              <MagnifyingGlassPlus size={16} weight="regular" />
            </button>
          )}
          {showingGraph && imageCopy && (
            <button
              type="button"
              className={fenceStyles.fenceCopy}
              title={t("common.copyCodeImage")}
              aria-label={t("common.copyCodeImage")}
              disabled={copyingImage}
              onClick={copyGraphImage}
            >
              <ImageSquare size={16} weight="regular" />
            </button>
          )}
          {(svg !== null || onShowSource) && (
            <button
              type="button"
              className={fenceStyles.fenceCopy}
              title={t(
                onShowSource || showingGraph
                  ? "common.mermaid.showSource"
                  : "common.mermaid.showGraph",
              )}
              aria-label={t(
                onShowSource || showingGraph
                  ? "common.mermaid.showSource"
                  : "common.mermaid.showGraph",
              )}
              onClick={() => (onShowSource ? onShowSource() : setShowSource((value) => !value))}
            >
              {onShowSource || showingGraph ? (
                <Code size={16} weight="regular" />
              ) : (
                <Graph size={16} weight="regular" />
              )}
            </button>
          )}
          {codeCopy && (
            <button
              type="button"
              className={fenceStyles.fenceCopy}
              title={t("common.copyCode")}
              aria-label={t("common.copyCode")}
              onClick={() => {
                void navigator.clipboard
                  .writeText(code)
                  .then(() => showToast(t("common.copied")))
                  .catch(() => showToast(t("common.copyFailed")));
              }}
            >
              <Copy size={16} weight="regular" />
            </button>
          )}
        </div>
      </div>
      {showingGraph ? (
        <div
          ref={graphRef}
          className={styles.graph}
          role="img"
          aria-label={t("common.mermaid.diagram")}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid strict 模式的输出经 DOMPurify 消毒。
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        source
      )}
      {graph.kind === "failed" && (
        <div className={styles.hint} role="status">
          {t("common.mermaid.renderFailed")}
        </div>
      )}
      {zoomed && svg !== null && (
        <ImageLightbox
          images={[{ src: svgToDataUrl(svg), name: t("common.mermaid.diagram") }]}
          index={0}
          onClose={() => setZoomed(false)}
        />
      )}
    </div>
  );
}
