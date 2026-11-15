import { app, BrowserWindow, ipcMain, systemPreferences } from "electron";
import { normalizeSystemAccentColor } from "../../shared/accentColor";
import { type IpcResult, THEME_IPC } from "../../shared/ipc";
import { envelope } from "../ipc/envelope";

function readSystemAccentColor(): string | null {
  if (process.platform !== "win32" && process.platform !== "darwin") return null;
  try {
    return normalizeSystemAccentColor(systemPreferences.getAccentColor());
  } catch {
    // 系统颜色不可用时仍允许启动，并保留跟随偏好。
    return null;
  }
}

/** 注册系统强调色读取与变化推送；监听随应用结束释放，不依赖设置页是否打开。 */
export function registerSystemAccentColorIpc(): void {
  ipcMain.handle(
    THEME_IPC.getSystemAccentColor,
    (): IpcResult<string | null> => envelope(readSystemAccentColor),
  );
  // Electron 的强调色变化事件仅在 Windows 提供。
  if (process.platform !== "win32") return;
  let previous = readSystemAccentColor();
  const onChanged = (_event: Electron.Event, color: string): void => {
    const next = normalizeSystemAccentColor(color);
    if (next === previous) return;
    previous = next;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(THEME_IPC.systemAccentColorChanged, next);
      }
    }
  };
  systemPreferences.on("accent-color-changed", onChanged);
  app.once("will-quit", () => systemPreferences.removeListener("accent-color-changed", onChanged));
}
