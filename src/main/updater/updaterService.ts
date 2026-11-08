import { copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { autoUpdater } from "electron-updater";
import {
  isVersionNewer,
  PIDESK_RELEASE_REPO,
  UPDATE_GITHUB_LATEST_URL,
  UPDATE_IPC,
  type UpdateStatus,
} from "../../shared/update";
import { getMainWindow } from "../window/createMainWindow";
import { updaterLogger } from "./updaterLogger";

/** 启动静默检查的延迟：避开启动高峰，失败不打扰用户。 */
const STARTUP_CHECK_DELAY_MS = 8_000;

/**
 * electron-updater 差量基准文件名（缓存根下的 installer.exe 与 current.blockmap）。
 * builder-util-runtime 是传递依赖（pnpm 布局下主进程解析不到），不能 import 其常量，
 * 按值对齐：CURRENT_APP_INSTALLER_FILE_NAME 与 AppUpdater.saveBlockMapToCacheDir 的硬编码。
 */
const DIFFERENTIAL_BASE_INSTALLER_NAME = "installer.exe";
const DIFFERENTIAL_BASE_BLOCKMAP_NAME = "current.blockmap";

let status: UpdateStatus = { state: "idle" };
let wired = false;
/** electron-updater 检查互斥（事件回调与 await 共用）。 */
let checking = false;
/** 下载互斥：防双击 / 进度回调与 await 重入。 */
let downloading = false;
/** 本次检查是否静默：error 事件也要吞掉，不能只处理 promise catch。 */
let silentCheck = false;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

function pushStatus(next: UpdateStatus): void {
  status = next;
  getMainWindow()?.webContents.send(UPDATE_IPC.status, next);
}

/**
 * 静默失败时的落点：已有更“靠后”的状态就不要被打回 idle
 * （用户可能已点出 available / 正在下载）。
 */
function settleSilentFailure(): void {
  const s = status.state;
  if (s === "available" || s === "downloading" || s === "downloaded" || s === "error") {
    return;
  }
  pushStatus({ state: "idle" });
}

/** 当前状态（invoke 返回与 UI 初始值共用）。 */
export function getUpdateStatus(): UpdateStatus {
  return status;
}

function clampPercent(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** 字节数兜底：事件缺字段 / 非法值时返回 undefined，不让 NaN 进状态机。 */
function clampBytes(raw: number | undefined): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  return Math.round(raw);
}

/**
 * 接线 electron-updater 事件（幂等）。
 * `autoDownload=false`：下载由用户点「下载并安装」触发，符合手动检查语义。
 * `autoInstallOnAppQuit=true`：已下载后用户直接退出也会装上，避免下完白下。
 */
export function initUpdater(): void {
  if (wired) return;
  wired = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // 默认 logger 是 console：打包环境 GUI 无控制台，差量回退全量等关键链路日志全部丢失
  //（0.5.5→0.5.6 排障只能靠缓存目录取证）。接上文件日志（userData/updater.log），
  // console 镜像保留给 dev 终端。
  autoUpdater.logger = updaterLogger;

  // 运行时强制覆盖发布源：0.2.x 旧包内的 app-update.yml 指向已停用的 yokii89/PiDesk，
  // 不覆盖则那些客户端的自动检查永远失败。与 electron-builder.yml publish 同源（PIDESK_RELEASE_REPO）。
  if (app.isPackaged) {
    autoUpdater.setFeedURL({ provider: "github", ...PIDESK_RELEASE_REPO });
  }

  autoUpdater.on("checking-for-update", () => {
    if (!checking) pushStatus({ state: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    checking = false;
    pushStatus({
      state: "available",
      version: info.version,
      releaseDate: typeof info.releaseDate === "string" ? info.releaseDate : null,
      releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : null,
      canInstall: true,
    });
  });
  autoUpdater.on("update-not-available", () => {
    checking = false;
    pushStatus({ state: "not-available" });
  });
  autoUpdater.on("download-progress", (progress) => {
    pushStatus({
      state: "downloading",
      percent: clampPercent(progress.percent),
      bytesTransferred: clampBytes(progress.transferred),
      totalBytes: clampBytes(progress.total),
    });
  });
  autoUpdater.on("update-downloaded", () => {
    downloading = false;
    pushStatus({ state: "downloaded" });
  });
  autoUpdater.on("error", (error) => {
    checking = false;
    downloading = false;
    const message = error instanceof Error ? error.message : String(error);
    if (silentCheck) {
      settleSilentFailure();
      return;
    }
    pushStatus({ state: "error", message });
  });
}

/** 开发 / 未打包：走 github.com 发布页 JSON 比版本，只能提示，不能安装。 */
async function checkViaGitHubReleasePage(): Promise<UpdateStatus> {
  pushStatus({ state: "checking" });
  const res = await fetch(UPDATE_GITHUB_LATEST_URL, {
    headers: {
      // github.com 仅在显式 Accept JSON 时于 302 后返回 JSON，否则是发布页 HTML
      Accept: "application/json",
      "User-Agent": "PiDesk-Updater",
    },
  });
  // 尚无任何 Release：当作“暂无更新”，避免启动静默检查/首次检查弹红字
  if (res.status === 404) {
    const next: UpdateStatus = { state: "not-available" };
    pushStatus(next);
    return next;
  }
  if (!res.ok) {
    throw new Error(`GitHub releases ${res.status}`);
  }
  const data = (await res.json()) as { tag_name?: string };
  const remote = (data.tag_name ?? "").replace(/^v/i, "");
  const current = app.getVersion();
  if (!remote || !isVersionNewer(remote, current)) {
    const next: UpdateStatus = { state: "not-available" };
    pushStatus(next);
    return next;
  }
  const next: UpdateStatus = {
    state: "available",
    version: remote,
    releaseDate: null,
    releaseNotes: null,
    canInstall: false,
  };
  pushStatus(next);
  return next;
}

async function checkViaElectronUpdater(): Promise<UpdateStatus> {
  if (checking) return status;
  checking = true;
  pushStatus({ state: "checking" });
  try {
    // 事件回调会写入 available / not-available / error
    await autoUpdater.checkForUpdates();
    // 极少数路径 promise resolve 了却没事件：不能卡死在 checking
    if (status.state === "checking") {
      pushStatus({ state: "not-available" });
    }
    return status;
  } finally {
    checking = false;
  }
}

async function runCheck(options?: { silent?: boolean }): Promise<UpdateStatus> {
  silentCheck = options?.silent === true;
  try {
    if (!app.isPackaged) {
      return await checkViaGitHubReleasePage();
    }
    return await checkViaElectronUpdater();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options?.silent) {
      settleSilentFailure();
      return status;
    }
    const next: UpdateStatus = { state: "error", message };
    pushStatus(next);
    return next;
  } finally {
    silentCheck = false;
  }
}

let checkInFlight: Promise<UpdateStatus> | null = null;

/**
 * 检查更新（手动按钮 / 启动静默共用）。
 * `silent`：失败时不向用户展示错误，也不把已有 available/下载中状态打回 idle。
 */
export function checkForUpdates(options?: { silent?: boolean }): Promise<UpdateStatus> {
  initUpdater();
  if (checkInFlight) return checkInFlight;
  checkInFlight = runCheck(options).finally(() => {
    checkInFlight = null;
  });
  return checkInFlight;
}

/**
 * 下载成功后补齐差量基准对（缓存根下的 installer.exe + current.blockmap）。
 * electron-updater 6.8.9 只把下载产物留在 pending/（带版本号文件名）、只把 blockmap 拷到缓存根，
 * 从不写基准 installer.exe——基准缺失时差量直接回退全量，基准陈旧时按旧 blockmap 复制错块、
 * sha512 校验失败后回退全量（0.5.5→0.5.6 实测：基准停在 0.5.3，白下 17.5MB 差量后回退 103MB 全量）。
 * 这里补上 exe 那一半，下次更新才能按真实差量下载。
 */
async function refreshDifferentialBase(downloadedInstaller: string | undefined): Promise<void> {
  if (!downloadedInstaller) {
    updaterLogger.warn("[updater] downloadUpdate 未返回产物路径，跳过差量基准刷新");
    return;
  }
  // executeDownload 把产物固定放在 <缓存根>/pending/<文件名>，向上两级即缓存根
  const pendingDir = path.dirname(downloadedInstaller);
  const cacheRoot = path.dirname(pendingDir);
  const hasNewBlockmap = await stat(path.join(pendingDir, DIFFERENTIAL_BASE_BLOCKMAP_NAME)).then(
    () => true,
    () => false,
  );
  if (!hasNewBlockmap) {
    // pending 里没有新版 blockmap = 差量阶段早期失败（连新版 blockmap 都没存下）走的全量兜底。
    // 此时只换 exe 会造出 (新 exe, 旧 blockmap) 错配对：下次差量按旧 blockmap 复制新 exe 的块，
    // sha512 必挂再回退——比陈旧但自洽的基准更糟，保持不动，等下次成功下载一起刷新。
    updaterLogger.warn("[updater] pending 中无新版 blockmap，保持旧差量基准不动");
    return;
  }
  const baseInstallerPath = path.join(cacheRoot, DIFFERENTIAL_BASE_INSTALLER_NAME);
  try {
    await copyFile(downloadedInstaller, baseInstallerPath);
    updaterLogger.info(`[updater] 差量基准已刷新: ${baseInstallerPath}`);
  } catch (err) {
    // 复制失败不影响本次安装（产物 sha512 已校验），代价只是下次更新继续回退全量；
    // 即使半途留下损坏的基准，下次差量自身的 sha512 末校验也会拦住并回退，不会装出坏包。
    updaterLogger.warn("[updater] 差量基准刷新失败:", err);
  }
}

/** 下载更新安装包；仅打包环境可用。 */
export async function downloadUpdate(): Promise<UpdateStatus> {
  initUpdater();
  if (!app.isPackaged) {
    const next: UpdateStatus = {
      state: "error",
      message: "Development build cannot install updates",
    };
    pushStatus(next);
    return next;
  }
  // 检查中 / 已下载 / 下载中：直接返回当前状态，避免 electron-updater 重入
  if (
    status.state === "checking" ||
    status.state === "downloading" ||
    status.state === "downloaded"
  ) {
    return status;
  }
  if (downloading) return status;
  downloading = true;
  pushStatus({ state: "downloading", percent: 0 });
  try {
    // downloadUpdate 返回下载产物路径（<缓存根>/pending/<安装包>），据此维护差量基准
    const [downloadedInstaller] = await autoUpdater.downloadUpdate();
    await refreshDifferentialBase(downloadedInstaller);
    return status;
  } catch (err) {
    downloading = false;
    const next: UpdateStatus = {
      state: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    pushStatus(next);
    return next;
  }
}

/** 退出并安装（需已下载完成）。 */
export function installUpdate(): void {
  if (status.state !== "downloaded") {
    throw new Error("Update has not been downloaded yet");
  }
  // isSilent=false：NSIS oneClick=false，保留安装向导；isForceRunAfter=true：装完拉起新版
  autoUpdater.quitAndInstall(false, true);
}

/** 启动后延迟静默检查一次（docs/design/35）。用户已交互则跳过，避免覆盖进行中状态。 */
export function scheduleStartupCheck(): void {
  initUpdater();
  if (startupTimer) clearTimeout(startupTimer);
  startupTimer = setTimeout(() => {
    startupTimer = null;
    if (status.state !== "idle") return;
    void checkForUpdates({ silent: true }).catch(() => {});
  }, STARTUP_CHECK_DELAY_MS);
}

/** 退出时清掉未触发的静默检查定时器。 */
export function disposeUpdater(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
}
