/**
 * 从 bash 命令识别执行主体品牌，供会话工具行徽标使用。
 * 只做保守的「第一条可执行命令」识别：命令原文仍原样展示，识别失败回退终端图标。
 */

export interface CommandBrand {
  /** 语义 key（探针 / 测试用；UI 只消费 icon）。 */
  id: string;
  /** fileIcons 资产名。 */
  icon: string;
}

interface BrandSpec extends CommandBrand {
  names: readonly string[];
  /** 带版本后缀的解释器（python3.12 / pip3）。 */
  pattern?: RegExp;
}

/** 命令可能很长（heredoc / 多行脚本）；只扫开头，避免每行流式渲染重扫整段。 */
const MAX_SCAN_CHARS = 2048;

const BRAND_SPECS: readonly BrandSpec[] = [
  { id: "pnpm", icon: "file_pnpm", names: ["pnpm", "pnpx"] },
  { id: "npm", icon: "file_npm", names: ["npm", "npx"] },
  { id: "yarn", icon: "file_yarn", names: ["yarn"] },
  { id: "bun", icon: "file_bun", names: ["bun", "bunx"] },
  { id: "node", icon: "file_nodejs", names: ["node", "nodejs"] },
  // 上游把 Git 标志命名成 file_gitignore（图形即 Git logo），复用而不复制资产
  { id: "git", icon: "file_gitignore", names: ["git"] },
  { id: "docker", icon: "file_docker", names: ["docker", "docker-compose"] },
  {
    id: "python",
    icon: "file_python",
    names: ["python", "py", "pip", "pipx", "uv", "uvx", "poetry", "pytest"],
    pattern: /^(?:python|pip)\d+(?:\.\d+)*$/,
  },
  {
    id: "java",
    icon: "file_java",
    names: ["java", "javac", "jar", "jshell", "mvn", "mvnw", "gradle", "gradlew"],
  },
  { id: "go", icon: "file_go", names: ["go", "gofmt"] },
  { id: "cargo", icon: "file_cargo", names: ["cargo"] },
  { id: "rust", icon: "file_rust", names: ["rustc", "rustup"] },
  { id: "ruby", icon: "file_ruby", names: ["ruby", "gem", "bundle", "bundler", "rake"] },
  { id: "php", icon: "file_php", names: ["php", "composer"] },
  { id: "dotnet", icon: "file_cs", names: ["dotnet", "msbuild"] },
  {
    id: "shell",
    icon: "file_shell",
    names: ["bash", "sh", "zsh", "fish", "pwsh", "powershell", "cmd"],
  },
  { id: "typescript", icon: "file_typescript", names: ["tsc"] },
  { id: "vite", icon: "file_vite", names: ["vite"] },
  { id: "biome", icon: "file_biomejs", names: ["biome"] },
  { id: "eslint", icon: "file_eslint", names: ["eslint"] },
  { id: "prettier", icon: "file_prettier", names: ["prettier"] },
  { id: "tailwind", icon: "file_tailwind", names: ["tailwindcss"] },
  { id: "make", icon: "file_makefile", names: ["make", "gmake"] },
  { id: "cmake", icon: "file_cmake", names: ["cmake"] },
  { id: "terraform", icon: "file_terraform", names: ["terraform", "tofu"] },
  { id: "kotlin", icon: "file_kotlin", names: ["kotlin", "kotlinc"] },
  { id: "swift", icon: "file_swift", names: ["swift", "swiftc"] },
  { id: "dart", icon: "file_dart", names: ["dart", "flutter"] },
  { id: "lua", icon: "file_lua", names: ["lua"] },
  { id: "zig", icon: "file_zig", names: ["zig"] },
  { id: "scala", icon: "file_scala", names: ["scala", "scalac", "sbt"] },
  { id: "elixir", icon: "file_elixir", names: ["elixir", "mix"] },
  { id: "haskell", icon: "file_haskell", names: ["ghc", "cabal", "stack"] },
  { id: "clojure", icon: "file_clojure", names: ["clojure", "clj"] },
  { id: "database", icon: "file_db", names: ["psql", "mysql", "sqlite3"] },
  { id: "jupyter", icon: "file_jupyter", names: ["jupyter"] },
];

const BRAND_BY_NAME = new Map<string, CommandBrand>();
const BRAND_BY_ID = new Map<string, CommandBrand>();
const PATTERN_BRANDS: Array<{ pattern: RegExp; brand: CommandBrand }> = [];
for (const spec of BRAND_SPECS) {
  const brand: CommandBrand = { id: spec.id, icon: spec.icon };
  BRAND_BY_ID.set(spec.id, brand);
  for (const name of spec.names) BRAND_BY_NAME.set(name, brand);
  if (spec.pattern) PATTERN_BRANDS.push({ pattern: spec.pattern, brand });
}

