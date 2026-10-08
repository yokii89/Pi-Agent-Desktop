/**
 * 全量导入本机浏览器数据（Cookie / LocalStorage）的纯逻辑，无 Electron 依赖，便于单测。
 * 动机与实测见 docs/design/42 §6.6：面板要承接 Google 等三方登录，必须把本机 Chrome 的
 * **完整** 登录态搬进 `persist:browser`，而不是只搬「当前站点能匹配到的几条 Cookie」。
 */

/**
 * Chrome cookie 库里的 session Cookie（`expires_utc = 0`）在 Electron 里没有过期时间，
 * 视图重建 / 进程退出即丢。导入时按 Chromium 自身对持久 Cookie 的上限（400 天）落一个
 * 明确过期时间，与 ZCode `chromeCookieMapping.ts` 的选择一致。
 */
export const IMPORTED_SESSION_COOKIE_MAX_AGE_SEC = 400 * 24 * 60 * 60;

/** CDP `Storage.getCookies` 返回的 Cookie 形状（只声明用到的字段）。 */
export interface ChromiumHelperCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  session?: boolean;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  sourceScheme?: string;
  partitionKey?: unknown;
}

/**
 * 导入用的归一 Cookie 形状：把「CDP 来的」与「进程内解密来的」两条来源收敛成同一份语义，
 * 后面只有一套映射逻辑（两个来源的 sameSite 词表不同，归一在这里做掉）。
 */
export interface ImportCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** unix 秒；缺省或 <= 0 视为 session Cookie。 */
  expires?: number;
  sameSite: Electron.CookiesSetDetails["sameSite"];
}

export type ImportCookieResult =
  | { kind: "ok"; cookie: ImportCookie }
  | { kind: "skip"; reason: "partitioned" | "invalid" };

/** CDP sameSite → Electron sameSite（CDP 不发该字段表示未指定）。 */
function mapHelperSameSite(value: string | undefined): Electron.CookiesSetDetails["sameSite"] {
  if (value === "Strict") return "strict";
  if (value === "Lax") return "lax";
  if (value === "None") return "no_restriction";
  return "unspecified";
}

/** CDP Cookie → 归一 Cookie。 */
export function helperCookieToImportCookie(cookie: ChromiumHelperCookie): ImportCookieResult {
  const domain = (cookie.domain ?? "").trim();
  if (!cookie.name || !domain || /\s/.test(domain) || !domain.replace(/^\./, "")) {
    return { kind: "skip", reason: "invalid" };
  }
  // 分区 Cookie（CHIPS）跳过：Electron 33 的 cookies.set 写不了分区键，降级写回普通 Cookie
  // 会把作用域**放大**，宁可少导入。
  if (cookie.partitionKey) return { kind: "skip", reason: "partitioned" };

  const path = cookie.path?.startsWith("/") ? cookie.path : "/";
  const expires = cookie.expires && cookie.expires > 0 ? cookie.expires : undefined;
  return {
    kind: "ok",
    cookie: {
      name: cookie.name,
      value: cookie.value ?? "",
      domain,
      path,
      secure: cookie.secure === true || cookie.sourceScheme === "Secure",
      httpOnly: cookie.httpOnly === true,
      sameSite: mapHelperSameSite(cookie.sameSite),
      ...(cookie.session || expires === undefined ? {} : { expires }),
    },
  };
}

/**
 * Chromium 对 `__Host-` / `__Secure-` 前缀 Cookie 有强约束（分别要求无 Domain 属性、
 * 要求 Secure），照抄源 Cookie 的属性写回时若违反约束会被 cookies.set 直接拒绝。
 * 这里按前缀把约束补齐，而不是把整条 Cookie 丢掉。
 */
function applyNamePrefixConstraints(
  name: string,
  details: Electron.CookiesSetDetails,
): Electron.CookiesSetDetails {
  if (name.startsWith("__Host-")) {
    // __Host-：必须无 Domain、Path=/、Secure
    const { domain: _domain, ...rest } = details;
    return { ...rest, path: "/", secure: true };
  }
  if (name.startsWith("__Secure-")) {
    return { ...details, secure: true };
  }
  return details;
}

/**
 * 归一 Cookie → `session.cookies.set` 入参。
 *
 * 两条保真要点（对齐 ZCode `chromeCookieMapping.toCookieDetails`，也是 docs/design/09
 * 「按 host 过滤 + 一律写成 host-only」的修正点）：
 * 1. `domain` 以 `.` 开头的是**域 Cookie**，必须把 `domain` 属性带上，否则 `google.com`
 *    的域 Cookie 不会发给 `accounts.google.com`——半套会话在内嵌浏览器里比干净分区更糟
 *    （docs/design/42 §6.1 的实测现象由此而来）；
 * 2. session Cookie 落一个明确过期时间，否则面板视图重建就丢登录态。
 */
