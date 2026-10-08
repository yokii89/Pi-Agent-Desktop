/**
 * 登录态粘贴导入的纯解析逻辑（docs/design/09 M1）。
 * 不依赖 Electron，便于 vitest 直接测（src/main/vitest.config.ts）。
 */

/** 常见 Cookie 属性词：用户若整段粘贴 Set-Cookie 会混入，解析时跳过。 */
const ATTRIBUTE_NAMES = new Set([
  "path",
  "domain",
  "expires",
  "max-age",
  "secure",
  "httponly",
  "samesite",
  "priority",
  "partitioned",
]);

/**
 * 解析粘贴的 Cookie 文本。
 * 支持 `a=1; b=2` 与换行分隔；同名后者覆盖前者。
 */
export function parsePastedCookiePairs(raw: string): { name: string; value: string }[] {
  const text = raw.trim();
  if (!text) return [];
  const normalized = text.replace(/\r?\n/g, "; ");
  const seen = new Map<string, string>();
  for (const part of normalized.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name || ATTRIBUTE_NAMES.has(name.toLowerCase())) continue;
    // Cookie 名不允许空白与分隔符；值里不应再出现未转义分号（已按 ; 切开）
    if (/[\s;,]/.test(name)) continue;
    seen.set(name, value);
  }
  return [...seen.entries()].map(([name, value]) => ({ name, value }));
}

/** 把用户输入的 host / URL 收成 cookie 用的 hostname（去 scheme、端口、前导点）。 */
export function normalizeCookieHost(input: string): string {
  let host = input.trim();
  if (!host) throw new Error("请填写目标站点");
  if (/^https?:\/\//i.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      throw new Error("目标站点格式不正确");
    }
  } else {
    host = host.replace(/:\d+$/, "");
  }
  host = host.replace(/^\./, "").toLowerCase();
  if (!host || /\s/.test(host) || host.includes("/")) {
    throw new Error("目标站点格式不正确");
  }
  return host;
}

/** 与 browserView.normalizeUrl 同构：本地/IPv4 走 http，其余 https。 */
export function isLocalCookieHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  );
}

/** 计算 cookies.set 用的 origin（含尾部 `/`）。 */
export function cookieOriginUrl(host: string, secure: boolean | undefined): string {
  const useHttps = secure ?? !isLocalCookieHost(host);
  return `${useHttps ? "https" : "http"}://${host}/`;
}
