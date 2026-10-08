import { type ChildProcess, spawn } from "node:child_process";
import { access, copyFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep as pathSeparator, relative } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { BrowserLoginSource } from "../../shared/ipc";
import { CdpPipeDecoder, type CdpPipeMessage, encodeCdpMessage } from "./chromiumCdpPipe";

/**
 * 用本机 Chrome / Edge 自身当「解密 oracle」的一次性 helper（docs/design/42 §6.6）。
 *
 * 为什么需要它：Windows 上 Chrome 127+ 用 **App-Bound Encryption（`v20`）** 加密 Cookie，
 * 第三方进程在用户态解不开（本机实测 Local State 里有 `app_bound_encrypted_key`），
 * pidesk 原有的 `chromiumCrypto` 只能解 `v10`，于是「导入登录态」在现代 Chrome 上实际只
 * 能拿到极少数旧格式 Cookie——半套会话比干净分区更糟（§6.1 的实测现象）。
 *
 * 可行路径与 ZCode `chromeCookieHelper` 相同：把 Cookie 库 + `Local State` 复制到一次性
 * profile，再把**浏览器本体**拉起来读。Chrome 自己能解开自己的 App-Bound Cookie，不需要
 * 提权、不需要额外原生组件。
 *
 * 与 ZCode 的两点差异（都是本机实测后的选择，见 §6.6）：
 * 1. 走 `--remote-debugging-pipe`（fd3/fd4 + NUL 分隔 JSON），不引入 `ws` 依赖、不占端口；
 * 2. helper 只做「读」，写回 Electron 分区仍由主进程做（不把两件事混在一个进程里）。
 */

/** helper 的失败分类，供上层映射成可操作文案。 */
export type ChromiumHelperErrorCode =
  | "executableMissing"
  | "profileLocked"
  | "launchFailed"
  | "timeout"
  | "protocol";

export class ChromiumHelperError extends Error {
  constructor(
    readonly code: ChromiumHelperErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChromiumHelperError";
  }
}

/** 单个 CDP 命令的超时；helper 只在本地回环上跑，超时意味着实例已经不正常。 */
const CDP_COMMAND_TIMEOUT_MS = 20_000;
/** 从启动到第一条命令回执的上限；把「连不上」与「命令慢」区分开。 */
const HELPER_STARTUP_TIMEOUT_MS = 30_000;
const HELPER_TERMINATE_GRACE_MS = 3_000;

export interface ChromiumCdpSession {
  send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T>;
  /** 订阅事件（`Page.loadEventFired` 等）；返回退订函数。 */
  onEvent(listener: (message: CdpPipeMessage) => void): () => void;
  /** 挂到第一个 page target 上，返回其 sessionId（页面域命令需要）。 */
  attachPage(): Promise<string>;
}

