import { ipcMain } from "electron";
import type {
  IpcResult,
  McpPiSupport,
  McpReloadResult,
  McpSaveServerRequest,
  McpSessionCommandRequest,
  SessionId,
} from "../../shared/ipc";
import { MCP_IPC } from "../../shared/ipc";
import { envelope, envelopeAsync } from "../ipc/envelope";
import { resolvePiCommand, runPiVersion } from "../session/piLauncher";
import {
  fetchSlashCommands,
  hasSession,
  listLiveSessions,
  promptSession,
  reloadSessionConfig,
} from "../session/piSession";
import { getSettings } from "../settings/settings";
import { listUserMcpConfig, removeServerEntry, saveServerEntry } from "./mcpConfig";
import { searchMarket } from "./mcpMarket";
import { probeMcpServers } from "./mcpProbe";
import { supportsBuiltinMcp } from "./piVersion";

/** get_commands 响应中是否注册了某个扩展命令（响应形如 { commands: [{ name }] }）。 */
function hasSlashCommand(data: unknown, name: string): boolean {
  const raw =
    data && typeof data === "object" && Array.isArray((data as { commands?: unknown }).commands)
      ? (data as { commands: unknown[] }).commands
      : [];
  return raw.some(
    (item) => item && typeof item === "object" && (item as { name?: unknown }).name === name,
  );
}

/**
 * 旧版 pi 的统一拒绝错误：mcp.json 在 pi < 0.99 下不会被读取，编辑是静默空操作，
 * 必须显式拒绝而不是让用户保存「看起来成功」的无效配置。
 */
function unsupportedMcpError(version: string | null): Error {
  return new Error(
    `当前 pi（${version ?? "版本未知"}）不支持 MCP：内置 MCP 需要 pi ≥ 0.99，请升级 pi 后再使用`,
  );
}

/**
 * 宿主 pi 版本与内置 MCP 支持状态；按解析出的 pi 路径缓存成功结果（页面每次挂载
 * 都会查询，避免反复跑 `pi --version`）。失败不缓存：装好 pi / 修好路径后立即生效。
 */
let piSupportCache: { key: string; support: McpPiSupport } | null = null;

async function getMcpPiSupport(): Promise<McpPiSupport> {
  let command: ReturnType<typeof resolvePiCommand>;
  try {
    command = resolvePiCommand(getSettings().piExecutablePath);
  } catch {
    return { version: null, status: "unknown" };
  }
  if (piSupportCache?.key === command.piPath) return piSupportCache.support;
  const version = runPiVersion(command);
  const verdict = supportsBuiltinMcp(version);
  const support: McpPiSupport = {
    version,
    status: verdict === false ? "unsupported" : verdict === true ? "supported" : "unknown",
  };
  if (version !== null) piSupportCache = { key: command.piPath, support };
  return support;
}

/** 版本确定不支持时抛错（unknown / supported 均放行）。 */
async function ensureMcpSupported(): Promise<void> {
  const support = await getMcpPiSupport();
  if (support.status === "unsupported") throw unsupportedMcpError(support.version);
}

/** MCP 管理面板的 IPC 域（docs/design/39）。 */
export function registerMcpIpc(): void {
  ipcMain.handle(MCP_IPC.list, (): IpcResult<unknown> => envelope(() => listUserMcpConfig()));

  ipcMain.handle(
    MCP_IPC.probe,
    (_event, req: { cwd?: unknown }): Promise<IpcResult<unknown>> =>
      envelopeAsync(async () => {
        await ensureMcpSupported();
        return probeMcpServers(typeof req?.cwd === "string" ? req.cwd : null);
      }),
  );

  ipcMain.handle(
    MCP_IPC.save,
    (_event, req: McpSaveServerRequest): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        if (!req || typeof req.name !== "string" || typeof req.config !== "object") {
          throw new Error("无效的 MCP server 配置");
        }
        await ensureMcpSupported();
        saveServerEntry({ ...req, previousName: req.previousName ?? null });
        return null;
      }),
  );

  ipcMain.handle(
    MCP_IPC.remove,
    (_event, req: { name?: unknown }): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        if (typeof req?.name !== "string" || !req.name) throw new Error("无效的 server 名");
        await ensureMcpSupported();
        removeServerEntry(req.name);
        return null;
      }),
  );

  ipcMain.handle(
    MCP_IPC.getPiSupport,
    (): Promise<IpcResult<McpPiSupport>> => envelopeAsync(() => getMcpPiSupport()),
  );

  ipcMain.handle(
    MCP_IPC.marketSearch,
    (_event, req: { query?: unknown; cursor?: unknown }): Promise<IpcResult<unknown>> =>
      envelopeAsync(async () => {
        if (typeof req?.query !== "string") throw new Error("无效的市场搜索词");
        return searchMarket({
          query: req.query,
          cursor: typeof req.cursor === "string" ? req.cursor : null,
        });
      }),
  );

  ipcMain.handle(
    MCP_IPC.sessionCommand,
    (_event, req: McpSessionCommandRequest): Promise<IpcResult<{ sessionId: SessionId }>> =>
      envelopeAsync(async () => {
        if (!req || typeof req.serverName !== "string" || !req.serverName) {
          throw new Error("无效的 server 名");
        }
        if (req.action !== "login" && req.action !== "logout" && req.action !== "reconnect") {
          throw new Error("无效的 /mcp 动作");
        }
        // 指定会话已死时回退到任一存活实例（登录态存 mcp-auth.json，全局共享）
        const requested = typeof req.sessionId === "string" ? req.sessionId : null;
        const sessionId = requested && hasSession(requested) ? requested : listLiveSessions()[0];
        if (!sessionId || !hasSession(sessionId)) {
          throw new Error("没有活跃的 pi 会话");
        }
        // 防御：/mcp 是扩展命令，pi 未内置 MCP（过旧 / --no-mcp）时 prompt 会把文本发给模型
        if (!hasSlashCommand(await fetchSlashCommands(sessionId), "mcp")) {
          throw new Error("当前 pi 会话未注册 mcp 命令（需要 pi ≥ 0.99）");
        }
        const command = `/mcp ${req.action} ${req.serverName}`;
        if (req.action === "login") {
          // 发后即忘：loginCommand 会 await 整个 OAuth 流程（等浏览器回调），期间
          // RPC prompt 不会应答，await 它会把 IPC 挂到授权完成；pi 同时发来的
          // extension_ui_request{input} 与 loopback 回调竞速，本机浏览器完成即成功。
          void promptSession(sessionId, command).catch(() => {});
        } else {
          // logout / reconnect 立即完成；超时兜底防 pi 无应答
          await promptSession(sessionId, command, undefined, 20_000);
        }
        return { sessionId };
      }),
  );

  ipcMain.handle(
    MCP_IPC.reloadSessions,
    (_event, req: { sessionIds?: SessionId[] }): Promise<IpcResult<McpReloadResult>> =>
      envelopeAsync(async () => {
        const targets =
          Array.isArray(req?.sessionIds) && req.sessionIds.length > 0
            ? req.sessionIds.filter((id) => hasSession(id))
            : listLiveSessions();
        const result: McpReloadResult = { reloaded: [], failures: [] };
        for (const sessionId of targets) {
          try {
            await reloadSessionConfig(sessionId);
            result.reloaded.push(sessionId);
          } catch (error) {
            result.failures.push({
              sessionId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return result;
      }),
  );
}
