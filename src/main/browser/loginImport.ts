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
import { type ImportCookie, importCookieToDetails } from "./browserDataImportRules";
import { BROWSER_PARTITION } from "./browserPolicyRules";
import { readChromiumLoginCookies } from "./chromiumLoginRead";
import { listChromiumLoginSources } from "./chromiumLoginSource";
import { parseDevtoolsCookieTable } from "./devtoolsCookieTable";
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

// 分区名单一来源在浏览器策略规则模块；此处再导出，维持既有 import 路径
// （docs/design/05 §7.3）可用。
export { BROWSER_PARTITION };

interface SourceCacheEntry {
  at: number;
  list: BrowserLoginSource[];
}

let sourceCache: SourceCacheEntry | null = null;
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
/**
 * 粘贴导入（docs/design/09 M1；表格格式见 docs/design/42 §6.7）。
 *
 * 两种输入：
 * 1. **DevTools Cookie 表格**（Application → Cookies → 选中 → Ctrl+C）：自带 Domain / Path /
 *    Expires / HttpOnly / Secure / SameSite，因此域 Cookie 与 host-only Cookie、有效期都能
 *    如实还原。这是现代 Chrome（App-Bound 加密）下**不依赖提权**即可接手登录态的路。
 * 2. **`name=value; …`**（Cookie 头 / Copy as cURL）：信息不全，按 `req.host` 写成 host-only。
 *
 * 成功后 flushStore 保证落盘；不依赖 WebContentsView 是否已创建。
 */
export async function applyPastedLoginCookies(
  req: BrowserApplyPastedCookiesRequest,
): Promise<BrowserApplyPastedCookiesResult> {
  const tableCookies = parseDevtoolsCookieTable(req.raw ?? "");
  const cookies = tableCookies ?? pairCookiesToImportCookies(req.raw ?? "", req.host, req.secure);
  if (cookies.length === 0) {
    throw new Error("未识别到 Cookie，请粘贴 DevTools Cookie 表格或 name=value; name2=value2");
  }

  const ses = session.fromPartition(BROWSER_PARTITION);
  const importedAtSec = Math.floor(Date.now() / 1000);
  const names: string[] = [];
  let failed = 0;

  for (const cookie of cookies) {
    // 写回规则共用导入侧的映射：域 Cookie 带 domain、session Cookie 落 400 天、
    // `__Host-` / `__Secure-` 前缀约束补齐（docs/design/42 §6.6）
    await ses.cookies
      .set(importCookieToDetails(cookie, importedAtSec))
      .then(() => names.push(cookie.name))
      .catch(() => {
        failed += 1;
      });
  }

  await ses.cookies.flushStore();
  // 结果只回传名称，避免 value 经 IPC 回流到渲染层（docs/design/09 §6）
  return {
    applied: names.length,
    names,
    ...(failed > 0
      ? { warnings: [`有 ${failed} 条 Cookie 写入失败（格式或作用域不被接受）`] }
      : {}),
  };
}

/**
 * `name=value` 粘贴 → 归一 Cookie。
 *
 * 没有 Domain 信息，只能按用户填的目标站点写成 host-only；secure 由 scheme 推导（本地 host 默认
 * http，其余 https）。不传 `expires`，由 `importCookieToDetails` 落 Chromium 的 400 天上限。
 */
function pairCookiesToImportCookies(
  raw: string,
  host: string | undefined,
  secure: boolean | undefined,
): ImportCookie[] {
  const pairs = parsePastedCookiePairs(raw);
  if (pairs.length === 0) return [];
  const target = normalizeCookieHost(host ?? "");
  const useHttps = secure ?? !isLocalCookieHost(target);
  return pairs.map((pair) => ({
    name: pair.name,
    value: pair.value,
    domain: target,
    path: "/",
    secure: useHttps,
    httpOnly: false,
    sameSite: "unspecified",
  }));
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
    // 域 Cookie（host_key 带前导点）必须保留 domain 属性，否则只写给目标 host，
    // 子域 / 兄弟域（`accounts.google.com` 这类 SSO 链路）拿不到登录态
    const isDomainCookie = cookie.hostKey.startsWith(".") && !isLocalCookieHost(host);
    await ses.cookies.set({
      url,
      name: cookie.name,
      value: cookie.value,
      path: path || "/",
      ...(isDomainCookie ? { domain: cookie.hostKey } : {}),
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