export function importCookieToDetails(
  cookie: ImportCookie,
  importedAtSec: number,
): Electron.CookiesSetDetails {
  const host = cookie.domain.replace(/^\./, "");
  const isDomainCookie = cookie.domain.startsWith(".");
  const path = cookie.path.startsWith("/") ? cookie.path : "/";
  const details: Electron.CookiesSetDetails = {
    // 域名 Cookie 的 url host 取去掉前导点的同名 host：Chromium 只要求 url 落在 domain 内
    url: `${cookie.secure ? "https" : "http"}://${host}${path}`,
    name: cookie.name,
    value: cookie.value,
    ...(isDomainCookie ? { domain: cookie.domain } : {}),
    path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate:
      cookie.expires && cookie.expires > 0
        ? cookie.expires
        : importedAtSec + IMPORTED_SESSION_COOKIE_MAX_AGE_SEC,
  };
  return applyNamePrefixConstraints(cookie.name, details);
}

/**
 * 一次全量导入最多处理的 LocalStorage origin 数。
 *
 * 源侧读取要逐个 origin 导航（CDP 的 `DOMStorage` 域要求 frame 的 origin 与 storageId 一致，
 * 不能凭空读别的 origin），单 origin 一个导航，因此必须设上限，避免一次导入把面板卡成
 * 几十分钟。当前站点排在最前，超出上限的尾部 origin 会被丢弃。
 */
export const LOCAL_STORAGE_MAX_ORIGINS = 200;

/** 单个 origin 的导航 + 读取超时；超时按「该 origin 失败」处理，不打断整体导入。 */
export const LOCAL_STORAGE_ORIGIN_TIMEOUT_MS = 8_000;

/**
 * 从 Chrome LocalStorage 的 LevelDB 内容里扫出 origin。
 *
 * Chrome 的 LocalStorage metadata key 形如 `META:https://example.com`（latin1 可见），
 * 这里只提取 origin 字符串，不解析任何 entry 值——真实值交给浏览器 helper 通过同源 API 读
 * （同 ZCode `discoverChromeLocalStorageOrigins`）。字符集卡在 host 允许的范围内，避免把
 * 邻接的二进制 / 历史字节粘进 origin。
 *
 * `selectLocalStorageOrigins` 把当前站点排在最前：上限截断时先保用户当下在用的站点，
 * 而不是按字母序随便留一批。
 */
export function parseLocalStorageOrigins(text: string): string[] {
  const origins = new Set<string>();
  const pattern = /META:(https?:\/\/(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::\d{1,5})?)/g;
  for (const match of text.matchAll(pattern)) {
    const candidate = match[1];
    if (!candidate || !isPlausibleOrigin(candidate)) continue;
    origins.add(candidate);
  }
  return [...origins].sort();
}

/**
 * 过滤 LevelDB 二进制 / 历史字节造出的假 origin。
 *
 * `META:` 前面是 LevelDB 的长度前缀（可能是任意字节），所以匹配点可能在二进制块里，
 * 沿着可打印字符一直粘出一个「看起来合法但没有点」的 host。真实 LocalStorage origin
 * 的 host 必然带点（域名）或是 localhost / IP，其余一律当噪声。
 */
function isPlausibleOrigin(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.origin !== candidate) return false;
  const host = url.hostname;
  return host === "localhost" || host.includes(".") || host.includes(":");
}

/**
 * 排序 + 截断 LocalStorage origin 队列：`preferredOrigin` 排最前，其余按字母序，最后按
 * `LOCAL_STORAGE_MAX_ORIGINS` 截断。扫多个 LevelDB 文件时先汇总再调一次，保证顺序一致。
 */
export function selectLocalStorageOrigins(
  origins: Iterable<string>,
  preferredOrigin?: string,
): string[] {
  const all = new Set(origins);
  const rest = [...all].filter((origin) => origin !== preferredOrigin).sort();
  const head = preferredOrigin && all.has(preferredOrigin) ? [preferredOrigin] : [];
  return [...head, ...rest].slice(0, LOCAL_STORAGE_MAX_ORIGINS);
}

/**
 * 源侧读取某个 origin 的 LocalStorage 的页内表达式。
 *
 * 先校验 `location.origin`：导航可能被重定向到别的 origin（登录跳转、www 归一），
 * 那时 `localStorage` 已经是另一个站点的存储，读出来是错的数据。origin 不符返回 null，
 * 由调用方按该 origin 失败处理。
 */
export function buildLocalStorageReadExpression(origin: string): string {
  return `(() => (location.origin === ${JSON.stringify(origin)} ? Object.entries(localStorage) : null))()`;
}

/**
 * 目标侧（面板分区）写入 LocalStorage 的页内表达式。
 *
 * 用 JSON 字面量把键值直接内联，避免再拼一层字符串转义；返回实际写入条数供统计。
 */
export function buildLocalStorageWriteExpression(entries: Array<[string, string]>): string {
  return `(() => { const entries = ${JSON.stringify(entries)}; for (const [k, v] of entries) { localStorage.setItem(k, v); } return entries.length; })()`;
}
