import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type {
  McpMarketEntry,
  McpMarketSearchRequest,
  McpMarketSearchResult,
  McpMarketTemplate,
} from "../../shared/ipc";
import { MARKET_CURATED_ENTRIES } from "./marketCurated";

/**
 * MCP 市场数据层（docs/design/41）：官方 MCP Registry 在线搜索 + 内置精选清单。
 * 网络全部在主进程（渲染层 CSP 严格策略不落数据请求）；缓存落 userData JSON，
 * TTL 24h、LRU 修剪；翻页请求不走缓存。空 query 只走精选，离线可用。
 */

const REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io/v0/servers";
const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_KEYS = 40;
const PAGE_LIMIT = 20;
/** 单条目环境变量上限：注册表个别条目环境变量极多，防止载荷失控。 */
const MAX_ENV_VARS = 12;

const CACHE_FILENAME = "mcp-market-cache.json";

interface CacheValue {
  fetchedAt: number;
  entries: McpMarketEntry[];
  nextCursor: string | null;
}

type CacheFile = Record<string, CacheValue>;

let cache: CacheFile | null = null;
const inFlight = new Map<string, Promise<McpMarketSearchResult>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** 反转 DNS 名（io.github/user/pkg）取尾段做建议 server 名，非法字符归一为 `_`。 */
export function suggestServerName(registryName: string): string {
  const tail = registryName.split("/").pop() ?? registryName;
  const normalized = tail.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "mcp-server";
}

/** 带非空 name 字段的记录（env / headers 列表项）。 */
function isNamedRecord(
  item: Record<string, unknown>,
): item is Record<string, unknown> & { name: string } {
  return typeof item.name === "string" && item.name.trim() !== "";
}

function normalizeEnvVars(raw: unknown): McpMarketEntry["template"]["env"] {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter(isRecord)
    .filter(isNamedRecord)
    .slice(0, MAX_ENV_VARS)
    .map((item) => ({
      name: item.name.trim(),
      description: optionalString(item.description),
      isSecret: item.isSecret === true,
      isRequired: item.isRequired === true,
      defaultValue: optionalString(item.default),
    }));
  return out.length > 0 ? out : undefined;
}

function normalizeHeaders(raw: unknown): McpMarketEntry["template"]["headers"] {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter(isRecord)
    .filter(isNamedRecord)
    .map((item) => ({
      name: item.name.trim(),
      description: optionalString(item.description),
      value: optionalString(item.value),
    }));
  return out.length > 0 ? out : undefined;
}

/** npm 包 → npx stdio 模板；版本锁死为 identifier@version。 */
function templateFromNpmPackage(pkg: Record<string, unknown>): McpMarketTemplate | null {
  const identifier = optionalString(pkg.identifier);
  if (!identifier) return null;
  const version = optionalString(pkg.version);
  const args = ["-y", version ? `${identifier}@${version}` : identifier];
  // runtimeArguments 是包作者声明的固定参数（如 -y / --flag），避免与默认 -y 重复
  if (Array.isArray(pkg.runtimeArguments)) {
    for (const item of pkg.runtimeArguments) {
      if (isRecord(item) && typeof item.value === "string" && !args.includes(item.value)) {
        args.push(item.value);
      }
    }
  }
  return {
    kind: "stdio",
    command: "npx",
    args,
    env: normalizeEnvVars(pkg.environmentVariables),
    matchKey: identifier,
  };
}

/** pypi 包 → uvx stdio 模板（需要本机安装 uv）。 */
function templateFromPypiPackage(pkg: Record<string, unknown>): McpMarketTemplate | null {
  const identifier = optionalString(pkg.identifier);
  if (!identifier) return null;
  const version = optionalString(pkg.version);
  return {
    kind: "stdio",
    command: "uvx",
    args: [version ? `${identifier}==${version}` : identifier],
    env: normalizeEnvVars(pkg.environmentVariables),
    matchKey: identifier,
  };
}

/** remotes → streamable-http 模板。 */
function templateFromRemote(remote: Record<string, unknown>): McpMarketTemplate | null {
  const url = optionalString(remote.url);
  if (!url) return null;
  return {
    kind: "http",
    url,
    headers: normalizeHeaders(remote.headers),
    env: normalizeEnvVars(remote.environmentVariables),
    matchKey: url,
  };
}

/**
 * 宽松归一化一条注册表记录：npm > remote > pypi（Node 随 pi 必装，uvx 需另装 uv），
 * 不可映射的形态（docker 等）返回 null。导出仅供测试。
 *
 * 入参为列表项包装 `{ server, _meta }`：官方状态元数据在包装层 `_meta`，
 * 发布者扩展元数据在 `server._meta`（与实测响应一致）。
 */
