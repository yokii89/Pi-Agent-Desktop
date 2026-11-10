import { Copy, ImageSquare } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { isValidElement, memo, useEffect, useRef, useState } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { isHtmlPath } from "../../../shared/fileKinds";
import { useT } from "../../hooks/useT";
import { clipboardService } from "../../services/clipboardService";
import { fsService } from "../../services/fsService";
import { useBrowserStore } from "../../stores/browserStore";
import { useUiStore } from "../../stores/uiStore";
import { elementToPng } from "../../utils/elementToPng";
import { isExternalHttpUrl } from "../../utils/linkify";
import { normalizeFenceLang, resolveMarkdownRef } from "../../utils/markdownRefs";
import { FileLink, looksLikeFilePath } from "../SessionArea/FileLink";
import { CodeHighlight, countCodeLines } from "../ui/CodeHighlight";
import { UrlLink } from "../ui/UrlLink";
import { MarkdownTable } from "./MarkdownTable";
import { MermaidBlock } from "./MermaidBlock";
import styles from "./markdown.module.css";

/** 模块级常量：避免每次 render 新建插件数组导致 memo 失效。 */
const remarkPlugins = [remarkGfm];
/** 会话流（breaks 开）：软换行渲染为 <br>，与不含 breaks 的数组分开持有，防 memo 失效。 */
const remarkPluginsWithBreaks = [remarkGfm, remarkBreaks];

/** 流式代码块高亮护栏（docs/design/10 §3.9）：超过即退回纯 <pre>，避免长代码拖慢流式。 */
const MAX_HIGHLIGHT_CHARS = 20_000;
const MAX_HIGHLIGHT_LINES = 200;

/**
 * mermaid 出图护栏（docs/design/125）：渲染代价随节点数增长，超限直接留在源码视图，
 * 不让模型偶尔吐出的巨型图把渲染进程卡住。
 */
const MAX_MERMAID_CHARS = 8_000;
const MAX_MERMAID_LINES = 200;

/** 本地图片 dataUrl 缓存：同一文件多次引用 / 重渲染只读一次盘。 */
const imageDataUrlCache = new Map<string, Promise<string | null>>();
const IMAGE_CACHE_LIMIT = 24;
/** 单图缓存上限：大图不驻留内存（预览多个含大图文档时 dataUrl 很占）。 */
const IMAGE_CACHE_MAX_ENTRY_BYTES = 2 * 1024 * 1024;

function loadImageDataUrl(path: string): Promise<string | null> {
  const hit = imageDataUrlCache.get(path);
  if (hit) return hit;
  const promise = fsService
    .read(path)
    .then((result) => {
      if (result.kind !== "image") return null;
      // 超上限的大图只返回不入缓存，用完即回收
      if (result.dataUrl.length > IMAGE_CACHE_MAX_ENTRY_BYTES) return result.dataUrl;
      if (imageDataUrlCache.size >= IMAGE_CACHE_LIMIT) imageDataUrlCache.clear();
      imageDataUrlCache.set(path, promise);
      return result.dataUrl;
    })
    .catch(() => null);
  return promise;
}

