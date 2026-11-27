import { Copy, ImageSquare } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { isValidElement, memo, useMemo, useRef, useState } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { useT } from "../../hooks/useT";
import { clipboardService } from "../../services/clipboardService";
import { useUiStore } from "../../stores/uiStore";
import { countCodeLines } from "../../utils/codeLines";
import { elementToPng } from "../../utils/elementToPng";
import { isExternalHttpUrl } from "../../utils/linkify";
import { markdownUrlTransform } from "../../utils/markdownImageSource";
import { normalizeMathDelimiters } from "../../utils/markdownMath";
import { normalizeFenceLang, resolveMarkdownRef } from "../../utils/markdownRefs";
import { canRenderMermaid } from "../../utils/mermaidPreview";
import { FileLink, looksLikeFilePath } from "../SessionArea/FileLink";
import { CodeHighlight } from "../ui/CodeHighlight";
import { UrlLink } from "../ui/UrlLink";
import { LocalMarkdownLink } from "./LocalMarkdownLink";
import { MarkdownImage, MarkdownImageLinkContext } from "./MarkdownImage";
import { MarkdownTable } from "./MarkdownTable";
import { MathFormula } from "./MathFormula";
import { MermaidBlock } from "./MermaidBlock";
import styles from "./markdown.module.css";

/** 模块级常量：避免每次 render 新建插件数组导致 memo 失效。 */
const remarkPlugins = [remarkGfm, remarkMath];
/** 会话流（breaks 开）：软换行渲染为 <br>，与不含 breaks 的数组分开持有，防 memo 失效。 */
const remarkPluginsWithBreaks = [remarkGfm, remarkMath, remarkBreaks];

/** 流式代码块高亮护栏（docs/design/10 §3.9）：超过即退回纯 <pre>，避免长代码拖慢流式。 */
const MAX_HIGHLIGHT_CHARS = 20_000;
const MAX_HIGHLIGHT_LINES = 200;

interface MarkdownDocProps {
  text: string;
  /** 覆盖根节点类名（muted 思考流 / 附加包装样式）。 */
  className?: string;
  /**
   * 源文件路径：提供后按 Markdown 处理本地引用——相对图片解析为 dataUrl、
   * 相对链接在文件面板内跳转。会话区用 imageBaseDir 提供图片目录。
   */
  sourcePath?: string | null;
  /** 会话工作目录，仅用于图片相对路径；sourcePath 提供时优先按源文档定位。 */
  imageBaseDir?: string | null;
  /** 普通插图点击进入图片查看器；图片链接仍执行链接动作。 */
  imagePreview?: boolean;
  /** 块级围栏代码用 shiki 高亮（文件面板预览开，会话区维持现状关）。 */
  codeHighlight?: boolean;
  /** 块级代码块外壳右上角加「复制为图片 / 复制为文本」（会话区开，docs/design/136）。 */
  codeCopy?: boolean;
  /**
   * 软换行渲染为 <br>（docs/design/29 缺陷 E）：模型输出的「序号行 + 单换行 + 正文」
   * 是段内换行语义。默认 false——文件面板预览与 ExtensionView 保持 CommonMark 折叠。
   */
  breaks?: boolean;
  /** ` ```mermaid ` 围栏渲染成图表（docs/design/125）。关闭时维持普通源码围栏。 */
  mermaid?: boolean;
  /**
   * 表格右上角工具条（docs/design/135）：会话区开「复制为图片 / 复制 Markdown」。
   * 与 codeCopy 同一口径——文件面板预览与 ExtensionView 只保留表格本体。
   */
  tableTools?: boolean;
  /**
   * 流式态：mermaid 只在块定型后出图，半途只走源码分支（docs/design/125）。
   * 半截围栏必然解析失败，逐 delta 试错会让图反复闪并重排整段对话。
   */
  streaming?: boolean;
}

/** 提取围栏 code 的纯文本（react-markdown 的 code children 就是字符串，此为兜底）。 */
function flattenText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  return "";
}

/**
 * 块级围栏统一外壳（docs/design/13 P1-5、136）：语言标签 + 右上角动作组 + 可选 shiki 高亮。
 * - 单行走紧凑态（docs/design/85）：不出头部行，代码与动作组同一行、垂直居中，
 *   语言标签与高亮都不出现，无语言 / 有语言的单行长得完全一样；
 * - mermaid 围栏整块交给 MermaidBlock（外壳与头部由它自己按同一套类渲染）；
 * - 有语言且未超护栏 → CodeHighlight（shiki，双主题）；
 * - 无语言 / 超护栏 / 未开高亮 → 纯 <pre>；
 * - 动作组随 codeCopy 开关（会话区开）：复制为图片 / 复制为文本；
 *   容器带 `data-capture-skip`，成像时连按钮一起摘掉，图片里不会出现自己。
 * 挂在 components.pre 上，CodeHighlight 自带 <pre>，避免嵌套。
 */
