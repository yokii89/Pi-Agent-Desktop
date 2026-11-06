/**
 * 站点 favicon 抓取（主进程收口，路线同 gitAvatar：CSP、超时、避免渲染层外链）：
 *
 * 1. `{origin}/favicon.ico` 直取；
 * 2. 明确没有再拉 origin HTML 做 `<link rel~=icon>` 发现，按站点声明顺序补试
 *    （很多站点 favicon 不在约定路径，只走第 1 步覆盖不了）。
 *
 * 抓取结果分三档（`IconOutcome`），三档各配一种缓存有效期——本模块的关键约束：
 * 把「这一次没网」记成「这站没有图标」，图标就会在站点早就恢复之后仍然整日不出来。
 * 实测：一次网络抖动把 github 写进 12 小时失败缓存后，同一 URL 再问只用 0ms 返回 null，
 * 而当时直连抓同一个 favicon 是 200 / 1.6s。
 *
 * 结果按 origin 落盘缓存（命中 30 天 / 确认无图标 12 小时 / 抖动退避 60 秒，LRU 上限），
 * 渲染层每会话每站点只打一次 IPC；不用第三方 favicon 服务（境外服务不可达且有隐私顾虑）。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  classifyIconResponse,
  extractFaviconOrigin,
  extractIconHrefs,
  mimeToExt,
} from "./faviconResolver";

const CACHE_DIRNAME = "favicon-cache";
const INDEX_FILENAME = "index.json";
/** 命中缓存有效期：favicon 极少变更。 */
const OK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 确认「这站没有图标」的缓存有效期：站点修好后能较快恢复。 */
const MISS_TTL_MS = 12 * 60 * 60 * 1000;
/** 抓取抖动（超时 / 断网 / 5xx）的退避：短到下一条消息就能重试，长到不会反复打网络。 */
const RETRY_TTL_MS = 60 * 1000;
const CACHE_MAX_KEYS = 300;
const ICON_TIMEOUT_MS = 5000;
const MAX_ICON_BYTES = 256 * 1024;
const HTML_TIMEOUT_MS = 5000;
const HTML_MAX_BYTES = 256 * 1024;
/** link 发现最多补试的候选数（favicon.ico 已试过，这里只补声明出来的）。 */
const MAX_ICON_CANDIDATES = 2;

interface CacheEntry {
  ok: boolean;
  /** ok 时：缓存文件名（index 同目录）。 */
  file?: string;
  /** ok 时：图片 MIME，重建 data URL 用。 */
  mime?: string;
  /** 未命中时：true 表示这次是抓取抖动而非「站点确认没图标」，走 RETRY_TTL_MS。 */
  retry?: boolean;
  /** 未命中时：一句结论（timeout / network / http 404 / size 0…），只落 index.json 供排查。 */
  note?: string;
  fetchedAt: number;
}

type CacheFile = Record<string, CacheEntry>;

/** 抓取三分类，含义见文件头。 */
type IconOutcome = "ok" | "absent" | "retry";

/** ok 分支必带字节，落盘与重建 data URL 不用再判空。 */
type IconResult =
  | { outcome: "ok"; mime: string; bytes: Buffer; note: string }
  | { outcome: Exclude<IconOutcome, "ok">; note: string };

let indexCache: CacheFile | null = null;

function cacheDir(): string {
  return path.join(app.getPath("userData"), CACHE_DIRNAME);
}

function cacheFilePath(): string {
  return path.join(cacheDir(), INDEX_FILENAME);
}

function loadIndex(): CacheFile {
  if (indexCache) return indexCache;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(cacheFilePath(), "utf8"));
    indexCache = parsed && typeof parsed === "object" ? (parsed as CacheFile) : {};
  } catch {
    indexCache = {};
  }
  return indexCache;
}

function saveIndex(): void {
  if (!indexCache) return;
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(cacheFilePath(), JSON.stringify(indexCache), "utf8");
  } catch {
    // 缓存写失败不影响功能：下次重新抓取
  }
}

/** LRU 修剪：超容量时按 fetchedAt 淘汰最旧条目并删除对应二进制文件。 */
function trimIndex(): void {
  const file = loadIndex();
  const keys = Object.keys(file);
  if (keys.length <= CACHE_MAX_KEYS) return;
  keys
    .sort((a, b) => (file[a]?.fetchedAt ?? 0) - (file[b]?.fetchedAt ?? 0))
    .slice(0, keys.length - CACHE_MAX_KEYS)
    .forEach((stale) => {
      const entry = file[stale];
      delete file[stale];
      if (entry?.file) {
        try {
          fs.unlinkSync(path.join(cacheDir(), entry.file));
        } catch {
          // 文件已不存在：忽略
        }
      }
    });
}

