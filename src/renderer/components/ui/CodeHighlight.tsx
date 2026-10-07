import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { HighlighterCore } from "shiki/core";
import { normalizeFenceLang } from "../../utils/markdownRefs";
import styles from "./CodeHighlight.module.css";

/**
 * 超过该字节数跳过高亮（侧栏预览上限约 1MB，全文 tokenize 会卡 UI）。
 * 超限时回退纯 <pre>。
 */
const MAX_HIGHLIGHT_BYTES = 200_000;

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  vue: "vue",
  svelte: "svelte",
  py: "python",
  rb: "ruby",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  rs: "rust",
  go: "go",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  md: "markdown",
  markdown: "markdown",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  diff: "diff",
  patch: "diff",
};

/** 按需动态加载的文法模块：只拉当前打开文件真正用到的语言。 */
const LANG_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  json5: () => import("shiki/langs/json5.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  less: () => import("shiki/langs/less.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
};

function langFromPath(filePath: string): string {
  const name = filePath.split(/[/\\]/).at(-1) ?? filePath;
  // 双后缀（.d.ts）优先整段匹配，否则取最后一段
  if (/\.d\.ts$/i.test(name)) return "typescript";
  const ext = name.includes(".") ? (name.split(".").at(-1) ?? "").toLowerCase() : "";
  return EXT_TO_LANG[ext] ?? "plaintext";
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
const pendingLangs = new Set<string>();

function loadHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
      import("shiki/themes/github-dark.mjs"),
      import("shiki/themes/github-light.mjs"),
    ]).then(async ([core, engine, dark, light]) => {
      const highlighter = await core.createHighlighterCore({
        themes: [dark.default, light.default],
        langs: [],
        engine: engine.createJavaScriptRegexEngine(),
      });
      return highlighter;
    });
  }
  return highlighterPromise;
}

async function ensureLang(highlighter: HighlighterCore, lang: string): Promise<boolean> {
  if (lang === "plaintext") return true;
  if (highlighter.getLoadedLanguages().includes(lang)) return true;
  const loader = LANG_LOADERS[lang];
  if (!loader) return false;
  // 同一语言并发打开时只 load 一次
  if (pendingLangs.has(lang)) {
    while (pendingLangs.has(lang)) {
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return highlighter.getLoadedLanguages().includes(lang);
  }
  pendingLangs.add(lang);
  try {
    const mod = await loader();
    await highlighter.loadLanguage(mod.default as never);
    return true;
  } finally {
    pendingLangs.delete(lang);
  }
}

interface CodeHighlightProps {
  /** 文件内容。 */
  code: string;
  /** 用于推断语言的路径（绝对或相对皆可）；`lang` 未提供时使用。 */
  filePath?: string;
  /** 直接指定语言：shiki 语言 id 或围栏 info string（如 `ts`、`py {1,3}`），优先于 filePath 推断。 */
  lang?: string;
  /** 追加到根节点的类名（外层布局样式）。 */
  className?: string;
  /** 1-based 目标行：渲染后滚到该行并高亮（会话区 `path:line` 打开）。 */
  focusLine?: number | null;
}

/** 与编辑器一致的行数：末尾换行不额外计空行。 */
export function countCodeLines(code: string): number {
  if (code.length === 0) return 1;
  const parts = code.split("\n");
  if (parts.length > 1 && parts.at(-1) === "") return parts.length - 1;
  return parts.length;
}

/**
 * 只读代码高亮块：shiki 双主题（github-dark / github-light）经 CSS 变量随
 * data-theme 切换；语言按 `lang`（围栏 info string 归一）或文件扩展名推断并
 * 按需动态加载。加载中/未知语言/过大文件回退纯文本。
 * 两种路径都带左侧行号槽（CSS counter，宽度随行数位数变化）。
 */
export function CodeHighlight({ code, filePath, lang, className, focusLine }: CodeHighlightProps) {
  const [html, setHtml] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const gutterWidth = useMemo(() => `${String(countCodeLines(code)).length + 1}ch`, [code]);
  const gutterStyle = useMemo(
    () => ({ "--gutter-w": gutterWidth }) as CSSProperties,
    [gutterWidth],
  );

  useEffect(() => {
    if (code.length > MAX_HIGHLIGHT_BYTES) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    const resolvedLang = lang?.trim() ? normalizeFenceLang(lang) : langFromPath(filePath ?? "");
    setHtml(null);

    loadHighlighter()
      .then(async (highlighter) => {
        const ok = await ensureLang(highlighter, resolvedLang);
        if (cancelled) return;
        if (!ok) {
          setHtml(null);
          return;
        }
        const next = highlighter.codeToHtml(code, {
          lang: resolvedLang,
          themes: {
            light: "github-light",
            dark: "github-dark",
          },
          defaultColor: false,
        });
        if (!cancelled) setHtml(next);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });

    return () => {
      cancelled = true;
    };
  }, [code, filePath, lang]);

  // 滚到 focusLine：shiki HTML 异步注入，等一帧再量布局；纯文本路径同步已就绪
  // code/filePath 变化时 html 会先置 null 再换新，shiki 路径靠 html 依赖即可
  useEffect(() => {
    if (focusLine == null || focusLine < 1) return;
    const root = html === null ? preRef.current : hostRef.current;
    if (!root) return;

    let raf = 0;
    let tries = 0;
    const apply = (): void => {
      const lines = root.querySelectorAll<HTMLElement>(".line");
      const target = lines[focusLine - 1];
      if (!target) {
        if (tries++ < 8) raf = requestAnimationFrame(apply);
        return;
      }
      for (const el of lines) el.classList.remove(styles.lineFocus);
      target.classList.add(styles.lineFocus);
      const cRect = root.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      root.scrollTop += tRect.top - cRect.top - root.clientHeight / 2 + tRect.height / 2;
    };
    raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
  }, [focusLine, html]);

  if (html === null) {
    const cls = [styles.block, className ?? ""].join(" ").trim();
    const lines = code.split("\n");
    if (lines.length > 1 && lines.at(-1) === "") lines.pop();
    return (
      <pre ref={preRef} className={cls} style={gutterStyle}>
        {lines.map((line, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: 静态只读行，无重排/增删
            key={index}
            className={[styles.line, focusLine === index + 1 ? styles.lineFocus : ""]
              .filter(Boolean)
              .join(" ")}
          >
            {line}
          </span>
        ))}
      </pre>
    );
  }
  const hostCls = [styles.host, className ?? ""].join(" ").trim();
  return (
    <div
      ref={hostRef}
      className={hostCls}
      style={gutterStyle}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki 对源码做 HTML 转义，输出仅为 span+style token
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
