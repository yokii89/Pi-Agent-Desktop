import fs from "node:fs";
import path from "node:path";
import { app, nativeImage, shell } from "electron";
import { type AppIconId, normalizeAppIconId } from "../shared/appIcon";
import {
  type AppIconPathEnv,
  resolveAppIconPath as resolveIconPath,
  resolveTaskbarIconPath as resolveTaskbarPath,
  resolveNotificationIconPath as resolveToastPath,
} from "./appIconPaths";
import { getSettings } from "./settings/settings";
import { collectAppIconShortcuts, updateAppIconShortcuts } from "./window/appIconShortcut";

/**
 * 进程内图标变体：启动时从设置读出，设置页切换后由 applyAppIcon 就地更新，
 * 因此窗口 / 任务栏 / 托盘 / 通知都不再需要重启。
 */
let activeIconId: AppIconId | null = null;

/** 当前生效的图标变体（首次调用时读设置，之后跟随设置页切换）。 */
export function getActiveAppIconId(): AppIconId {
  if (activeIconId === null) {
    activeIconId = normalizeAppIconId(getSettings().appIcon);
  }
  return activeIconId;
}

/** 只改进程内缓存，不碰窗口 / 托盘；界面副作用统一由 applyAppIcon 承担。 */
export function setActiveAppIconId(id: AppIconId): void {
  activeIconId = normalizeAppIconId(id);
}

function hasFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function pathEnv(): AppIconPathEnv {
  return {
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    platform: process.platform,
    packaged: app.isPackaged,
    execPath: process.execPath,
    hasFile,
  };
}

/** 应用级图标资源：每个内置 PNG 母版预先生成多尺寸 ICO。 */
export function resolveAppIconPath(): string | undefined {
  return resolveIconPath(pathEnv(), getActiveAppIconId());
}

/**
 * Windows 任务栏需要真实磁盘路径；打包资源从 app.asar.unpacked 读取，
 * 开发态则使用仓库 build 目录。若定制资源缺失，回退到程序 EXE 的嵌入图标。
 */
export function resolveTaskbarIconPath(): string | undefined {
  return resolveTaskbarPath(pathEnv(), getActiveAppIconId());
}

/** 系统 toast 图标：优先当前内置 PNG；Electron 会按需缩放。 */
export function resolveNotificationIconPath(): string | undefined {
  return resolveToastPath(pathEnv(), getActiveAppIconId());
}

/** 托盘图标：与窗口、任务栏使用同一内置变体。 */
export function resolveAppIconImage(): Electron.NativeImage | undefined {
  const file = resolveAppIconPath();
  if (!file) return undefined;
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? undefined : image;
}

/** 环境变量给的根目录可能是空串 / 相对路径，只有绝对路径才参与拼接。 */
function joinAbsolute(root: string | undefined, ...segments: string[]): string | null {
  if (!root || !path.isAbsolute(root)) return null;
  return path.join(root, ...segments);
}

/**
 * 安装版启动 / 切换图标后对齐已有快捷方式：桌面（用户 + 公共）、开始菜单（用户 + 所有用户）。
 * 只改指向本次安装且可写的 .lnk，保留启动参数等属性；开发进程不修改安装版入口。
 * 返回未能更新的快捷方式路径，调用方决定提示还是静默（启动时不打扰）。
 */
export function syncDesktopAppIcon(): string[] {
  if (process.platform !== "win32" || !app.isPackaged) return [];
  try {
    const iconPath = resolveTaskbarIconPath();
    if (!iconPath) return [];
    const shortcuts = collectAppIconShortcuts({
      desktop: app.getPath("desktop"),
      publicDesktop: joinAbsolute(process.env.PUBLIC, "Desktop"),
      startMenuPrograms: joinAbsolute(
        app.getPath("appData"),
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
      ),
      allUsersStartMenuPrograms: joinAbsolute(
        process.env.ProgramData,
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
      ),
    });
    const failed = updateAppIconShortcuts(shortcuts, process.execPath, iconPath, {
      exists: fs.existsSync,
      read: (file) => shell.readShortcutLink(file),
      update: (file, icon) =>
        shell.writeShortcutLink(file, "update", {
          target: process.execPath,
          icon,
          iconIndex: 0,
        }),
    });
    if (failed.length > 0) console.warn("[app-icon] 快捷方式图标未更新", failed);
    return failed;
  } catch (error) {
    console.warn("[app-icon] 快捷方式图标未更新", error);
    return [];
  }
}
