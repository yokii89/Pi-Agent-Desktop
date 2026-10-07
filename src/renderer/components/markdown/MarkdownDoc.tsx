import { Copy } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { isValidElement, memo, useEffect, useState } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { isHtmlPath } from "../../../shared/fileKinds";
import { useT } from "../../hooks/useT";
import { fsService } from "../../services/fsService";
import { useBrowserStore } from "../../stores/browserStore";
import { useUiStore } from "../../stores/uiStore";
import { normalizeFenceLang, resolveMarkdownRef } from "../../utils/markdownRefs";
import { FileLink, looksLikeFilePath } from "../SessionArea/FileLink";
import { CodeHighlight, countCodeLines } from "../ui/CodeHighlight";
import styles from "./markdown.module.css";

/** 模块级常量：避免每次 render 新建插件数组导致 memo 失效。 */
const remarkPlugins = [remarkGfm];
/** 会话流（breaks 开）：软换行渲染为 <br>，与不含 breaks 的数组分开持有，防 memo 失效。 */
const remarkPluginsWithBreaks = [remarkGfm, remarkBreaks];

/** 流式代码块高亮护栏（docs/design/10 §3.9）：超过即退回纯 <pre>，避免长代码拖慢流式。 */
const MAX_HIGHLIGHT_CHARS = 20_000;
const MAX_HIGHLIGHT_LINES = 200;

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
  /** 块级代码块外壳加悬浮「复制」按钮（会话区开，docs/design/12 P1-4）；与 codeHighlight 互斥使用。 */
  codeCopy?: boolean;
  /**
   * 软换行渲染为 <br>（docs/design/29 缺陷 E）：模型输出的「序号行 + 单换行 + 正文」
   * 是段内换行语义。默认 false——文件面板预览与 ExtensionView 保持 CommonMark 折叠。
   */
  breaks?: boolean;
}

/** 提取围栏 code 的纯文本（react-markdown 的 code children 就是字符串，此为兜底）。 */
function flattenText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  return "";
}

/**
 * 块级围栏统一外壳（docs/design/13 P1-5）：语言标签 + 可选「复制」按钮 + 可选 shiki 高亮。
 * - 有语言且未超护栏 → CodeHighlight（shiki，双主题）；
 * - 无语言 / 超护栏 / 未开高亮 → 纯 <pre>；
 * - 复制按钮随 codeCopy 开关（会话区开），语言标签有语言即显示。
 * 挂在 components.pre 上，CodeHighlight 自带 <pre>，避免嵌套。
 */
function FenceShell({
  children,
  codeHighlight,
  codeCopy,
}: {
  children?: ReactNode;
  codeHighlight: boolean;
  codeCopy: boolean;
}) {
  const { showToast } = useUiStore();
  const t = useT();
  const child = isValidElement(children)
    ? (children.props as { className?: string; children?: ReactNode })
    : null;
  const match = /language-([\w+#.-]+)/.exec(child?.className ?? "");
  const lang = match ? normalizeFenceLang(match[1]) : null;
  const knownLang = lang !== null && lang !== "plaintext";
  const code = flattenText(child?.children).replace(/\n$/, "");
  const highlightable =
    codeHighlight &&
    knownLang &&
    code.length <= MAX_HIGHLIGHT_CHARS &&
    countCodeLines(code) <= MAX_HIGHLIGHT_LINES;
  const showHeader = knownLang || codeCopy;
  return (
    <div className={styles.fence}>
      {showHeader && (
        <div className={styles.fenceHeader}>
          <span className={styles.fenceLang}>{knownLang ? lang : ""}</span>
          {codeCopy && (
            <button
              type="button"
              className={styles.fenceCopy}
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
      )}
      {highlightable ? (
        <CodeHighlight code={code} lang={lang ?? undefined} />
      ) : (
        <pre>{children}</pre>
      )}
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
 * （docs/design/13 P0-1）。 */
function MarkdownLink({
  sourcePath,
  href,
  children,
}: {
  sourcePath: string | null;
  href?: string;
  children?: ReactNode;
}) {
  const t = useT();
  const { dispatch, showToast } = useUiStore();
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
  if (/^https?:\/\//i.test(href)) {
    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          // IPC 统一信封：失败以 ok:false 返回而非 reject，两路都要报
          void window.pidesk?.window
            .openExternal(href)
            .then((result) => {
              if (!result.ok) showToast(result.error ?? t("common.openFailed"));
            })
            .catch(() => showToast(t("common.openFailed")));
        }}
      >
        {children}
      </a>
    );
  }
  return <span className={styles.mdLinkDead}>{children}</span>;
}

function buildComponents(opts: {
  sourcePath?: string | null;
  codeHighlight?: boolean;
  codeCopy?: boolean;
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
      <MarkdownLink sourcePath={opts.sourcePath ?? null} href={props.href}>
        {props.children}
      </MarkdownLink>
    ),
  };
  if (opts.codeHighlight || opts.codeCopy) {
    components.pre = (props) => (
      <FenceShell codeHighlight={opts.codeHighlight ?? false} codeCopy={opts.codeCopy ?? false}>
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
}: MarkdownDocProps) {
  return (
    <div className={[styles.md, className].filter(Boolean).join(" ")}>
      <Markdown
        remarkPlugins={breaks ? remarkPluginsWithBreaks : remarkPlugins}
        components={buildComponents({ sourcePath, codeHighlight, codeCopy })}
      >
        {text}
      </Markdown>
    </div>
  );
});
