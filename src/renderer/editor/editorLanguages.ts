import type { Extension } from "@codemirror/state";

/**
 * 编辑态的语言覆盖（docs/design/141）。
 *
 * 只放**编辑时真正会用到的**语言包：预览态的高亮由 shiki 覆盖 40+ 种文法，那是一次性
 * tokenize；编辑态要给的是"打字时还能认出语法"，语言包逐个动态 import，命中不到就退化成
 * 纯文本编辑（仍然可编辑、可保存），不会因为缺语言而挡住编辑。
 *
 * 新增语言只需在这里加两处：`EditorLanguageId` 一个成员 + `EDITOR_LANGUAGES` 一条装载器，
 * 再在 `EDITOR_EXT_LANGUAGE` 里挂上后缀。
 */
export type EditorLanguageId =
  | "javascript"
  | "typescript"
  | "javascript-jsx"
  | "typescript-jsx"
  | "json"
  | "css"
  | "html"
  | "markdown"
  | "python"
  | "yaml"
  | "xml"
  | "sql"
  | "rust"
  | "java"
  | "cpp"
  | "php";

/** 后缀 → 语言 id（双后缀与特殊文件名先单独判定，见 editorLanguageFor）。 */
const EDITOR_EXT_LANGUAGE: Record<string, EditorLanguageId> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript-jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript-jsx",
  json: "json",
  jsonc: "json",
  json5: "json",
  css: "css",
  scss: "css",
  less: "css",
  html: "html",
  htm: "html",
  vue: "html",
  svelte: "html",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  svg: "xml",
  sql: "sql",
  rs: "rust",
  java: "java",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  php: "php",
};

/** 语言 id → 装载器（每包一个惰性 chunk；包内再按语法切分）。 */
const EDITOR_LANGUAGES: Record<EditorLanguageId, () => Promise<Extension>> = {
  javascript: async () => (await import("@codemirror/lang-javascript")).javascript(),
  typescript: async () =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  "javascript-jsx": async () =>
    (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  "typescript-jsx": async () =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true }),
  json: async () => (await import("@codemirror/lang-json")).json(),
  css: async () => (await import("@codemirror/lang-css")).css(),
  html: async () => (await import("@codemirror/lang-html")).html(),
  markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
  python: async () => (await import("@codemirror/lang-python")).python(),
  yaml: async () => (await import("@codemirror/lang-yaml")).yaml(),
  xml: async () => (await import("@codemirror/lang-xml")).xml(),
  sql: async () => (await import("@codemirror/lang-sql")).sql(),
  rust: async () => (await import("@codemirror/lang-rust")).rust(),
  java: async () => (await import("@codemirror/lang-java")).java(),
  cpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
  php: async () => (await import("@codemirror/lang-php")).php(),
};

/** 按路径推断编辑语言；命中不到返回 null（纯文本编辑）。 */
export function editorLanguageFor(filePath: string): EditorLanguageId | null {
  const name = filePath.split(/[/\\]/).at(-1) ?? filePath;
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return null;
  if (lower === ".env" || lower.startsWith(".env.")) return null;
  const ext = lower.includes(".") ? (lower.split(".").at(-1) ?? "") : "";
  return EDITOR_EXT_LANGUAGE[ext] ?? null;
}

/** 装载语言扩展；失败时返回 null（调用方保持纯文本，不打断编辑）。 */
export async function loadEditorLanguage(id: EditorLanguageId): Promise<Extension | null> {
  try {
    return await EDITOR_LANGUAGES[id]();
  } catch {
    return null;
  }
}
