import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import { t } from "../shared/i18n";
import { browserWindowOpenResponse, isBrowserContents } from "./browser/browserPolicy";
import { registerBrowserLifecycle } from "./browser/browserView";
import { disposeExtensionWorker } from "./extension/extensionWorkerManager";
import { registerWatcherLifecycle } from "./fs/watcher";
import { registerIpc } from "./ipc";
import { procService } from "./proc/procService";
import { disposeTaskScheduler, initTaskScheduler } from "./scheduler/taskScheduler";
import { detectPiExecutablePath } from "./session/piLauncher";
import { disposeAllSessions } from "./session/piSession";
import { warmPiShellCache } from "./session/piShell";
import { getSettings, updateSettings } from "./settings/settings";
import { registerTerminalLifecycle } from "./terminal/terminal";
import { disposeUpdater, scheduleStartupCheck } from "./updater/updaterService";
import { disposeViewHost, ensureViewHost } from "./view/viewHost";
import { createMainWindow, getMainWindow } from "./window/createMainWindow";
import { disposeInspectorWindow } from "./window/inspectorWindow";
import { disposeTray, initTrayFromSettings } from "./window/tray";

registerTerminalLifecycle();
registerBrowserLifecycle();
registerWatcherLifecycle();

/**
 * 后台进程残留锁（docs/design/37 §5.4 P0）：
 * 启动时若锁仍在 = 上次非正常退出，登记表已丢、可能残留服务；
 * 干净 will-quit 删除锁。不扫系统全局，只提示用户自查。
 */
function residualLockPath(): string {
  return path.join(app.getPath("userData"), "proc-clean-exit.lock");
}

function bootstrapResidualNotice(): void {
  const lock = residualLockPath();
  try {
    if (fs.existsSync(lock)) {
      procService.markResidualNotice();
    }
    fs.writeFileSync(lock, String(Date.now()), "utf8");
  } catch {
    // 锁读写失败不阻塞启动
  }
}

function clearResidualLock(): void {
  try {
    fs.rmSync(residualLockPath(), { force: true });
  } catch {
    // 忽略
  }
}

/**
 * 启动时一次性环境探测：
 * 1. 若用户未手动配置 pi 路径，PATH 上能找到则自动写入 settings；
 * 2. 预热 bash 候选缓存，设置页 shellGet 直接读缓存，不再每次进页全量探测。
 */
function bootstrapEnvironmentProbe(): void {
  try {
    if (!getSettings().piExecutablePath) {
      const detected = detectPiExecutablePath();
      if (detected) updateSettings({ piExecutablePath: detected });
    }
  } catch {
    // 探测失败不阻塞启动；设置页仍可手动浏览
  }
  // 预热放在探测之后：shellPath 可能刚被外部改过，且不依赖 pi 路径
  try {
    warmPiShellCache();
  } catch {
    // 缓存未热时 shellGet 会回退同步探测
  }
}

app.whenReady().then(() => {
  registerIpc();
  createMainWindow();
  bootstrapEnvironmentProbe();
  bootstrapResidualNotice();
  // 预热扩展 View 旁路：首次 spawn 前 endpoint 就绪；失败不阻塞启动
  ensureViewHost().catch(() => {});
  // 托盘依赖主窗口存在（点击托盘要能 show），放在 createMainWindow 之后
  initTrayFromSettings();
  // 定时任务：IPC 已注册、窗口已建后启动；错过补扫需要 powerMonitor（ready 之后才可用）
  initTaskScheduler();
  // 应用更新静默检查：窗口已建后延迟触发，失败不打扰（docs/design/35）
  scheduleStartupCheck();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/** 退出前后台进程处置：null=尚未确认（无存活项时直接放行）。 */
let quitProcPolicy: "kill" | "keep" | null = null;

/**
 * 应用退出前若有存活后台进程则统一确认（docs/design/37 §6）。
 * 默认「一并结束」；「保留」只放弃登记不 kill。
 */
app.on("before-quit", (event) => {
  if (quitProcPolicy !== null) return;
  const alive = procService.listAllAlive();
  if (alive.length === 0) return;
  event.preventDefault();
  const names = alive
    .slice(0, 5)
    .map((p) => `· ${p.commandLine || p.name}`)
    .join("\n");
  const more = alive.length > 5 ? `\n${t("proc.quit.more", { count: alive.length })}` : "";
  const parent = getMainWindow();
  const options = {
    type: "warning" as const,
    buttons: [t("proc.quit.kill"), t("proc.quit.keep"), t("proc.quit.cancel")],
    defaultId: 0,
    cancelId: 2,
    title: t("proc.quit.title"),
    message: t("proc.quit.message", { count: alive.length }),
    detail: `${names}${more}`,
  };
  const result = parent
    ? dialog.showMessageBoxSync(parent, options)
    : dialog.showMessageBoxSync(options);
  if (result === 2) return;
  quitProcPolicy = result === 0 ? "kill" : "keep";
  app.quit();
});

app.on("will-quit", () => {
  disposeTray();
  disposeTaskScheduler();
  disposeUpdater();
  // 检查器浮窗：退出前强制销毁，避免残留独立窗
  disposeInspectorWindow();
  // 多实例并行：遍历全部 pi 会话进程 dispose（各实例 3s kill 兜底）
  disposeAllSessions();
  // 后台进程：按用户选择一并结束或保留（保留只放弃登记）
  if (quitProcPolicy === "kill" || quitProcPolicy === null) {
    procService.prepareQuit("kill");
  } else {
    procService.prepareQuit("keep");
  }
  disposeExtensionWorker();
  disposeViewHost();
  // 干净退出（含「保留后台」）：删掉残留锁，下次启动不提示
  clearResidualLock();
});

app.on("web-contents-created", (_event, contents) => {
  // 判定放在事件触发时而非此处：`window.open` 的子窗在创建后才知道自己的会话归属，
  // 面板弹窗要跟面板走同一条策略（src/main/browser/browserPolicy.ts）
  contents.setWindowOpenHandler(({ url }) => {
    // 内嵌浏览器面板：站内弹窗留在应用内（OAuth 登录弹窗就是这条路径）
    if (isBrowserContents(contents)) return browserWindowOpenResponse(contents, url);
    // 其余（主窗口、扩展 View 等）：外部链接一律交给系统浏览器，禁止在应用内开新窗口
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  // 兜底拦截同窗口导航（docs/design/13 P0-1）：会话流里漏覆写的 <a> 一点就会把
  // 整个应用导航到外网。白名单只放行应用自身的页面（file:// 生产产物 / dev server / DevTools）。
  contents.on("will-navigate", (event, url) => {
    // 面板自身是浏览器：站内导航（含 OAuth 跳转与登录后回调）照常放行，
    // 拦掉就等于把登录流程甩给系统浏览器
    if (isBrowserContents(contents)) return;
    const devServer = process.env.PIDESK_DEV_SERVER_URL;
    const allowed =
      url.startsWith("file://") ||
      url === "about:blank" ||
      url.startsWith("devtools:") ||
      url.startsWith("chrome-devtools:") ||
      (devServer !== undefined && url.startsWith(devServer));
    if (allowed) return;
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url);
    }
  });
});
