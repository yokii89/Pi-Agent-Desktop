import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow, session } from "electron";
import { t } from "../../shared/i18n";
import type {
  BrowserImportLoginDataRequest,
  BrowserImportLoginDataResult,
  BrowserLoginSource,
} from "../../shared/ipc";
import {
  buildLocalStorageWriteExpression,
  helperCookieToImportCookie,
  type ImportCookie,
  type ImportCookieResult,
  importCookieToDetails,
  LOCAL_STORAGE_ORIGIN_TIMEOUT_MS,
  parseLocalStorageOrigins,
  selectLocalStorageOrigins,
} from "./browserDataImportRules";
import { BROWSER_PARTITION } from "./browserPolicyRules";
import { inspectChromiumCookieProtection } from "./chromiumCookieProtection";
import { readCookiesFromHelper, readLocalStorageFromHelper } from "./chromiumHelperRead";
import {
  ChromiumHelperError,
  resolveChromiumExecutable,
  runChromiumHelper,
  stageChromiumProfileForHelper,
} from "./chromiumHelperSession";
import { readChromiumAllLoginCookies } from "./chromiumLoginRead";
import { listBrowserLoginSources } from "./loginImport";

/**
 * 全量导入本机浏览器数据到面板分区（docs/design/42 §6.6）。
 *
 * 为什么不能只做「进程内解密 + 按 host 过滤」（docs/design/09 的旧路径）：
 * 1. Chrome 127+ 在 Windows 上改用 App-Bound Encryption（`v20`），第三方进程解不开，
 *    进程内只能拿到极少数旧格式 Cookie —— 半套会话比干净分区更糟（§6.1 实测现象）；
 * 2. 只搬目标站点的 Cookie 会把 SSO 链路里的第三方域 Cookie 丢掉（Google 登录态在
 *    `google.com` / `accounts.google.com` 上）。
 *
 * 所以走 ZCode 同款路线：把 Cookie 库 + `Local State` 暂存到一次性 profile，拉起**浏览器
 * 本体**（Chrome / Edge）读明文 Cookie；写回仍由主进程完成。helper 缺失或失败时回退到
 * 进程内解密，并把能力边界作为告警带回渲染层。
 */

/** Cookie 写入并发度：与 ZCode 一致，避免上千条串行写入把导入拖成分钟级。 */
const COOKIE_WRITE_CONCURRENCY = 32;

/** 把 CDP Cookie 归一成 ImportCookie，同时统计跳过原因。 */
function collectImportCookies(
  cookies: ImportCookieResult[],
  counters: { skipped: number },
): ImportCookie[] {
  const result: ImportCookie[] = [];
  for (const item of cookies) {
    if (item.kind === "skip") {
      counters.skipped += 1;
      continue;
    }
    result.push(item.cookie);
  }
  return result;
}

/**
 * 注入点（仅测试用）：跳过本机 Profile 扫描与可执行文件猜测。
 */
export interface BrowserDataImportOverrides {
  sources?: BrowserLoginSource[];
  executablePath?: string | null;
}

/**
 * 把本机浏览器的登录态导入 `persist:browser`。
 *
 * 失败语义：Cookie 阶段失败直接抛错（用户需要知道「什么也没导入」）；LocalStorage 阶段
 * 逐 origin 失败只计数并回传告警（站点不可达是常态，不该让整次导入失败）。
 */
