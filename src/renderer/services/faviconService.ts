import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/**
 * 站点 favicon（主进程抓取，返回 data URL）。
 * 渲染层按 origin 做内存缓存：同屏多条同站链接只发一次 IPC；
 * 成功结果长期缓存，失败移除坑位让后续消息可重试（重试节奏由主进程磁盘 TTL 兜底）。
 */
const cache = new Map<string, Promise<string | null>>();
/** 已结算的成功结果，供 `peekFavicon` 同步读：重渲染（切会话、翻历史）首帧即有图标。 */
const settled = new Map<string, string>();

function originOf(pageUrl: string): string | null {
  try {
    const parsed = new URL(pageUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** 已知站点同步取值；未抓取过或抓不到返回 null（调用方用兜底图标，不是「确定没有」）。 */
export function peekFavicon(pageUrl: string | null | undefined): string | null {
  if (!pageUrl) return null;
  const origin = originOf(pageUrl);
  return origin ? (settled.get(origin) ?? null) : null;
}

export function requestFavicon(pageUrl: string): Promise<string | null> {
  const origin = originOf(pageUrl);
  if (!origin) return Promise.resolve(null);
  const cached = cache.get(origin);
  if (cached) return cached;
  const api = pideskApi();
  // 开发态常见：渲染层已 HMR 到新代码、主进程还是旧的（没有这条 IPC）。
  // 缺 API 一律降级为兜底图标，不能让同步异常掀掉整条气泡。
  if (typeof api?.favicon?.get !== "function") return Promise.resolve(null);
  const task = unwrap(api.favicon.get(pageUrl))
    .then((data) => data.dataUrl)
    .catch(() => null)
    .then((dataUrl) => {
      if (dataUrl) {
        settled.set(origin, dataUrl);
        cache.set(origin, Promise.resolve(dataUrl));
      } else {
        cache.delete(origin);
      }
      return dataUrl;
    });
  cache.set(origin, task);
  return task;
}