function entryToDataUrl(entry: CacheEntry): string | null {
  if (!entry.ok || !entry.file || !entry.mime) return null;
  try {
    const bytes = fs.readFileSync(path.join(cacheDir(), entry.file));
    if (bytes.length === 0) return null;
    return `data:${entry.mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function miss(outcome: Exclude<IconOutcome, "ok">, note: string): IconResult {
  return { outcome, note };
}

/**
 * 拉一个候选图标 URL。状态码与 MIME 的分类在 faviconResolver（可纯测），
 * 这里只补「取字节 + 体积闸」这一段。
 */
async function fetchIconBytes(url: string): Promise<IconResult> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(ICON_TIMEOUT_MS),
    });
    const contentType = response.headers.get("content-type") ?? "";
    const outcome = classifyIconResponse(response.status, contentType);
    if (outcome !== "ok") return miss(outcome, `http ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) {
      return miss("absent", `size ${bytes.length}`);
    }
    return {
      outcome: "ok",
      mime: contentType.split(";")[0]?.trim().toLowerCase() ?? "",
      bytes,
      note: "ok",
    };
  } catch (error) {
    const name = (error as { name?: string } | null)?.name ?? "";
    return miss("retry", name === "TimeoutError" ? "timeout" : "network");
  }
}

/** HTML 里的 link 发现；result 非空表示这一步已有结论（含抖动）。 */
async function discoverIconCandidates(
  origin: string,
): Promise<{ candidates: string[]; result: IconResult | null }> {
  try {
    const response = await fetch(origin, {
      headers: { Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { candidates: [], result: miss("absent", `html ${response.status}`) };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return { candidates: [], result: miss("absent", "html type") };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    // 图标声明在 <head>，超长页面截断到头部片段即可
    const html = bytes.subarray(0, HTML_MAX_BYTES).toString("utf8");
    // 相对路径按重定向后的最终 URL 解析（站点常把图标挂在别的域）
    return {
      candidates: extractIconHrefs(html, response.url || origin, MAX_ICON_CANDIDATES),
      result: null,
    };
  } catch {
    return { candidates: [], result: miss("retry", "html network") };
  }
}

async function fetchFresh(origin: string): Promise<IconResult> {
  const direct = await fetchIconBytes(`${origin}/favicon.ico`);
  if (direct.outcome === "ok") return direct;
  // 抖动就地收口：不去追问「这站有没有图标」，退避到期后整条链路重来
  if (direct.outcome === "retry") return direct;
  const { candidates, result } = await discoverIconCandidates(origin);
  if (result) return result;
  let last = miss("absent", "no icon link");
  for (const candidate of candidates) {
    const attempt = await fetchIconBytes(candidate);
    if (attempt.outcome !== "absent") return attempt;
    last = attempt;
  }
  return last;
}

/** 命中结果（带字节），落盘与 data URL 都由它一次生成。 */
type IconHit = Extract<IconResult, { outcome: "ok" }>;

/** 命中结果落盘（二进制 + index），返回同一条 data URL。 */
function storeIcon(origin: string, hit: IconHit): string {
  const dataUrl = `data:${hit.mime};base64,${hit.bytes.toString("base64")}`;
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    const hash = createHash("sha1").update(origin).digest("hex");
    const fileName = `${hash}.${mimeToExt(hit.mime)}`;
    fs.writeFileSync(path.join(cacheDir(), fileName), hit.bytes);
    const file = loadIndex();
    file[origin] = { ok: true, file: fileName, mime: hit.mime, fetchedAt: Date.now() };
    trimIndex();
    saveIndex();
  } catch {
    // 落盘失败：本次会话仍能用内存里的结果，下次重抓
  }
  return dataUrl;
}

function storeMiss(origin: string, result: IconResult): void {
  const file = loadIndex();
  file[origin] = {
    ok: false,
    retry: result.outcome === "retry" ? true : undefined,
    note: result.note,
    fetchedAt: Date.now(),
  };
  trimIndex();
  saveIndex();
}

function ttlOf(entry: CacheEntry): number {
  if (entry.ok) return OK_TTL_MS;
  return entry.retry ? RETRY_TTL_MS : MISS_TTL_MS;
}

/**
 * 抓取页面 URL 所属站点的 favicon，返回 data URL。
 * 非 http(s)、超时、无图标一律 null（渲染层用 Phosphor 兜底）。
 */
export async function resolveFaviconDataUrl(pageUrl: string): Promise<string | null> {
  const origin = extractFaviconOrigin(pageUrl);
  if (!origin) return null;
  const index = loadIndex();
  const entry = index[origin];
  if (entry && Date.now() - entry.fetchedAt <= ttlOf(entry)) {
    if (!entry.ok) return null;
    const cached = entryToDataUrl(entry);
    // 文件丢了（被用户清理等）：当作未缓存重新抓
    if (cached) return cached;
  }
  const result = await fetchFresh(origin);
  if (result.outcome !== "ok") {
    storeMiss(origin, result);
    return null;
  }
  return storeIcon(origin, result);
}