export async function importBrowserLoginData(
  req: BrowserImportLoginDataRequest,
  overrides: BrowserDataImportOverrides = {},
): Promise<BrowserImportLoginDataResult> {
  const sources = overrides.sources ?? (await listBrowserLoginSources());
  const source = sources.find((item) => item.id === req.sourceId);
  if (!source) throw new Error(t("browser.loginImport.errNoSources"));

  const warnings: string[] = [];
  const counters = { skipped: 0 };
  const includeLocalStorage = req.includeLocalStorage === true;
  const preferredOrigin = originFromUrl(req.currentUrl);

  const executablePath =
    overrides.executablePath !== undefined
      ? overrides.executablePath
      : await resolveChromiumExecutable(source.browserId);
  let importCookies: ImportCookie[] = [];
  let localStorageRecords: Array<{ origin: string; entries: Array<[string, string]> }> = [];
  let helperError: ChromiumHelperError | null = null;

  if (executablePath) {
    // profileLocked 直接抛出：这是用户可操作的状态（关掉浏览器），不该被回退路径掩盖
    const staged = await stageChromiumProfileForHelper(source, { includeLocalStorage });
    try {
      const origins = includeLocalStorage
        ? await scanStagedLocalStorageOrigins(staged.profileDir, preferredOrigin)
        : [];
      const read = await runChromiumHelper(
        { executablePath, userDataDir: staged.userDataDir },
        async (cdp) => {
          // Cookie 读不到 → 整体回退；LocalStorage 读不到 → 保留 Cookie 并告警
          const cookies = await readCookiesFromHelper(cdp);
          let storage: Awaited<ReturnType<typeof readLocalStorageFromHelper>> = {
            records: [],
            failedOrigins: 0,
          };
          try {
            storage = await readLocalStorageFromHelper(cdp, origins);
          } catch {
            if (origins.length > 0)
              warnings.push(
                t("browser.loginImport.warnLocalStoragePartial", { count: origins.length }),
              );
          }
          return { cookies, storage };
        },
      );
      importCookies = collectImportCookies(
        read.cookies.map((cookie) => helperCookieToImportCookie(cookie)),
        counters,
      );
      localStorageRecords = read.storage.records;
      if (read.storage.failedOrigins > 0) {
        warnings.push(
          t("browser.loginImport.warnLocalStoragePartial", { count: read.storage.failedOrigins }),
        );
      }
    } catch (error) {
      if (error instanceof ChromiumHelperError && error.code === "profileLocked") throw error;
      helperError = error instanceof ChromiumHelperError ? error : null;
      warnings.push(t("browser.loginImport.warnHelperFallback"));
    } finally {
      await staged.dispose();
    }
  }

  if (!executablePath || helperError) {
    if (!executablePath) warnings.push(t("browser.loginImport.warnNoBrowser"));
    // 回退：进程内解密只对 v10 有效，能拿到什么算什么（不静默失败）
    let fallback: Awaited<ReturnType<typeof readChromiumAllLoginCookies>>;
    try {
      fallback = await readChromiumAllLoginCookies(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 「读不了 Cookie 库」几乎都是浏览器还在跑（新版 Chrome 持独占锁）：给可操作文案
      if (/独占锁定|EBUSY|EPERM|无法读取/.test(message)) {
        throw new Error(t("browser.loginImport.errLocked"), { cause: error });
      }
      throw error;
    }
    importCookies = collectImportCookies(
      fallback.cookies.map((cookie) =>
        helperCookieToImportCookie({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.hostKey,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: mapElectronSameSiteBack(cookie.sameSite),
          ...(cookie.expirationDate ? { expires: cookie.expirationDate } : { session: true }),
        }),
      ),
      counters,
    );
    if (fallback.failed > 0) {
      warnings.push(t("browser.loginImport.warnAppBound", { count: fallback.failed }));
    }
  }

  // 保护等级体检（docs/design/42 §6.7）：App-Bound（v20）Cookie 用户态解不开，连浏览器本体
  // 在一次性 profile 里也读不出来（实测 Chrome 155 会把整库清空）。不体检就会出现
  // 「静默成功导入 0 条」，用户以为登录态已经进来了——这正是实际踩到的坑。
  const protection = await inspectChromiumCookieProtection(source);
  if (protection.appBound !== null && protection.appBound > 0) {
    if (importCookies.length === 0) {
      throw new Error(
        t("browser.loginImport.errAppBound", {
          appBound: protection.appBound,
          total: protection.total ?? protection.appBound,
        }),
      );
    }
    warnings.push(t("browser.loginImport.warnAppBoundSkipped", { count: protection.appBound }));
  }

  const cookieWrite = await writeCookiesIntoBrowserPartition(importCookies);
  const storageWrite = await writeLocalStorageIntoBrowserPartition(localStorageRecords);
  if (storageWrite.failed > 0) {
    warnings.push(t("browser.loginImport.warnLocalStorageWrite", { count: storageWrite.failed }));
  }

  return {
    cookies: cookieWrite.imported,
    skippedCookies: counters.skipped,
    failedCookies: cookieWrite.failed,
    localStorageOrigins: storageWrite.origins,
    localStorageEntries: storageWrite.entries,
    warnings,
  };
}

/** Electron sameSite 词表 → CDP 词表（回退路径要把进程内解出的 Cookie 归一成同一形状）。 */
function mapElectronSameSiteBack(
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict",
): string | undefined {
  if (sameSite === "strict") return "Strict";
  if (sameSite === "lax") return "Lax";
  if (sameSite === "no_restriction") return "None";
  return undefined;
}

function originFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

/**
 * 扫暂存副本里的 LocalStorage origin 列表。
 *
 * 扫副本而不是源目录：源目录可能被运行中的浏览器锁着，而且副本才是 helper 实际读到的数据。
 */
async function scanStagedLocalStorageOrigins(
  stagedProfileDir: string,
  preferredOrigin: string | undefined,
): Promise<string[]> {
  const levelDb = join(stagedProfileDir, "Local Storage", "leveldb");
  let files: string[];
  try {
    files = (await readdir(levelDb, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const origins = new Set<string>();
  for (const file of files) {
    try {
      const text = (await readFile(join(levelDb, file))).toString("latin1");
      for (const origin of parseLocalStorageOrigins(text)) origins.add(origin);
    } catch {
      // 单个 LevelDB 文件读不了不影响其余文件
    }
  }
  return selectLocalStorageOrigins(origins, preferredOrigin);
}

/** 把 Cookie 写进 persist:browser；返回写入 / 失败计数。 */
async function writeCookiesIntoBrowserPartition(
  cookies: ImportCookie[],
): Promise<{ imported: number; failed: number }> {
  if (cookies.length === 0) return { imported: 0, failed: 0 };
  const target = session.fromPartition(BROWSER_PARTITION);
  const importedAtSec = Math.floor(Date.now() / 1000);
  let imported = 0;
  let failed = 0;
  for (let offset = 0; offset < cookies.length; offset += COOKIE_WRITE_CONCURRENCY) {
    const batch = cookies.slice(offset, offset + COOKIE_WRITE_CONCURRENCY);
    const statuses = await Promise.allSettled(
      batch.map((cookie) => target.cookies.set(importCookieToDetails(cookie, importedAtSec))),
    );
    for (const status of statuses) {
      if (status.status === "fulfilled") imported += 1;
      else failed += 1;
    }
  }
  await target.cookies.flushStore();
  return { imported, failed };
}

/**
 * 把 LocalStorage 写进 persist:browser。
 *
 * 用一个隐藏 `BrowserWindow`（同分区）逐个 origin 导航后写：LocalStorage 是 origin 私有的，
 * 拿不到「直接写某 origin」的 API，只能借一个同分区的页面。会话级分区与面板一致，因此写进去
 * 的数据面板页刷新后就能读到。
 */
async function writeLocalStorageIntoBrowserPartition(
  records: Array<{ origin: string; entries: Array<[string, string]> }>,
): Promise<{ origins: number; entries: number; failed: number }> {
  if (records.length === 0) return { origins: 0, entries: 0, failed: 0 };

  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    width: 480,
    height: 360,
    webPreferences: {
      partition: BROWSER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  let origins = 0;
  let entries = 0;
  let failed = 0;
  try {
    for (const record of records) {
      try {
        await loadUrlWithTimeout(win, `${record.origin}/`, LOCAL_STORAGE_ORIGIN_TIMEOUT_MS);
        const written = await win.webContents.executeJavaScript(
          buildLocalStorageWriteExpression(record.entries),
          true,
        );
        if (typeof written === "number" && written > 0) {
          origins += 1;
          entries += written;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
  return { origins, entries, failed };
}

function loadUrlWithTimeout(win: BrowserWindow, url: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.stop();
      reject(new Error(`load timeout: ${url}`));
    }, timeoutMs);
    win.webContents
      .loadURL(url)
      .then(() => {
        clearTimeout(timer);
        resolve();
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}
