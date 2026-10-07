import path from "node:path";
import { app, BrowserWindow } from "electron";
import { resolveAppIconPath } from "../appIcon";
import { getSettings } from "../settings/settings";
import { isQuittingApp } from "./tray";

// dist 产物根目录（package.json main 位于 dist/main/index.js），
// 用应用根定位而不是 __dirname，避免随源码目录层级变化
function distPath(...segments: string[]): string {
  return path.join(app.getAppPath(), "dist", ...segments);
}

/**
 * 与 electron-builder.yml 的 `appId` 保持一致，否则 dev 与打包态会成为任务栏上两个不同应用。
 * 必须在 `app.whenReady()` 之前调用，Windows 用它在任务栏/开始菜单里标识本应用。
 */
const APP_USER_MODEL_ID = "dev.pidesk.app";

function applyAppUserModelId(): void {
  // 仅 Windows 需要；其他平台调用无害但无意义，显式判断意图更清晰
  if (process.platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID);
}

// 模块加载即执行：本模块由 index.ts 顶层 import，早于 app.whenReady()，
// 满足 setAppUserModelId 「必须在 ready 之前调用」的要求。
applyAppUserModelId();

// 开发态由 scripts/dev.mjs 注入 Vite dev server 地址；生产/打包态该变量为空。
// 用环境变量而不是 app.isPackaged 判断，是为了让 `pnpm start`（本地跑构建产物）仍走 loadFile。
const devServerUrl = process.env.PIDESK_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;

/**
 * 创建应用主窗口（frameless，自绘标题栏）。
 * 重复调用时聚焦已有窗口而不是创建新实例。
 */
export function createMainWindow(): BrowserWindow {
  const existing = getMainWindow();
  if (existing) {
    existing.focus();
    return existing;
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    frame: false,
    show: false,
    backgroundColor: "#111113",
    title: "PiDesk",
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: distPath("preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox 的 preload 只能 require electron 内置模块，无法加载 ../shared 的相对模块
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.on("maximize", () => notifyWindowState(win));
  win.on("unmaximize", () => notifyWindowState(win));
  // 托盘开启时关闭 = 隐藏到托盘；托盘菜单「退出」或未开托盘时才真正销毁
  win.on("close", (event) => {
    if (!isQuittingApp() && getSettings().showInTray) {
      event.preventDefault();
      win.hide();
    }
  });

  if (devServerUrl) {
    // 开发态：加载 dev server，渲染层享受原生 HMR（改组件/样式不重启窗口）
    void win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(distPath("renderer", "index.html"));
  }
  mainWindow = win;
  return win;
}

/** 获取当前主窗口实例（可能为 null，如应用退出中）。 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** 推送窗口最大化状态给渲染层（自绘最大化/还原图标需要）。 */
export function notifyWindowState(win: BrowserWindow): void {
  if (!win.isDestroyed()) {
    win.webContents.send("pidesk:window:stateChanged", win.isMaximized());
  }
}
