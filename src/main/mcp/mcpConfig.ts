import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  McpConfigSnapshot,
  McpExposure,
  McpOAuthEntry,
  McpSaveServerRequest,
  McpServerEntry,
} from "../../shared/ipc";

/**
 * 用户级 mcp.json（~/.pi/agent/mcp.json）的读写与校验。
 *
 * RPC 模式下 pi 没有 MCP 配置管理命令面（docs/design/39 §1），PiDesk 直接编辑该文件，
 * 校验规则对齐 pi `packages/coding-agent/src/core/mcp-servers.ts` 的 validateMcpServerConfig；
 * mcp.json 在每次 session_start 重读，保存后经 switch_session 重载会话生效。
 * 本模块保持纯 Node（不引 electron），供 vitest 直测。
 */

/** PiDesk 建模并全量托管的字段；其余原始键（toolExposure、auth、未知键）保存时原样保留。 */
const MANAGED_KEYS = new Set([
  "type",
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "headers",
  "oauth",
  "exposure",
  "enabled",
  "description",
  "timeout",
]);

/** OAuth 对象里 PiDesk 托管的字段；cimd / authServerMetadataUrl 等手配键保留。 */
const MANAGED_OAUTH_KEYS = new Set([
  "clientId",
  "clientSecret",
  "callbackPort",
  "scope",
  "clientName",
]);

const EXPOSURES: readonly McpExposure[] = ["codemode", "deferred", "direct", "hidden"];
/** pi 兼容的旧 exposure 名，校验时归一化为现名。 */
const EXPOSURE_ALIASES: Readonly<Record<string, McpExposure>> = { "codemode-deferred": "codemode" };

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/** pi 对 server 名的 -/_ 等价处理：归一化后同名即冲突。 */
function normalizeServerName(name: string): string {
  return name.replace(/-/g, "_");
}

/** 解析 pi 的 agent 目录：尊重 PI_CODING_AGENT_DIR 覆盖（与 pi config.ts 行为一致）。 */
export function resolvePiAgentDir(): string {
  const override = (process.env.PI_CODING_AGENT_DIR ?? "").trim();
  if (override) return override;
  return path.join(os.homedir(), ".pi", "agent");
}

export function getUserMcpConfigPath(): string {
  return path.join(resolvePiAgentDir(), "mcp.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function normalizeExposure(value: unknown): McpExposure | undefined {
  if (typeof value !== "string") return undefined;
  return (
    EXPOSURE_ALIASES[value] ??
    (EXPOSURES.includes(value as McpExposure) ? (value as McpExposure) : undefined)
  );
}

/** 校验 OAuth 基础字段；返回错误消息，通过时为 null。 */
function validateOAuth(oauth: unknown): string | null {
  if (oauth === undefined || oauth === null) return null;
  if (!isRecord(oauth)) return "oauth 必须是对象";
  const { clientId, clientSecret, callbackPort, scope, clientName } = oauth;
  for (const [key, value] of [
    ["clientId", clientId],
    ["clientSecret", clientSecret],
    ["scope", scope],
  ] as const) {
    if (value !== undefined && typeof value !== "string") return `oauth.${key} 必须是字符串`;
  }
  if (clientName !== undefined && (typeof clientName !== "string" || !clientName.trim())) {
    return "oauth.clientName 不能为空";
  }
  if (
    callbackPort !== undefined &&
    (typeof callbackPort !== "number" ||
      !Number.isInteger(callbackPort) ||
      callbackPort < 1 ||
      callbackPort > 65535)
  ) {
    return "oauth.callbackPort 必须是 1-65535 的端口号";
  }
  return null;
}

/**
 * 校验一条 server 配置（PiDesk 托管字段范围）。
 * 返回归一化后的条目；失败抛出带 server 名的错误。
 */
export function validateServerEntry(name: string, raw: McpServerEntry): McpServerEntry {
  if (!SERVER_NAME.test(name)) {
    throw new Error(`server 名 "${name}" 不合法（只能用字母、数字、_ 和 -）`);
  }
  if (!isRecord(raw)) throw new Error(`server "${name}" 必须是对象`);
  const value: Record<string, unknown> = raw;
  const exposure = normalizeExposure(value.exposure);
  if (value.exposure !== undefined && !exposure) {
    throw new Error(
      `server "${name}": exposure 必须是 ${EXPOSURES.map((e) => `"${e}"`).join(" / ")}`,
    );
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new Error(`server "${name}": enabled 必须是布尔值`);
  }
  if (value.description !== undefined && typeof value.description !== "string") {
    throw new Error(`server "${name}": description 必须是字符串`);
  }
  if (value.timeout !== undefined && (typeof value.timeout !== "number" || !(value.timeout > 0))) {
    throw new Error(`server "${name}": timeout 必须是正数（秒）`);
  }
  if (value.type === "sse") {
    throw new Error(`server "${name}": 不支持旧版 SSE 传输，请改用 streamable HTTP 地址`);
  }
  const oauthError = validateOAuth(value.oauth);
  if (oauthError) throw new Error(`server "${name}": ${oauthError}`);

  const hasUrl = typeof value.url === "string";
  const type = value.type;
  if (hasUrl && (type === undefined || type === "http" || type === "streamable-http")) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(value.url as string);
    } catch {
      throw new Error(`server "${name}": url 必须是 http(s) 地址`);
    }
    if (!/^https?:$/.test(parsedUrl.protocol))
      throw new Error(`server "${name}": url 必须是 http(s) 地址`);
    if (value.headers !== undefined && !isStringRecord(value.headers)) {
      throw new Error(`server "${name}": headers 必须是字符串映射`);
    }
    return { ...raw, exposure, type: "http" };
  }
  if (typeof value.command === "string" && (type === undefined || type === "stdio")) {
    if (value.command.trim() === "") throw new Error(`server "${name}": command 不能为空`);
    if (
      value.args !== undefined &&
      !(Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string"))
    ) {
      throw new Error(`server "${name}": args 必须是字符串数组`);
    }
    if (value.env !== undefined && !isStringRecord(value.env)) {
      throw new Error(`server "${name}": env 必须是字符串映射`);
    }
    if (value.cwd !== undefined && typeof value.cwd !== "string") {
      throw new Error(`server "${name}": cwd 必须是字符串`);
    }
    return { ...raw, exposure, type: "stdio" };
  }
  throw new Error(`server "${name}" 需要 command（stdio）或 url（streamable HTTP）之一`);
}

