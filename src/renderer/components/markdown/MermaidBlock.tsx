import { Code, Copy, Graph, MagnifyingGlassPlus } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { useT } from "../../hooks/useT";
import { useUiStore } from "../../stores/uiStore";
import { prepareMermaid } from "../../utils/mermaidLoader";
import { ImageLightbox } from "../SessionArea/ImageLightbox";
import styles from "./MermaidBlock.module.css";
import fenceStyles from "./markdown.module.css";

/** mermaid 实例的 render id 递增：同 id 重复渲染会命中上一张图的残留节点。 */
let renderSeq = 0;

/** SVG 走 `<img>` 需要 data URL；btoa 处理不了中文字符，用百分号编码。 */
function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

type GraphState = { kind: "pending" } | { kind: "ok"; svg: string } | { kind: "failed" };

interface MermaidBlockProps {
  /** 围栏内的图表源码。 */
  code: string;
  /** 非图态内容：沿用 FenceShell 原分支产物的 `<pre>`（源码 / 失败回退都靠它）。 */
  source: ReactNode;
  /** 复制按钮开关，跟随围栏的 codeCopy。 */
  codeCopy: boolean;
}

/**
 * ` ```mermaid ` 围栏的图表块（docs/design/125）：自带围栏外壳（沿用 .fence 一套类，
 * 与代码围栏视觉一致），状态为 pending / ok / failed，失败与源码视图都回退到
 * `<pre>` 原文——模型写的 mermaid 常有语法错，白屏等于把内容也一起吞了。
 *
 * 只在块定型后由 FenceShell 挂载：流式期间半截围栏必然解析失败，逐 delta 试错会让
 * 图反复闪、每次重排整段对话，那时维持普通源码围栏的渲染。
 */
export function MermaidBlock({ code, source, codeCopy }: MermaidBlockProps) {
  const t = useT();
  const theme = useResolvedTheme();
  const { showToast } = useUiStore();
  const [graph, setGraph] = useState<GraphState>({ kind: "pending" });
  /** 用户手动切到源码视图；graph 变了要复位，否则新图永远看不见。 */
  const [showSource, setShowSource] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const graphRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // 换源码 = 换图：视图选择器回到「图」，别让上一次的源码视图盖住新图
    setShowSource(false);
    setGraph({ kind: "pending" });
    void (async () => {
      try {
        const mermaid = await prepareMermaid(theme === "light" ? "default" : "dark");
        // suppressErrors：不合法时返回 false，避免 mermaid 往控制台与 DOM 写错误标记
        const valid = await mermaid.parse(code, { suppressErrors: true });
        if (!valid) {
          if (!cancelled) setGraph({ kind: "failed" });
          return;
        }
        renderSeq += 1;
        const { svg } = await mermaid.render(`pidesk-mmd-${renderSeq}`, code);
        if (!cancelled) setGraph({ kind: "ok", svg });
      } catch {
        if (!cancelled) setGraph({ kind: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  const svg = graph.kind === "ok" ? graph.svg : null;
  const showingGraph = svg !== null && !showSource;

  // mermaid 只写 max-width（= 自然宽度），容器比它窄时整张图会被等比缩到看不清。
  // 同值补一份 min-width：窄图按自然宽不放大，宽图按自然宽横向滚动。
  // 图区是条件渲染，切回「图」时节点是新的，所以 showSource 也在依赖里。
  useEffect(() => {
    if (!svg || showSource) return;
    const target = graphRef.current?.querySelector("svg");
    if (!target) return;
    const natural = target.style.maxWidth;
    if (natural && natural !== "none" && natural !== "100%") target.style.minWidth = natural;
  }, [svg, showSource]);

  const header = (
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
            <MagnifyingGlassPlus size={14} weight="regular" />
          </button>
        )}
        {svg !== null && (
          <button
            type="button"
            className={fenceStyles.fenceCopy}
            title={t(showingGraph ? "common.mermaid.showSource" : "common.mermaid.showGraph")}
            aria-label={t(showingGraph ? "common.mermaid.showSource" : "common.mermaid.showGraph")}
            onClick={() => setShowSource((value) => !value)}
          >
            {showingGraph ? (
              <Code size={14} weight="regular" />
            ) : (
              <Graph size={14} weight="regular" />
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
            <Copy size={14} weight="regular" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className={fenceStyles.fence}>
      {header}
      {showingGraph ? (
        <div
          ref={graphRef}
          className={styles.graph}
          role="img"
          aria-label={t("common.mermaid.diagram")}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: securityLevel 为 strict，mermaid 输出已经 DOMPurify 消毒
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        source
      )}
      {graph.kind === "failed" && (
        <div className={styles.hint}>{t("common.mermaid.renderFailed")}</div>
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