interface MarkdownDocProps {
  text: string;
  /** 覆盖根节点类名（muted 思考流 / 附加包装样式）。 */
  className?: string;
  /**
   * 源文件路径：提供后按 Markdown 处理本地引用——相对图片解析为 dataUrl、
   * 相对链接在文件面板内跳转。会话区（无文件语境）不传，维持原渲染。
   */
  sourcePath?: string | null;
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
  if (
    mermaid &&
    !streaming &&
    lang === "mermaid" &&
    !singleLine &&
    code.length <= MAX_MERMAID_CHARS &&
    countCodeLines(code) <= MAX_MERMAID_LINES
  ) {
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
          <span className={styles.fenceLang}>{knownLang ? lang : ""}</span>
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

/** Markdown 内本地图片：相对路径解析 → fs 读取 → dataUrl（缓存）；失败显示占位。 */
function MarkdownImg({ sourcePath, src, alt }: { sourcePath: string; src?: string; alt?: string }) {
  const t = useT();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // 先清旧态：元素被 React 复用（换文件同位置）时不能残留上一张图
    setDataUrl(null);
    if (typeof src !== "string" || src.trim() === "") {
      setFailed(true);
      return;
    }
    // data: 引用 CSP 已放行，直通
    if (/^data:/i.test(src)) {
      setDataUrl(src);
      setFailed(false);
      return;
    }
    const resolved = resolveMarkdownRef(src, sourcePath);
    if (!resolved) {
      // http(s) 远程图生产 CSP 不放行（img-src 'self' data:），按失败占位
      setFailed(true);
      return;
    }
    let cancelled = false;
    setFailed(false);
    loadImageDataUrl(resolved).then((url) => {
      if (cancelled) return;
      if (url) setDataUrl(url);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [src, sourcePath]);

  if (dataUrl) {
    return <img className={styles.mdImg} src={dataUrl} alt={alt ?? ""} draggable={false} />;
  }
  if (failed) {
    return (
      <span className={styles.mdImgBroken}>{t("common.imageLoadFailed", { src: src ?? "" })}</span>
    );
  }
  return null;
}

/** Markdown 内链接：有源文件语境时本地路径在面板内跳转；http(s) 一律交系统浏览器；
 * 其余协议降级死链。会话区（无 sourcePath）同样必须接管——默认 <a> 会把整个应用导航走
 * （docs/design/13 P0-1）。外链形态与输入栏、用户气泡同源（docs/design/131）。 */
function MarkdownLink({
  sourcePath,
  href,
  imageContent,
  children,
}: {
  sourcePath: string | null;
  href?: string;
  imageContent: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  const { dispatch } = useUiStore();
  const browser = useBrowserStore();

  if (typeof href !== "string" || href === "") {
    return <span className={styles.mdLinkDead}>{children}</span>;
  }
  if (sourcePath != null) {
    const resolved = resolveMarkdownRef(href, sourcePath);
    if (resolved) {
      // HTML 链接的「预览」就是浏览器渲染：直达 file:// 通道而非源码视图
      if (isHtmlPath(resolved)) {
        return (
          <a
            href={href}
            title={t("common.openInBrowserPath", { path: resolved })}
            onClick={(event) => {
              event.preventDefault();
              void browser.openLocalFile(resolved);
            }}
          >
            {children}
          </a>
        );
      }
      return (
        <a
          href={href}
          title={t("common.openInFilesPath", { path: resolved })}
          onClick={(event) => {
            event.preventDefault();
            dispatch({ type: "openFileInPanel", path: resolved });
          }}
        >
          {children}
        </a>
      );
    }
  }
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
  codeHighlight?: boolean;
  codeCopy?: boolean;
  mermaid?: boolean;
  tableTools?: boolean;
  streaming?: boolean;
}): Components {
  const components: Components = {
    // 行内 / 无语言 code：像文件路径时升级 FileLink（会话区原样保留）
    code({ className, children, ...props }) {
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
    // a 无条件接管（docs/design/13 P0-1）：有源文件语境解析本地路径，
    // 会话区至少拦下 http(s) 外链，其余协议降级死链，禁止应用内导航
    a: (props) => (
      <MarkdownLink
        sourcePath={opts.sourcePath ?? null}
        href={props.href}
        imageContent={hastHasImage(props.node)}
      >
        {props.children}
      </MarkdownLink>
    ),
    // 表格一律套外壳：圆角卡片 + 横向滚动容器（docs/design/135）。
    // 工具条只在会话区开，组件始终复用同一条渲染路径。
    table: (props) => (
      <MarkdownTable node={props.node} tools={opts.tableTools ?? false}>
        {props.children}
      </MarkdownTable>
    ),
  };
  if (opts.codeHighlight || opts.codeCopy || opts.mermaid) {
    components.pre = (props) => (
      <FenceShell
        codeHighlight={opts.codeHighlight ?? false}
        codeCopy={opts.codeCopy ?? false}
        mermaid={opts.mermaid ?? false}
        streaming={opts.streaming ?? false}
      >
        {props.children}
      </FenceShell>
    );
  }
  const sourcePath = opts.sourcePath;
  if (sourcePath != null) {
    components.img = (props) => (
      <MarkdownImg sourcePath={sourcePath} src={props.src} alt={props.alt} />
    );
  }
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
  codeHighlight,
  codeCopy,
  breaks = false,
  mermaid = false,
  tableTools = false,
  streaming = false,
}: MarkdownDocProps) {
  return (
    <div className={[styles.md, className].filter(Boolean).join(" ")}>
      <Markdown
        remarkPlugins={breaks ? remarkPluginsWithBreaks : remarkPlugins}
        components={buildComponents({
          sourcePath,
          codeHighlight,
          codeCopy,
          mermaid,
          tableTools,
          streaming,
        })}
      >
        {text}
      </Markdown>
    </div>
  );
});
