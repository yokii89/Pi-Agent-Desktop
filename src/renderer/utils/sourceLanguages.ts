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
  | "php"
  | "toml"
  | "properties"
  | "ruby"
  | "shell"
  | "powershell"
  | "go"
  | "dockerfile"
  | "csharp"
  | "kotlin"
  | "swift"
  | "nginx"
  | "cmake"
  | "diff";

export interface SourceLanguage {
  shikiLanguage: string;
  editorLanguage: EditorLanguageId | null;
}

const LANGUAGES = {
  typescript: { shikiLanguage: "typescript", editorLanguage: "typescript" },
  typescriptJsx: { shikiLanguage: "tsx", editorLanguage: "typescript-jsx" },
  javascript: { shikiLanguage: "javascript", editorLanguage: "javascript" },
  javascriptJsx: { shikiLanguage: "jsx", editorLanguage: "javascript-jsx" },
  json: { shikiLanguage: "json", editorLanguage: "json" },
  jsonc: { shikiLanguage: "jsonc", editorLanguage: "json" },
  json5: { shikiLanguage: "json5", editorLanguage: "json" },
  yaml: { shikiLanguage: "yaml", editorLanguage: "yaml" },
  toml: { shikiLanguage: "toml", editorLanguage: "toml" },
  ini: { shikiLanguage: "ini", editorLanguage: "properties" },
  css: { shikiLanguage: "css", editorLanguage: "css" },
  scss: { shikiLanguage: "scss", editorLanguage: "css" },
  less: { shikiLanguage: "less", editorLanguage: "css" },
  html: { shikiLanguage: "html", editorLanguage: "html" },
  xml: { shikiLanguage: "xml", editorLanguage: "xml" },
  vue: { shikiLanguage: "vue", editorLanguage: "html" },
  svelte: { shikiLanguage: "svelte", editorLanguage: "html" },
  python: { shikiLanguage: "python", editorLanguage: "python" },
  ruby: { shikiLanguage: "ruby", editorLanguage: "ruby" },
  php: { shikiLanguage: "php", editorLanguage: "php" },
  shell: { shikiLanguage: "bash", editorLanguage: "shell" },
  powershell: { shikiLanguage: "powershell", editorLanguage: "powershell" },
  rust: { shikiLanguage: "rust", editorLanguage: "rust" },
  go: { shikiLanguage: "go", editorLanguage: "go" },
  c: { shikiLanguage: "c", editorLanguage: "cpp" },
  cpp: { shikiLanguage: "cpp", editorLanguage: "cpp" },
  csharp: { shikiLanguage: "csharp", editorLanguage: "csharp" },
  java: { shikiLanguage: "java", editorLanguage: "java" },
  kotlin: { shikiLanguage: "kotlin", editorLanguage: "kotlin" },
  swift: { shikiLanguage: "swift", editorLanguage: "swift" },
  markdown: { shikiLanguage: "markdown", editorLanguage: "markdown" },
  sql: { shikiLanguage: "sql", editorLanguage: "sql" },
  graphql: { shikiLanguage: "graphql", editorLanguage: null },
  csv: { shikiLanguage: "csv", editorLanguage: null },
  dockerfile: { shikiLanguage: "dockerfile", editorLanguage: "dockerfile" },
  dotenv: { shikiLanguage: "dotenv", editorLanguage: "shell" },
  log: { shikiLanguage: "log", editorLanguage: null },
  properties: { shikiLanguage: "properties", editorLanguage: "properties" },
  makefile: { shikiLanguage: "makefile", editorLanguage: null },
  cmake: { shikiLanguage: "cmake", editorLanguage: "cmake" },
  nginx: { shikiLanguage: "nginx", editorLanguage: "nginx" },
  diff: { shikiLanguage: "diff", editorLanguage: "diff" },
} satisfies Record<string, SourceLanguage>;

type LanguageKey = keyof typeof LANGUAGES;

const EXTENSION_LANGUAGE: Record<string, LanguageKey> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescriptJsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptJsx",
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  properties: "properties",
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
  sh: "shell",
  bash: "shell",
  zsh: "shell",
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
  csv: "csv",
  docker: "dockerfile",
  dockerfile: "dockerfile",
  env: "dotenv",
  log: "log",
  make: "makefile",
  mk: "makefile",
  cmake: "cmake",
  nginx: "nginx",
  diff: "diff",
  patch: "diff",
};

const SPECIAL_FILENAMES: Record<string, LanguageKey> = {
  "cmakelists.txt": "cmake",
  gemfile: "ruby",
  gnumakefile: "makefile",
  makefile: "makefile",
  "nginx.conf": "nginx",
  rakefile: "ruby",
  ".bashrc": "shell",
  ".bash_profile": "shell",
  ".profile": "shell",
  ".zshenv": "shell",
  ".zprofile": "shell",
  ".zshrc": "shell",
};

/** Resolves both preview and editor modes from a path. Unknown text files remain plain text. */
export function sourceLanguageForPath(filePath: string): SourceLanguage | null {
  const fileName = filePath.split(/[/\\]/).at(-1) ?? filePath;
  const lowerName = fileName.toLowerCase();

  if (lowerName === "dockerfile" || lowerName.startsWith("dockerfile.")) {
    return LANGUAGES.dockerfile;
  }
  if (lowerName === ".env" || lowerName.startsWith(".env.")) return LANGUAGES.dotenv;
  if (lowerName === "cmakelists.txt") return LANGUAGES.cmake;

  const namedLanguage = SPECIAL_FILENAMES[lowerName];
  if (namedLanguage) return LANGUAGES[namedLanguage];

  const extension = lowerName.includes(".") ? (lowerName.split(".").at(-1) ?? "") : "";
  const language = EXTENSION_LANGUAGE[extension];
  return language ? LANGUAGES[language] : null;
}
