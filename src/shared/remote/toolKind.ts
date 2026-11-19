export const REMOTE_TOOL_KINDS = [
  "terminal",
  "read",
  "write",
  "edit",
  "search",
  "diff",
  "mcp",
  "generic",
] as const;

export type RemoteToolKind = (typeof REMOTE_TOOL_KINDS)[number];

// Keep these categories aligned with the desktop session tool glyphs.
// Background job inspection and stop tools use the terminal glyph as well.
const TERMINAL_TOOLS = new Set([
  "bash",
  "shell",
  "pwsh",
  "sh",
  "zsh",
  "cmd",
  "tool_execution_inspect_output",
  "bash_job_stop",
]);
const READ_TOOLS = new Set(["read", "cat", "view", "ls", "list"]);
const WRITE_TOOLS = new Set(["write", "create", "new"]);
const EDIT_TOOLS = new Set(["edit", "apply_patch", "patch", "str_replace"]);
const SEARCH_TOOLS = new Set(["grep", "glob", "search", "rg", "find", "codebase_search"]);
const DIFF_TOOLS = new Set(["diff", "git_diff"]);

export function classifyRemoteTool(name: string): RemoteToolKind {
  if (name.startsWith("mcp__")) return "mcp";
  const key = name.trim().toLowerCase();
  if (TERMINAL_TOOLS.has(key)) return "terminal";
  if (READ_TOOLS.has(key)) return "read";
  if (WRITE_TOOLS.has(key)) return "write";
  if (EDIT_TOOLS.has(key)) return "edit";
  if (SEARCH_TOOLS.has(key)) return "search";
  if (DIFF_TOOLS.has(key)) return "diff";
  return "generic";
}

export function isRemoteToolKind(value: unknown): value is RemoteToolKind {
  return typeof value === "string" && (REMOTE_TOOL_KINDS as readonly string[]).includes(value);
}
