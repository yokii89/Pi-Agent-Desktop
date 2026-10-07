import { session } from "electron";
import type {
  BrowserApplyLoginCookiesRequest,
  BrowserApplyLoginCookiesResult,
  BrowserApplyPastedCookiesRequest,
  BrowserApplyPastedCookiesResult,
  BrowserLoginSource,
  BrowserPreviewLoginCookiesRequest,
  BrowserPreviewLoginCookiesResult,
} from "../../shared/ipc";
import { readChromiumLoginCookies } from "./chromiumLoginRead";
import { listChromiumLoginSources } from "./chromiumLoginSource";
import {
  cookieOriginUrl,
  isLocalCookieHost,
  normalizeCookieHost,
  parsePastedCookiePairs,
} from "./loginImportParse";

export {
  cookieOriginUrl,
  isLocalCookieHost,
  normalizeCookieHost,
  parsePastedCookiePairs,
} from "./loginImportParse";

/** 与 WebContentsView 一致的持久分区（docs/design/05 §7.3）。 */
export const BROWSER_PARTITION = "persist:browser";

/** 粘贴导入默认有效期（秒）：避免纯 session Cookie 在视图重建后立刻丢失。 */
const DEFAULT_MAX_AGE_SEC = 60 * 60 * 24 * 30;

let sourceCache: { at: number; list: BrowserLoginSource[] } | null = null;
const SOURCE_CACHE_MS = 30_000;

/** 列出本机 Chromium Profile；短缓存避免每次打开对话框都扫盘 + 查注册表。 */
export async function listBrowserLoginSources(): Promise<BrowserLoginSource[]> {
  const now = Date.now();
  if (sourceCache && now - sourceCache.at < SOURCE_CACHE_MS) {
    return sourceCache.list;
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    throw new Error("无法定位本机应用数据目录");
  }
  const list = await listChromiumLoginSources(localAppData);
  sourceCache = { at: now, list };
  return list;
}

function requireSource(sourceId: string, list: BrowserLoginSource[]): BrowserLoginSource {
  const found = list.find((s) => s.id === sourceId);
  if (!found) throw new Error("未找到所选浏览器 Profile");
  return found;
}

/**
 * 将粘贴的 Cookie 写入 persist:browser 分区（docs/design/09 M1）。
 * 不依赖 WebContentsView 是否已创建；成功后 flushStore 保证落盘。
 */
export async function applyPastedLoginCookies(
  req: BrowserApplyPastedCookiesRequest,
): Promise<BrowserApplyPastedCookiesResult> {
  const host = normalizeCookieHost(req.host ?? "");
  const pairs = parsePastedCookiePairs(req.raw ?? "");
  if (pairs.length === 0) {
    throw new Error("未识别到 Cookie，请使用 name=value; name2=value2 格式");
  }

  const url = cookieOriginUrl(host, req.secure);
  const secure = url.startsWith("https:");
  const ses = session.fromPartition(BROWSER_PARTITION);
  const expirationDate = Math.floor(Date.now() / 1000) + DEFAULT_MAX_AGE_SEC;
  const names: string[] = [];

  for (const { name, value } of pairs) {
    await ses.cookies.set({
      url,
      name,
      value,
      path: "/",
      secure,
      httpOnly: false,
      expirationDate,
      sameSite: "unspecified",
    });
    names.push(name);
  }

  await ses.cookies.flushStore();
  // 结果只回传名称，避免 value 经 IPC 回流到渲染层（docs/design/09 §6）
  return { applied: names.length, names };
}

/**
 * 预览本机浏览器中将导入的 Cookie 名称（docs/design/09 M2）。
 * value 不离开主进程。
 */
export async function previewBrowserLoginCookies(
  req: BrowserPreviewLoginCookiesRequest,
): Promise<BrowserPreviewLoginCookiesResult> {
  const list = await listBrowserLoginSources();
  const source = requireSource(req.sourceId, list);
  const host = normalizeCookieHost(req.host ?? "");
  const result = await readChromiumLoginCookies(source, host);
  return {
    names: result.cookies.map((c) => c.name),
    failed: result.failed,
    warnings: result.warnings,
  };
}

/**
 * 从本机 Chromium Profile 读取匹配 host 的 Cookie 并写入 persist:browser（M2）。
 * 写入时按 cookie 保留 path / secure / httpOnly / sameSite / 过期时间。
 */
export async function applyBrowserLoginCookies(
  req: BrowserApplyLoginCookiesRequest,
): Promise<BrowserApplyLoginCookiesResult> {
  const list = await listBrowserLoginSources();
  const source = requireSource(req.sourceId, list);
  const host = normalizeCookieHost(req.host ?? "");
  const result = await readChromiumLoginCookies(source, host);
  if (result.cookies.length === 0) {
    const hint =
      result.failed > 0
        ? "未能解密该站点的 Cookie，可改用手动粘贴"
        : "该 Profile 下没有匹配此站点的 Cookie";
    throw new Error(hint);
  }

  const ses = session.fromPartition(BROWSER_PARTITION);
  const names: string[] = [];

  for (const cookie of result.cookies) {
    // secure Cookie 必须挂到 https origin；其余沿用本地 http / 外网 https
    const url = cookie.secure
      ? `https://${host}/`
      : cookieOriginUrl(host, isLocalCookieHost(host) ? false : undefined);
    const path = cookie.path.startsWith("/") ? cookie.path : `/${cookie.path}`;
    await ses.cookies.set({
      url,
      name: cookie.name,
      value: cookie.value,
      path: path || "/",
      // host-only：不写 domain，避免误共享到父域
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expirationDate,
      sameSite: cookie.sameSite,
    });
    names.push(cookie.name);
  }

  await ses.cookies.flushStore();
  return { applied: names.length, names, warnings: result.warnings };
}
