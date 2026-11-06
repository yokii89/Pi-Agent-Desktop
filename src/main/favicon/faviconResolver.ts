/**
 * favicon 解析纯逻辑（不依赖 electron，可纯测）：
 * 页面 URL → origin，站点 HTML → `<link rel~=icon>` 候选，MIME → 缓存文件扩展名。
 */

/** 只认 http(s)：气泡里的 URL 以外才是别的协议， favicon 也只在 web 上存在。 */
export function extractFaviconOrigin(pageUrl: string): string | null {
  try {
    const parsed = new URL(pageUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * HTTP 响应 → 「这个地址上有没有图标」。三档的差别只在缓存该记多久，见 faviconService 文件头：
 * - ok：2xx 且 image/*；
 * - absent：这一步确认没有（404/410，或 2xx 但返回的不是图片），可以去下一路找；
 * - retry：状态码说的是服务器/链路抖动（5xx、429、重定向环、被网关吃掉），
 *   不能由此断言「这站没有图标」。
 */
export function classifyIconResponse(
  status: number,
  contentType: string,
): "ok" | "absent" | "retry" {
  if (status >= 300 && status < 400) return "retry";
  if (status === 404 || status === 410) return "absent";
  if (status < 200 || status >= 300) return "retry";
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return mime.startsWith("image/") ? "ok" : "absent";
}

const LINK_TAG_RE = /<link\b[^>]*>/gi;
const ATTR_RE = /\b(rel|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/**
 * 从 HTML 里按文档顺序提取 icon 候选（rel 含 "icon" 的 `<link>`）。
 * 相对路径按 base 解析；data:image 直通（fetchImageDataUrl 按 image/* 校验会放行）。
 * 上限 3 条：候选顺序即站点声明顺序，再多只是浪费重试。
 */
export function extractIconHrefs(html: string, base: string, limit = 3): string[] {
  const seen = new Set<string>();
  for (const tag of html.matchAll(LINK_TAG_RE)) {
    if (seen.size >= limit) break;
    const attrs = tag[0];
    let rel: string | null = null;
    let href: string | null = null;
    for (const attr of attrs.matchAll(ATTR_RE)) {
      const name = attr[1]?.toLowerCase();
      const value = attr[2] ?? attr[3] ?? attr[4] ?? "";
      if (name === "rel" && rel === null) rel = value;
      if (name === "href" && href === null) href = value;
    }
    if (!rel || !href || !rel.toLowerCase().includes("icon")) continue;
    // 带裸空白的 href 是写坏的 HTML：按相对路径解析只会得到垃圾 URL
    if (/\s/.test(href)) continue;
    try {
      if (href.startsWith("data:image/")) {
        seen.add(href);
        continue;
      }
      // 只认 http(s)：相对路径按 base 解析，其余协议（javascript: 等）不是可抓的图标
      const resolved = new URL(href, base).href;
      if (!/^https?:/i.test(resolved)) continue;
      seen.add(resolved);
    } catch {
      // 非法 href：跳过该候选
    }
  }
  return [...seen];
}

/** MIME → 缓存文件扩展名（仅用于磁盘命名可读性，data URL 重建走 index 里的 mime）。 */
export function mimeToExt(mime: string): string {
  const normalized = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/svg+xml") return "svg";
  if (normalized === "image/x-icon" || normalized === "image/vnd.microsoft.icon") return "ico";
  return "bin";
}
