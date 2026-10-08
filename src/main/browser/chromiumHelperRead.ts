import {
  buildLocalStorageReadExpression,
  type ChromiumHelperCookie,
  LOCAL_STORAGE_ORIGIN_TIMEOUT_MS,
} from "./browserDataImportRules";
import type { CdpPipeMessage } from "./chromiumCdpPipe";
import { type ChromiumCdpSession, ChromiumHelperError } from "./chromiumHelperSession";

/**
 * helper（本机 Chrome / Edge）侧的读取原语（docs/design/42 §6.6）。
 *
 * 只读，不写：Cookie 与 LocalStorage 都经主进程落进 `persist:browser`，helper 进程用完即弃。
 * 返回的是**明文**——这也是这条路线的意义：`v20` App-Bound Cookie 只有浏览器本体解得开。
 *
 * 入参是已经建立好的 CDP 会话而不是「可执行文件 + 目录」：一次导入只用拉起一个 helper
 * 进程，Cookie 与 LocalStorage 复用同一条会话（拉起一次 Chrome 约 1 秒，不该按读取项重复付）。
 */

/** 从 helper 读回的全部 Cookie（明文 value）。 */
export async function readCookiesFromHelper(
  cdp: ChromiumCdpSession,
): Promise<ChromiumHelperCookie[]> {
  const result = await cdp.send<{ cookies?: unknown }>("Storage.getCookies");
  if (!Array.isArray(result.cookies)) {
    throw new ChromiumHelperError("protocol", "helper 未返回 Cookie 列表");
  }
  return result.cookies.filter(isHelperCookie);
}

function isHelperCookie(value: unknown): value is ChromiumHelperCookie {
  if (!value || typeof value !== "object") return false;
  const cookie = value as Record<string, unknown>;
  return typeof cookie.name === "string" && typeof cookie.domain === "string";
}

export interface HelperLocalStorageRecord {
  origin: string;
  entries: Array<[string, string]>;
}

/**
 * 从 helper 读回指定 origin 的 LocalStorage。
 *
 * 为什么必须逐个 origin 导航：CDP 的 `DOMStorage` 域要求 `storageId` 的 origin 与某个 frame
 * 一致（实测直接传任意 origin 会得到 `Frame not found for the given storage id`），
 * 所以只能「导航到该 origin，再读同源 localStorage」。因此本步骤依赖站点可达性，
 * 单个 origin 失败按失败计数，不打断整体导入。
 */
export async function readLocalStorageFromHelper(
  cdp: ChromiumCdpSession,
  origins: string[],
): Promise<{ records: HelperLocalStorageRecord[]; failedOrigins: number }> {
  if (origins.length === 0) return { records: [], failedOrigins: 0 };
  const sessionId = await cdp.attachPage();
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId).catch(() => {});

  const records: HelperLocalStorageRecord[] = [];
  let failedOrigins = 0;
  for (const origin of origins) {
    const entries = await readOrigin(cdp, sessionId, origin).catch(() => null);
    if (entries === null) {
      failedOrigins += 1;
      continue;
    }
    if (entries.length > 0) records.push({ origin, entries });
  }
  return { records, failedOrigins };
}

async function readOrigin(
  cdp: ChromiumCdpSession,
  sessionId: string,
  origin: string,
): Promise<Array<[string, string]> | null> {
  const loaded = waitForPageLoad(cdp, sessionId, LOCAL_STORAGE_ORIGIN_TIMEOUT_MS);
  const navigation = await cdp.send<{ errorText?: string }>(
    "Page.navigate",
    { url: `${origin}/` },
    sessionId,
  );
  if (navigation.errorText) {
    loaded.cancel();
    return null;
  }
  await loaded.promise;

  const evaluated = await cdp.send<{ result?: { value?: unknown } }>(
    "Runtime.evaluate",
    { expression: buildLocalStorageReadExpression(origin), returnByValue: true },
    sessionId,
  );
  const value = evaluated.result?.value;
  if (!Array.isArray(value)) return null;
  return value.filter(
    (entry): entry is [string, string] =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "string",
  );
}

/**
 * 等 `Page.loadEventFired`。
 *
 * 必须在 `Page.navigate` **之前**订阅：helper 是本地进程，事件可能在导航回执之前就送到，
 * 先发后订会漏掉这一次事件，把成功的导航误判成超时。`cancel()` 把 promise 收掉（resolve），
 * 避免导航回执已经报错时留下一个没人 await 的 rejection。
 */
function waitForPageLoad(
  cdp: ChromiumCdpSession,
  sessionId: string,
  timeoutMs: number,
): { promise: Promise<void>; cancel: () => void } {
  let unsubscribe: (() => void) | null = null;
  let timer: NodeJS.Timeout | null = null;
  let settled = false;
  let settle: (error?: Error) => void = () => {};

  const promise = new Promise<void>((resolve, reject) => {
    settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
      if (error) reject(error);
      else resolve();
    };
    unsubscribe = cdp.onEvent((message: CdpPipeMessage) => {
      if (message.method === "Page.loadEventFired" && message.sessionId === sessionId) settle();
    });
    timer = setTimeout(
      () => settle(new ChromiumHelperError("timeout", "等待页面加载超时")),
      timeoutMs,
    );
  });

  return { promise, cancel: () => settle() };
}