function FenceShell({
  children,
  codeHighlight,
  codeCopy,
  mermaid,
  streaming,
}: {
  children?: ReactNode;
  codeHighlight: boolean;
  codeCopy: boolean;
  mermaid: boolean;
  streaming: boolean;
}) {
  const { showToast } = useUiStore();
  const t = useT();
  const fenceRef = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(false);
  const child = isValidElement(children)
    ? (children.props as { className?: string; children?: ReactNode })
    : null;
  const match = /language-([\w+#.-]+)/.exec(child?.className ?? "");
  const lang = match ? normalizeFenceLang(match[1]) : null;
  const knownLang = lang !== null && lang !== "plaintext";
  const code = flattenText(child?.children).replace(/\n$/, "");
  // 空围栏仍走原路径：紧凑态是给「一行内容」用的，空块没有可居中的东西
  const singleLine = code.length > 0 && countCodeLines(code) <= 1;
  if (mermaid && !streaming && lang === "mermaid" && !singleLine && canRenderMermaid(code)) {
    return <MermaidBlock code={code} codeCopy={codeCopy} source={<pre>{children}</pre>} />;
  }
  const highlightable =
    !singleLine &&
    codeHighlight &&
    knownLang &&
    code.length <= MAX_HIGHLIGHT_CHARS &&
    countCodeLines(code) <= MAX_HIGHLIGHT_LINES;
  const copyText = (): void => {
    void navigator.clipboard
      .writeText(code)
      .then(() => showToast(t("common.copied")))
      .catch(() => showToast(t("common.copyFailed")));
  };
  const copyImage = (): void => {
    const el = fenceRef.current;
    if (!el || rendering) return;
    setRendering(true);
    void elementToPng(el, { expandWidth: true })
      .then((png) => clipboardService.writeImageDataUrl(png.dataUrl))
      .then(() => showToast(t("common.codeImageCopied")))
      .catch(() => showToast(t("common.copyFailed")))
      .finally(() => setRendering(false));
  };
  const tools = codeCopy ? (
    <div className={styles.fenceActions} data-capture-skip="">
      <button
        type="button"
        className={styles.fenceCopy}
        title={t("common.copyCodeImage")}
        aria-label={t("common.copyCodeImage")}
        disabled={rendering}
        onClick={copyImage}
      >
        <ImageSquare size={14} weight="regular" />
      </button>
      <button
        type="button"
        className={styles.fenceCopy}
        title={t("common.copyCodeText")}
        aria-label={t("common.copyCodeText")}
        onClick={copyText}
      >
        <Copy size={14} weight="regular" />
      </button>
    </div>
  ) : null;
  return (
    <div
      ref={fenceRef}
      className={[styles.fence, singleLine ? styles.fenceCompact : ""].filter(Boolean).join(" ")}
    >
      {!singleLine && (knownLang || codeCopy) && (
        <div className={styles.fenceHeader}>
          <span className={styles.fenceLang}>{knownLang ? lang : t("common.codePlainText")}</span>
          {tools}
        </div>
      )}
      {highlightable ? (
        <CodeHighlight code={code} lang={lang ?? undefined} />
      ) : (
        <pre>{children}</pre>
      )}
      {singleLine && tools}
    </div>
  );
}

/** Markdown 内链接：本地路径在面板内跳转，目录交资源管理器；http(s) 交系统浏览器；
 * 其余协议降级死链。会话区（无 sourcePath）同样必须接管——默认 <a> 会把整个应用导航走
 * （docs/design/13 P0-1）。外链形态与输入栏、用户气泡同源（docs/design/131）。 */
function MarkdownLink({
  sourcePath,
  baseDir,
  href,
  imageContent,
  children,
}: {
  sourcePath: string | null;
  baseDir?: string | null;
  href?: string;
  imageContent: boolean;
  children?: ReactNode;
}) {
  if (typeof href !== "string" || href === "") {
    return <span className={styles.mdLinkDead}>{children}</span>;
  }
  const resolved = resolveMarkdownRef(href, sourcePath, baseDir);
  if (resolved) return <LocalMarkdownLink path={resolved}>{children}</LocalMarkdownLink>;
  if (isExternalHttpUrl(href)) {
    // 徽标型链接 `[![CI](shield.png)](https://…)` 不加图标：图本身已是标识，
    // 再补一枚站点图标会让 README 里成排的徽章左边多出一列小图（docs/design/131）。
    return (
      <UrlLink url={href} withIcon={!imageContent}>
        {children}
      </UrlLink>
    );
  }
  return <span className={styles.mdLinkDead}>{children}</span>;
}

/**
 * hast 子树里是否出现 img（即徽标型链接）。认 AST 而不是认 React 元素：文件面板把 img
 * 换成了组件映射里的匿名组件，按组件身份比会漏，连带多发一次 favicon 抓取
 * （docs/design/131 探针抓到的一条真缺陷）。
 */
function hastHasImage(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const el = node as { tagName?: string; children?: unknown[] };
  if (el.tagName === "img") return true;
  return (el.children ?? []).some(hastHasImage);
}

function buildComponents(opts: {
  sourcePath?: string | null;
  imageBaseDir?: string | null;
  imagePreview?: boolean;
  codeHighlight?: boolean;
  codeCopy?: boolean;
  mermaid?: boolean;
  tableTools?: boolean;
  streaming?: boolean;
}): Components {
  const components: Components = {
    pre({ children }) {
      const child = isValidElement(children)
        ? (children.props as { className?: string; children?: ReactNode })
        : null;
      if (child?.className?.split(" ").includes("math-display")) {
        return <MathFormula source={flattenText(child.children).replace(/\n$/, "")} display />;
      }
      return opts.codeHighlight || opts.codeCopy || opts.mermaid ? (
        <FenceShell
          codeHighlight={opts.codeHighlight ?? false}
          codeCopy={opts.codeCopy ?? false}
          mermaid={opts.mermaid ?? false}
          streaming={opts.streaming ?? false}
        >
          {children}
        </FenceShell>
      ) : (
        <pre>{children}</pre>
      );
    },
    // 行内 / 无语言 code：像文件路径时升级 FileLink（会话区原样保留）
    code({ className, children, ...props }) {
      if (className?.split(" ").includes("math-inline")) {
        return <MathFormula source={flattenText(children)} />;
      }
      if (!className) {
        const text = String(children ?? "").trim();
        if (looksLikeFilePath(text)) return <FileLink path={text} />;
      }
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    // 链接无条件接管，避免本地路径或外链把整个应用导航走。
    a: (props) => (
      <MarkdownImageLinkContext
        value={
          isExternalHttpUrl(props.href) ||
          resolveMarkdownRef(props.href ?? "", opts.sourcePath, opts.imageBaseDir) !== null
        }
      >
        <MarkdownLink
          sourcePath={opts.sourcePath ?? null}
          baseDir={opts.imageBaseDir}
          href={props.href}
          imageContent={hastHasImage(props.node)}
        >
          {props.children}
        </MarkdownLink>
      </MarkdownImageLinkContext>
    ),
    img: (props) => (
      <MarkdownImage
        sourcePath={opts.sourcePath}
        baseDir={opts.imageBaseDir}
        preview={opts.imagePreview}
        src={props.src}
        alt={props.alt}
        title={props.title}
      />
    ),
    // 表格一律套外壳：圆角卡片 + 横向滚动容器（docs/design/135）。
    // 工具条只在会话区开，组件始终复用同一条渲染路径。
    table: (props) => (
      <MarkdownTable node={props.node} tools={opts.tableTools ?? false}>
        {props.children}
      </MarkdownTable>
    ),
  };
  return components;
}

/**
 * Markdown 文档流渲染（GFM）：会话区与文件面板共用的内核。
 * 字号由包装层决定（.md 根 font-size: inherit），行内间距随 tokens 缩放。
 */
export const MarkdownDoc = memo(function MarkdownDoc({
  text,
  className,
  sourcePath,
  imageBaseDir,
  imagePreview,
  codeHighlight,
  codeCopy,
  breaks = false,
  mermaid = false,
  tableTools = false,
  streaming = false,
}: MarkdownDocProps) {
  // 稳定组件身份：正文增量不应重新挂载已加载的图片或重启文件读取。
  const components = useMemo(
    () =>
      buildComponents({
        sourcePath,
        imageBaseDir,
        imagePreview,
        codeHighlight,
        codeCopy,
        mermaid,
        tableTools,
        streaming,
      }),
    [
      sourcePath,
      imageBaseDir,
      imagePreview,
      codeHighlight,
      codeCopy,
      mermaid,
      tableTools,
      streaming,
    ],
  );
  return (
    <div className={[styles.md, className].filter(Boolean).join(" ")}>
      <Markdown
        remarkPlugins={breaks ? remarkPluginsWithBreaks : remarkPlugins}
        components={components}
        urlTransform={markdownUrlTransform}
      >
        {normalizeMathDelimiters(text)}
      </Markdown>
    </div>
  );
});