export interface StagedChromiumProfile {
  userDataDir: string;
  /** 暂存出来的 Profile 目录（恒为 `Default`）：LocalStorage origin 扫描在这里做。 */
  profileDir: string;
  dispose(): Promise<void>;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isLockError(error: unknown): boolean {
  const code = error instanceof Error && "code" in error ? String(error.code) : "";
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

/**
 * 一次性 profile 的暂存目录。
 *
 * 必须带上源 profile 的 `Local State`：App-Bound 密钥在里面，缺了它 Chrome 自己也解不开
 * 复制过来的 `v20` Cookie（这一步是整条 oracle 路径成立的前提，不是可选项）。
 *
 * `includeLocalStorage` 时额外把 LocalStorage 的 LevelDB 一起复制：源侧读值时是「导航到该
 * origin 再读同源 localStorage」，读到的其实是**这份副本**里的数据，不复制就只能拿到站点
 * 自己空着一份存储。单独扫 origin 列表也以副本为准（源目录可能被运行中的浏览器锁着）。
 */
export async function stageChromiumProfileForHelper(
  source: BrowserLoginSource,
  options: { includeLocalStorage?: boolean } = {},
): Promise<StagedChromiumProfile> {
  const root = await mkdtemp(join(tmpdir(), "pidesk-browser-import-"));
  const userDataDir = join(root, "User Data");
  const profileDir = join(userDataDir, "Default");
  const cookieRelative = relative(source.userDataDir, source.cookieDbPath);
  if (
    !cookieRelative ||
    cookieRelative.startsWith("..") ||
    cookieRelative.includes(`..${pathSeparator}`)
  ) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw new ChromiumHelperError("profileLocked", "Cookie 库不在所选 Profile 内");
  }

  try {
    const targets: Array<[string, string]> = [
      [source.cookieDbPath, join(userDataDir, cookieRelative)],
      [`${source.cookieDbPath}-wal`, join(userDataDir, `${cookieRelative}-wal`)],
      [`${source.cookieDbPath}-shm`, join(userDataDir, `${cookieRelative}-shm`)],
      [join(source.userDataDir, "Local State"), join(userDataDir, "Local State")],
      [join(source.userDataDir, source.profileDir, "Preferences"), join(profileDir, "Preferences")],
    ];
    if (options.includeLocalStorage) {
      await cp(
        join(source.userDataDir, source.profileDir, "Local Storage"),
        join(profileDir, "Local Storage"),
        { recursive: true, force: true },
      ).catch((error: unknown) => {
        if (isLockError(error)) {
          throw new ChromiumHelperError(
            "profileLocked",
            "浏览器正在运行并独占了站点存储，请完全退出后重试",
          );
        }
        // LocalStorage 缺失不是致命错：Cookie 路径仍应完成
      });
    }
    for (const [from, to] of targets) {
      if (!(await pathExists(from))) continue;
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to).catch(async (error: unknown) => {
        if (isLockError(error)) {
          throw new ChromiumHelperError(
            "profileLocked",
            "浏览器正在运行并独占了 Cookie 库，请完全退出后重试",
          );
        }
        throw error;
      });
    }
    // 空的 Local State 会让 Chrome 走到「首次运行」分支，明确写一份最小可用结构
    if (!(await pathExists(join(userDataDir, "Local State")))) {
      await writeFile(join(userDataDir, "Local State"), JSON.stringify({ os_crypt: {} }));
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  return {
    userDataDir,
    profileDir,
    async dispose(): Promise<void> {
      // Chrome 的 crashpad / 子进程在主进程退出后还会短暂写临时目录，删不掉不算错
      await rm(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }).catch(
        () => {},
      );
    },
  };
}

/** Windows 上按浏览器 id 猜可执行文件位置；非 Windows 只覆盖常见安装路径。 */
function executableCandidates(browserId: string): string[] {
  const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  if (browserId === "edge") {
    return [
      join(programFilesX86, "Microsoft/Edge/Application/msedge.exe"),
      join(programFiles, "Microsoft/Edge/Application/msedge.exe"),
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/usr/bin/microsoft-edge",
      "/opt/microsoft/msedge/msedge",
    ];
  }
  return [
    join(programFiles, "Google/Chrome/Application/chrome.exe"),
    join(programFilesX86, "Google/Chrome/Application/chrome.exe"),
    join(localAppData, "Google/Chrome/Application/chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/opt/google/chrome/chrome",
  ];
}

/**
 * 解析 Chrome / Edge 可执行文件。
 *
 * 先看常见安装路径，再兜底查 Windows 的 `App Paths` 注册表项（Chrome 装在非默认目录、
 * 或用户装了 Beta/Dev 渠道时，只有注册表知道真实路径）。查不到返回 null：调用方据此退回
 * 「进程内解密」这条只对 `v10` 有效的旧路径，并把限制告诉用户。
 */
export async function resolveChromiumExecutable(browserId: string): Promise<string | null> {
  for (const candidate of executableCandidates(browserId)) {
    if (await pathExists(candidate)) return candidate;
  }
  if (process.platform !== "win32") return null;
  const { execFile } = await import("node:child_process");
  const fileName = browserId === "edge" ? "msedge.exe" : "chrome.exe";
  const keys = [
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${fileName}`,
    `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${fileName}`,
  ];
  for (const key of keys) {
    const stdout = await new Promise<string>((resolve) => {
      execFile(
        "reg.exe",
        ["query", key, "/ve"],
        { windowsHide: true, timeout: 8_000 },
        (error, out) => resolve(error ? "" : out),
      );
    });
    const match = /REG_SZ\s+(.+\.exe)\s*$/im.exec(stdout.trim().split(/\r?\n/).pop() ?? "");
    const found = match?.[1]?.trim();
    if (found && (await pathExists(found))) return found;
  }
  return null;
}

function killHelperTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  if (process.platform !== "win32" || child.pid === undefined) return;
  // Chrome 会拉起一串子进程；主进程被 kill 后子进程通常自己退，超时仍在则整棵树强杀
  setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    }).unref();
  }, HELPER_TERMINATE_GRACE_MS).unref();
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve();
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolve();
    };
    child.once("exit", onExit);
  });
}

/** 拉起 helper 并交出 CDP 会话；`run` 结束后无论成败都会关进程。 */
export async function runChromiumHelper<T>(
  options: { executablePath: string; userDataDir: string },
  run: (cdp: ChromiumCdpSession) => Promise<T>,
): Promise<T> {
  let child: ChildProcess;
  try {
    child = spawn(
      options.executablePath,
      [
        "--headless=new",
        `--user-data-dir=${options.userDataDir}`,
        "--remote-debugging-pipe",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-component-update",
        "--disable-sync",
        "--disable-crash-reporter",
        "--no-service-autorun",
        "about:blank",
      ],
      {
        // fd3 = 写入 CDP，fd4 = 读取 CDP（Chromium 固定约定）；stdout/stderr 丢弃，
        // 避免 helper 的输出混进 CDP 帧或主进程日志。
        stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  } catch (error) {
    throw new ChromiumHelperError(
      "launchFailed",
      `无法启动浏览器 helper：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // stdio[3]/[4] 的静态类型是 `Readable | Writable`，按 Chromium 的管道约定断言方向
  const writeStream = child.stdio[3] as Writable | null;
  const readStream = child.stdio[4] as Readable | null;
  if (!writeStream || !readStream) {
    killHelperTree(child);
    throw new ChromiumHelperError("launchFailed", "浏览器 helper 的 CDP 管道不可用");
  }

  const decoder = new CdpPipeDecoder();
  const pending = new Map<
    number,
    {
      resolve: (message: CdpPipeMessage) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  const eventListeners = new Set<(message: CdpPipeMessage) => void>();
  let seq = 0;
  let exited = false;

  const settleAll = (error: Error): void => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  readStream.setEncoding("utf8");
  readStream.on("data", (chunk: string) => {
    for (const message of decoder.push(chunk)) {
      if (message.id !== undefined) {
        const entry = pending.get(message.id);
        if (entry) {
          pending.delete(message.id);
          clearTimeout(entry.timer);
          entry.resolve(message);
          continue;
        }
      }
      for (const listener of eventListeners) listener(message);
    }
  });
  child.once("exit", (code) => {
    exited = true;
    settleAll(new ChromiumHelperError("launchFailed", `浏览器 helper 已退出（code=${code}）`));
  });

  const session: ChromiumCdpSession = {
    send<T = unknown>(
      method: string,
      params: Record<string, unknown> = {},
      sessionId?: string,
    ): Promise<T> {
      if (exited) {
        return Promise.reject(new ChromiumHelperError("launchFailed", "浏览器 helper 已退出"));
      }
      const id = ++seq;
      const budget = seq === 1 ? HELPER_STARTUP_TIMEOUT_MS : CDP_COMMAND_TIMEOUT_MS;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
          () => {
            pending.delete(id);
            reject(new ChromiumHelperError("timeout", `CDP ${method} 超时`));
          },
          Math.max(budget, 1),
        );
        pending.set(id, {
          resolve: (message) => {
            if (message.error) {
              reject(
                new ChromiumHelperError("protocol", `CDP ${method} 失败：${message.error.message}`),
              );
              return;
            }
            resolve(message.result as T);
          },
          reject,
          timer,
        });
        writeStream.write(
          encodeCdpMessage({ id, method, params, ...(sessionId ? { sessionId } : {}) }),
        );
      });
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    async attachPage(): Promise<string> {
      const targets = await session.send<{
        targetInfos?: Array<{ targetId: string; type: string }>;
      }>("Target.getTargets");
      const page = targets.targetInfos?.find((target) => target.type === "page");
      if (!page) throw new ChromiumHelperError("protocol", "helper 里没有可用的页面 target");
      const attached = await session.send<{ sessionId?: string }>("Target.attachToTarget", {
        targetId: page.targetId,
        flatten: true,
      });
      if (!attached.sessionId) {
        throw new ChromiumHelperError("protocol", "无法挂到 helper 的页面 target");
      }
      return attached.sessionId;
    },
  };

  try {
    return await run(session);
  } finally {
    // 先请 Chrome 自己退出（profile 关闭时会 flush Cookie / LocalStorage），
    // 再兜底强杀：直接 kill 会让测试稿里的“写后读”轮次拿不到刚落盘的数据。
    await session.send("Browser.close").catch(() => {});
    await waitForExit(child, HELPER_TERMINATE_GRACE_MS);
    killHelperTree(child);
  }
}