export function normalizeMarketServer(raw: unknown): McpMarketEntry | null {
  if (!isRecord(raw)) return null;
  const server = isRecord(raw.server) ? raw.server : null;
  if (!server) return null;
  const name = optionalString(server.name);
  if (!name) return null;

  let template: McpMarketTemplate | null = null;
  let needsUv = false;
  if (Array.isArray(server.packages)) {
    const npm = server.packages.find(
      (item): item is Record<string, unknown> => isRecord(item) && item.registryType === "npm",
    );
    if (npm) {
      template = templateFromNpmPackage(npm);
    } else {
      const pypi = server.packages.find(
        (item): item is Record<string, unknown> => isRecord(item) && item.registryType === "pypi",
      );
      if (pypi) {
        template = templateFromPypiPackage(pypi);
        needsUv = true;
      }
    }
  }
  if (!template && Array.isArray(server.remotes)) {
    const remote = server.remotes.find(isRecord);
    if (remote) template = templateFromRemote(remote);
  }
  if (!template) return null;

  const officialMeta = isRecord(raw._meta)
    ? raw._meta["io.modelcontextprotocol.registry/official"]
    : undefined;
  const official = isRecord(officialMeta) ? officialMeta : undefined;
  // isLatest 显式为 false 的是历史版本记录（未带 version=latest 查询时）：跳过
  if (official && official.isLatest === false) return null;

  const serverMeta = isRecord(server._meta) ? server._meta : undefined;
  const publisherMeta = isRecord(
    serverMeta?.["io.modelcontextprotocol.registry/publisher-provided"],
  )
    ? serverMeta["io.modelcontextprotocol.registry/publisher-provided"]
    : undefined;
  const repository = isRecord(server.repository) ? server.repository : undefined;

  return {
    id: name,
    title: optionalString(publisherMeta?.title),
    description: optionalString(server.description) ?? "",
    repositoryUrl: optionalString(repository?.url),
    version: optionalString(server.version),
    source: "registry",
    suggestName: suggestServerName(name),
    needsUv,
    template,
  };
}

function cacheFilePath(): string {
  return path.join(app.getPath("userData"), CACHE_FILENAME);
}

function loadCache(): CacheFile {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(cacheFilePath(), "utf8"));
    cache = isRecord(parsed) ? (parsed as CacheFile) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function saveCache(): void {
  if (!cache) return;
  try {
    fs.writeFileSync(cacheFilePath(), JSON.stringify(cache), "utf8");
  } catch {
    // 缓存写失败不影响功能：下次重新拉取
  }
}

function readCacheValue(key: string): CacheValue | null {
  const value = loadCache()[key];
  if (!value) return null;
  if (Date.now() - value.fetchedAt > CACHE_TTL_MS) return null;
  return value;
}

function writeCacheValue(key: string, value: CacheValue): void {
  const file = loadCache();
  file[key] = value;
  // LRU 修剪：超容量时淘汰最旧的
  const keys = Object.keys(file);
  if (keys.length > CACHE_MAX_KEYS) {
    keys
      .sort((a, b) => file[a].fetchedAt - file[b].fetchedAt)
      .slice(0, keys.length - CACHE_MAX_KEYS)
      .forEach((stale) => {
        delete file[stale];
      });
  }
  saveCache();
}

async function fetchRegistryPage(
  query: string,
  cursor: string | null,
): Promise<McpMarketSearchResult> {
  const url = new URL(REGISTRY_BASE_URL);
  url.searchParams.set("version", "latest");
  url.searchParams.set("limit", String(PAGE_LIMIT));
  if (query) url.searchParams.set("search", query);
  if (cursor) url.searchParams.set("cursor", cursor);

  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "PiDesk-MCP-Market" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`MCP Registry 返回 ${response.status}`);
  }
  const parsed: unknown = await response.json();
  if (!isRecord(parsed) || !Array.isArray(parsed.servers)) {
    throw new Error("MCP Registry 返回了意外结构");
  }
  const entries = parsed.servers
    .map((item) => normalizeMarketServer(item))
    .filter((item): item is McpMarketEntry => item !== null);
  const metadata = isRecord(parsed.metadata) ? parsed.metadata : {};
  return {
    entries,
    nextCursor: optionalString(metadata.nextCursor) ?? null,
    source: "registry",
  };
}

/**
 * 市场搜索：空 query 走精选清单（不出网）；非空走 registry，首页结果带缓存。
 * 同一 query 的并发请求 single-flight；网络失败向上抛错（渲染层提示，精选仍可用）。
 */
export async function searchMarket(req: McpMarketSearchRequest): Promise<McpMarketSearchResult> {
  const query = (req.query ?? "").trim().toLowerCase();
  const cursor = typeof req.cursor === "string" && req.cursor ? req.cursor : null;

  if (!query) {
    return { entries: MARKET_CURATED_ENTRIES, nextCursor: null, source: "curated" };
  }
  // 翻页请求实时拉取，不缓存
  if (cursor) return fetchRegistryPage(query, cursor);

  const cached = readCacheValue(query);
  if (cached) {
    return { entries: cached.entries, nextCursor: cached.nextCursor, source: "registry" };
  }
  const pending = inFlight.get(query);
  if (pending) return pending;
  const task = fetchRegistryPage(query, null)
    .then((result) => {
      writeCacheValue(query, {
        fetchedAt: Date.now(),
        entries: result.entries,
        nextCursor: result.nextCursor,
      });
      return result;
    })
    .finally(() => {
      inFlight.delete(query);
    });
  inFlight.set(query, task);
  return task;
}
