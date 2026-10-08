import type {
  McpConfigSnapshot,
  McpMarketSearchRequest,
  McpMarketSearchResult,
  McpPiSupport,
  McpProbeResult,
  McpReloadResult,
  McpSaveServerRequest,
  McpSessionCommandRequest,
  SessionId,
} from "../../shared/ipc";
import { unwrap } from "./ipc";

function api() {
  const a = window.pidesk?.mcp;
  if (!a) throw new Error("预加载 API 不可用");
  return a;
}

/** MCP 管理面板（docs/design/39）与主进程的渲染层服务。 */
export const mcpService = {
  async list(): Promise<McpConfigSnapshot> {
    return unwrap(api().list());
  },
  async probe(cwd?: string | null): Promise<McpProbeResult> {
    return unwrap(api().probe({ cwd: cwd ?? null }));
  },
  async save(req: McpSaveServerRequest): Promise<void> {
    await unwrap(api().save(req));
  },
  async remove(name: string): Promise<void> {
    await unwrap(api().remove(name));
  },
  async sessionCommand(req: McpSessionCommandRequest): Promise<SessionId> {
    const result = await unwrap(api().sessionCommand(req));
    return result.sessionId;
  },
  async reloadSessions(sessionIds?: string[]): Promise<McpReloadResult> {
    return unwrap(api().reloadSessions(sessionIds));
  },
  async getPiSupport(): Promise<McpPiSupport> {
    return unwrap(api().getPiSupport());
  },
  /** MCP 市场搜索：空 query 走内置精选清单，非空走官方注册表（docs/design/41）。 */
  async marketSearch(req: McpMarketSearchRequest): Promise<McpMarketSearchResult> {
    return unwrap(api().marketSearch(req));
  },
};