/**
 * 合并托管字段与原始条目：PiDesk 建模字段全量覆盖（表单留空即删除），
 * 其余原始键（toolExposure、auth、未知键）原样保留。
 */
export function mergeServerEntry(raw: unknown, managed: McpServerEntry): McpServerEntry {
  const merged: Record<string, unknown> = {};
  if (isRecord(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (!MANAGED_KEYS.has(key)) merged[key] = value;
    }
  }
  for (const [key, value] of Object.entries(managed)) {
    if (value === undefined) continue;
    merged[key] = value;
  }
  // oauth 做同样的一层合并：保留 cimd 等未托管键
  const rawOAuth = isRecord(raw) ? raw.oauth : undefined;
  if (isRecord(rawOAuth) || isRecord(merged.oauth)) {
    const oauth: Record<string, unknown> = { ...(isRecord(rawOAuth) ? rawOAuth : {}) };
    const managedOAuth = managed.oauth as Record<string, unknown> | undefined;
    if (managedOAuth) {
      for (const [key, value] of Object.entries(managedOAuth)) {
        if (value === undefined || value === "") continue;
        oauth[key] = value;
      }
    } else {
      // 表单未展开 oauth：删除全部托管键，只留未托管的
      for (const key of MANAGED_OAUTH_KEYS) delete oauth[key];
    }
    if (Object.keys(oauth).length > 0) {
      merged.oauth = oauth as McpOAuthEntry;
    } else {
      delete merged.oauth;
    }
  }
  return merged as unknown as McpServerEntry;
}

/** 读取 mcp.json 原始内容；文件缺失返回空骨架，结构非法时抛错（绝不静默重置覆盖用户手写内容）。 */
function readRawConfig(): Record<string, unknown> {
  const file = getUserMcpConfigPath();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { mcpServers: {} };
    }
    throw new Error(`mcp.json 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error("mcp.json 的顶层必须是对象，请手动修复后再用面板管理");
  }
  return parsed;
}

/** 原子写 mcp.json（临时文件 + rename），2 空格缩进 + 换行结尾。 */
function writeRawConfig(raw: Record<string, unknown>): void {
  const file = getUserMcpConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.pidesk-tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function readEntries(raw: Record<string, unknown>): Record<string, unknown> {
  const entries = raw.mcpServers;
  if (!isRecord(entries)) {
    throw new Error("mcp.json 的 mcpServers 必须是对象，请手动修复后再用面板管理");
  }
  return entries;
}

/** 读取用户级配置快照（渲染层展示模型）；非对象条目带 invalid 标记透出（可见、可删、可重建）。 */
export function listUserMcpConfig(): McpConfigSnapshot {
  const raw = readRawConfig();
  const entries = readEntries(raw);
  const autoEnableCodemode =
    typeof raw.autoEnableCodemode === "boolean" ? raw.autoEnableCodemode : undefined;
  return {
    file: getUserMcpConfigPath(),
    autoEnableCodemode,
    entries: Object.entries(entries).map(([name, config]) =>
      isRecord(config)
        ? { name, config: config as McpServerEntry }
        : { name, config: {} as McpServerEntry, invalid: true },
    ),
  };
}

/** 保存（新增 / 更新 / 重命名）一条 server；校验失败抛错，原文件不动。 */
export function saveServerEntry(req: McpSaveServerRequest): void {
  const validated = validateServerEntry(req.name, req.config);
  const raw = readRawConfig();
  const entries = readEntries(raw);
  const normalized = normalizeServerName(req.name);
  for (const existingName of Object.keys(entries)) {
    if (existingName === req.previousName) continue;
    if (normalizeServerName(existingName) === normalized) {
      throw new Error(`已存在等价名称的 server：${existingName}（- 与 _ 视为同名）`);
    }
  }
  const previousRaw =
    req.previousName && req.previousName !== req.name ? entries[req.previousName] : undefined;
  if (
    req.previousName &&
    req.previousName !== req.name &&
    entries[req.previousName] === undefined
  ) {
    throw new Error(`server "${req.previousName}" 不存在，无法重命名`);
  }
  const merged = mergeServerEntry(previousRaw ?? entries[req.name], validated);
  if (req.previousName && req.previousName !== req.name) {
    delete entries[req.previousName];
  }
  entries[req.name] = merged;
  raw.mcpServers = entries;
  writeRawConfig(raw);
}

/** 删除一条 server；不存在时抛错。 */
export function removeServerEntry(name: string): void {
  const raw = readRawConfig();
  const entries = readEntries(raw);
  if (entries[name] === undefined) {
    throw new Error(`server "${name}" 不存在`);
  }
  delete entries[name];
  raw.mcpServers = entries;
  writeRawConfig(raw);
}