/** 全部已登记资产名：测试用来断言资产真的存在于 fileIcons 资产池。 */
export const COMMAND_BRAND_ICONS: readonly string[] = BRAND_SPECS.map((spec) => spec.icon);

/** 包装命令：跳过后才轮到真正的执行主体。 */
const WRAPPERS = new Set([
  "builtin",
  "command",
  "corepack",
  "cross-env",
  "env",
  "exec",
  "nice",
  "nohup",
  "stdbuf",
  "sudo",
  "time",
  "timeout",
  "winpty",
]);

/** 只改变工作目录 / shell 栈：本段没有品牌。 */
const NAVIGATION = new Set(["cd", "dirs", "popd", "pushd"]);

/** 控制流关键字：跳过它继续找段内的执行主体（`then node …`）。 */
const SHELL_KEYWORDS = new Set([
  "alias",
  "break",
  "case",
  "continue",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "export",
  "fi",
  "for",
  "function",
  "if",
  "return",
  "set",
  "then",
  "unset",
  "until",
  "while",
]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** timeout 的时长 / nice 的优先级：不会是可执行名。 */
const NUMERIC = /^\d+(?:\.\d+)?[smhd]?$/;

/** 可执行文件后缀：`node.exe` / `pnpm.cmd` 先按原名匹配。 */
const EXECUTABLE_EXT = /\.(?:exe|cmd|bat|com|ps1)$/i;

/** 直接执行脚本文件时按后缀推断语言。 */
const SCRIPT_EXT_BRAND: Readonly<Record<string, string>> = {
  bash: "shell",
  bat: "shell",
  cjs: "node",
  cmd: "shell",
  js: "node",
  lua: "lua",
  mjs: "node",
  php: "php",
  ps1: "shell",
  py: "python",
  rb: "ruby",
  sh: "shell",
  zsh: "shell",
};

export function detectCommandBrand(command: string): CommandBrand | null {
  if (!command.trim()) return null;
  for (const segment of splitSegments(command.slice(0, MAX_SCAN_CHARS))) {
    const brand = detectSegmentBrand(segment);
    if (brand) return brand;
  }
  return null;
}

/** 按 `&&` / `||` / `;` / `|` / 换行切段；引号内的分隔符不算。 */
function splitSegments(input: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n" || char === ";") {
      segments.push(current);
      current = "";
      continue;
    }
    if (char === "&" && input[index + 1] === "&") {
      segments.push(current);
      current = "";
      index += 1;
      continue;
    }
    if (char === "|") {
      segments.push(current);
      current = "";
      if (input[index + 1] === "|") index += 1;
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments;
}

function detectSegmentBrand(segment: string): CommandBrand | null {
  for (const token of tokenize(segment)) {
    if (!token) continue;
    if (ASSIGNMENT.test(token) || NUMERIC.test(token) || token.startsWith("-")) continue;
    const name = executableName(token);
    if (!name) continue;
    const lower = name.toLowerCase();
    if (SHELL_KEYWORDS.has(lower)) continue;
    if (WRAPPERS.has(lower)) continue;
    if (NAVIGATION.has(lower)) return null;
    return matchBrand(name);
  }
  return null;
}

/** 引号只做分组，不处理转义（Windows 路径里的反斜杠必须原样保留）。 */
function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const char of segment) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function executableName(token: string): string {
  // PowerShell 调用运算符 / 子 shell / 命令替换前缀
  const trimmed = token.replace(/^[$({&!]+/, "").trim();
  return (trimmed.split(/[\\/]/).pop() ?? trimmed).trim();
}

function matchBrand(name: string): CommandBrand | null {
  const lower = name.toLowerCase();
  const executable = lower.replace(EXECUTABLE_EXT, "");
  const exact = BRAND_BY_NAME.get(executable);
  if (exact) return exact;
  for (const entry of PATTERN_BRANDS) {
    if (entry.pattern.test(executable)) return entry.brand;
  }
  const dot = lower.lastIndexOf(".");
  const scriptBrandId = dot === -1 ? undefined : SCRIPT_EXT_BRAND[lower.slice(dot + 1)];
  return scriptBrandId ? (BRAND_BY_ID.get(scriptBrandId) ?? null) : null;
}
