/**
 * 解析 pi 的 MCP 工具全名 `mcp__<server>__<tool>`（docs/design/40 §二）。
 *
 * pi 命名规则（pi docs/mcp.md）：整名中 `[A-Za-z0-9_]` 之外的字符替换为 `_`，
 * server 名的 `-` 归一为 `_`，tool 名内部原有的 `__` 会保留——
 * 因此按「去前缀后的第一个 `__`」分段，剩余部分整体归 tool，不能按固定段数切。
 */

export interface McpToolNameParts {
  /** server 名（pi 已把 `-` 归一为 `_` 后的形式）。 */
  server: string;
  /** 工具短名（可能含 `__`）。 */
  tool: string;
}

const MCP_TOOL_PREFIX = "mcp__";

/** 解析 MCP 工具全名；非 `mcp__` 前缀或 server/tool 段为空时返回 null。 */
export function parseMcpToolName(name: string): McpToolNameParts | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const separator = rest.indexOf("__");
  if (separator <= 0) return null;
  const tool = rest.slice(separator + 2);
  if (!tool) return null;
  return { server: rest.slice(0, separator), tool };
}
