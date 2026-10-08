import { app, BrowserWindow, Menu, Tray } from "electron";
import { resolveAppIconImage } from "../appIcon";
import { getSettings } from "../settings/settings";

/**
 * 系统托盘（设置「在系统托盘显示」）。
 * 开启后关闭主窗口改为隐藏到托盘；托盘菜单提供「显示主窗口 / 退出」。
 *
 * 不 import createMainWindow：避免与 close-to-tray 形成模块环。
 * 单窗口应用，显示时直接取当前 BrowserWindow 即可。
 */

let tray: Tray | null = null;
/** 用户显式选择退出（托盘菜单）时置 true，允许 close 真正销毁窗口。 */
let quitting = false;

/** 是否正在走应用退出流程（close-to-tray 需据此放行 close）。 */
export function isQuittingApp(): boolean {
  return quitting;
}

export function markQuitting(): void {
  quitting = true;
}

function showMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray(): void {
  const icon = resolveAppIconImage();
  // 无图标时 Tray 构造可能失败；宁可不显示托盘也不让设置写入崩溃
  if (!icon) return;
  tray = new Tray(icon);
  tray.setToolTip("PiDesk");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示主窗口", click: () => showMainWindow() },
      { type: "separator" },
      {
        label: "退出 PiDesk",
        click: () => {
          markQuitting();
          app.quit();
        },
      },
    ]),
  );
  // Windows 左键单击：显示/聚焦主窗口
  tray.on("click", () => showMainWindow());
}

function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

/** 按设置同步托盘显隐；重复调用幂等。 */
export function applyTrayEnabled(enabled: boolean): void {
  if (enabled) {
    if (!tray) createTray();
  } else {
    destroyTray();
  }
}

/** 启动时按已持久化设置拉起/关闭托盘（createMainWindow 之后调用）。 */
export function initTrayFromSettings(): void {
  try {
    applyTrayEnabled(getSettings().showInTray);
  } catch {
    // 读设置失败不阻塞启动；用户可在设置页再开关一次
  }
}

/** 应用退出时释放托盘图标。 */
export function disposeTray(): void {
  destroyTray();
}
