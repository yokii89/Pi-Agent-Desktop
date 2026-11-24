import type { AppIconId } from "../../shared/appIcon";
import {
  resolveAppIconPath,
  resolveTaskbarIconPath,
  setActiveAppIconId,
  syncDesktopAppIcon,
} from "../appIcon";
import { APP_USER_MODEL_ID, getMainWindow } from "./createMainWindow";
import { refreshTrayIcon } from "./tray";

export interface AppIconApplyOutcome {
  /** 桌面 / 开始菜单快捷方式未能更新（通常是缺写权限）；路径细节只留在主进程日志。 */
  shortcutUpdateFailed: boolean;
}

/**
 * 切换应用图标并就地应用（窗口、任务栏、托盘、之后的系统 toast、已有快捷方式）。
 * 缓存先行：解析函数都读 activeIconId，先换缓存才能取到新变体的路径。
 * EXE 文件图标与安装器图标由构建期嵌定，不在此列。
 */
export function applyAppIcon(id: AppIconId): AppIconApplyOutcome {
  setActiveAppIconId(id);

  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    const iconPath = resolveAppIconPath();
    if (iconPath) win.setIcon(iconPath);
    if (process.platform === "win32") {
      // 任务栏按钮图标由 AppUserModel 登记，单靠 BrowserWindow.icon 改不动
      const taskbarIconPath = resolveTaskbarIconPath();
      if (taskbarIconPath) {
        win.setAppDetails({ appId: APP_USER_MODEL_ID, appIconPath: taskbarIconPath });
      }
    }
  }

  refreshTrayIcon();
  const failed = syncDesktopAppIcon();
  return { shortcutUpdateFailed: failed.length > 0 };
}
