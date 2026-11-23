import fs from "node:fs";
import path from "node:path";
import { app, nativeImage, shell } from "electron";
import { type AppIconId, DEFAULT_APP_ICON_ID, normalizeAppIconId } from "../shared/appIcon";
import { getSettings } from "./settings/settings";
import { updateAppIconShortcuts } from "./window/appIconShortcut";

let activeIconId: AppIconId | null = null;

/** 进程内图标在启动时固定；设置页选择的新图标在下次启动读取。 */
function getActiveIconId(): AppIconId {
  if (activeIconId === null) {
    activeIconId = normalizeAppIconId(getSettings().appIcon);
  }
  return activeIconId;
}

function findFile(file: string): string | undefined {
  const candidate = path.join(app.getAppPath(), "build", "app-icons", file);
  try {
    return fs.statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function findUnpackedFile(file: string): string | undefined {
  const candidate = path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    "build",
    "app-icons",
    file,
  );
  try {
    return fs.statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/** 应用级图标资源：每个内置 PNG 母版预先生成多尺寸 ICO。 */
export function resolveAppIconPath(): string | undefined {
  return (
    findFile(`${getActiveIconId()}.ico`) ??
    findFile(`${DEFAULT_APP_ICON_ID}.ico`) ??
    path.join(app.getAppPath(), "build", "icon.ico")
  );
}

/**
 * Windows 任务栏需要真实磁盘路径；打包资源从 app.asar.unpacked 读取，
 * 开发态则使用仓库 build 目录。若定制资源缺失，回退到程序 EXE 的嵌入图标。
 */
export function resolveTaskbarIconPath(): string | undefined {
  if (process.platform !== "win32") return resolveAppIconPath();
  if (process.platform === "win32" && app.isPackaged) {
    return (
      findUnpackedFile(`${getActiveIconId()}.ico`) ??
      findUnpackedFile(`${DEFAULT_APP_ICON_ID}.ico`) ??
      process.execPath
    );
  }
  return resolveAppIconPath();
}

/** 系统 toast 图标：优先当前内置 PNG；Electron 会按需缩放。 */
export function resolveNotificationIconPath(): string | undefined {
  if (process.platform === "win32" && app.isPackaged) {
    return (
      findUnpackedFile(`${getActiveIconId()}.png`) ??
      findUnpackedFile(`${DEFAULT_APP_ICON_ID}.png`) ??
      findFile(`${DEFAULT_APP_ICON_ID}.png`)
    );
  }
  return (
    findFile(`${getActiveIconId()}.png`) ??
    findFile(`${DEFAULT_APP_ICON_ID}.png`) ??
    path.join(app.getAppPath(), "build", "icon.png")
  );
}

/** 托盘图标：与窗口、任务栏使用同一内置变体。 */
export function resolveAppIconImage(): Electron.NativeImage | undefined {
  const file = resolveAppIconPath();
  if (!file) return undefined;
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? undefined : image;
}

/** 安装版启动时对齐已有桌面快捷方式；开发进程不修改安装版入口。 */
export function syncDesktopAppIcon(): void {
  if (process.platform !== "win32" || !app.isPackaged) return;
  try {
    const iconPath = resolveTaskbarIconPath();
    if (!iconPath) return;
    const shortcuts = [path.join(app.getPath("desktop"), "PiDesk.lnk")];
    const publicDirectory = process.env.PUBLIC;
    if (publicDirectory && path.isAbsolute(publicDirectory)) {
      shortcuts.push(path.join(publicDirectory, "Desktop", "PiDesk.lnk"));
    }
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
    if (failed.length > 0) console.warn("[app-icon] 桌面快捷方式图标未更新", failed);
  } catch (error) {
    console.warn("[app-icon] 桌面快捷方式图标未更新", error);
  }
}
