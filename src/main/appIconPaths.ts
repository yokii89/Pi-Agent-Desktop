import path from "node:path";
import { type AppIconId, DEFAULT_APP_ICON_ID } from "../shared/appIcon";

/**
 * 应用图标路径解析（纯逻辑，注入平台与文件存在判定，便于单测）。
 *
 * 三条消费链路对路径的要求不同：
 * - 窗口 / 托盘：可以在 asar 内读取（Electron 会重定向到 app.asar.unpacked）；
 * - 任务栏：Windows 的 AppUserModel 只认真实磁盘文件，必须走 unpacked；
 * - 系统 toast：WinRT 对 PNG 更稳，同样需要真实路径。
 * 每档都先找当前变体，再回退默认变体，最后才是历史路径。
 */
export interface AppIconPathEnv {
  /** app.getAppPath()：开发态是仓库根，打包态是 resources/app.asar。 */
  appPath: string;
  /** process.resourcesPath。 */
  resourcesPath: string;
  platform: NodeJS.Platform;
  packaged: boolean;
  /** process.execPath：任务栏的最终兜底（EXE 已由 electron-builder 嵌入经典图标）。 */
  execPath: string;
  /** 文件是否为存在的普通文件（生产注入 fs.statSync().isFile()）。 */
  hasFile: (file: string) => boolean;
}

type IconExtension = "ico" | "png";

const ICON_SUBDIR = path.join("build", "app-icons");

function asarFile(env: AppIconPathEnv, id: AppIconId, ext: IconExtension): string | undefined {
  const file = path.join(env.appPath, ICON_SUBDIR, `${id}.${ext}`);
  return env.hasFile(file) ? file : undefined;
}

function unpackedFile(env: AppIconPathEnv, id: AppIconId, ext: IconExtension): string | undefined {
  const file = path.join(env.resourcesPath, "app.asar.unpacked", ICON_SUBDIR, `${id}.${ext}`);
  return env.hasFile(file) ? file : undefined;
}

/** 旧版单图标产物：变体资源整体缺失时的最后一级（build/icon.* 仍在打包清单里）。 */
function legacyFile(env: AppIconPathEnv, ext: IconExtension): string | undefined {
  const file = path.join(env.appPath, "build", `icon.${ext}`);
  return env.hasFile(file) ? file : undefined;
}

/** 窗口 / 托盘图标：优先当前变体 ICO，缺失时回退经典变体。 */
export function resolveAppIconPath(env: AppIconPathEnv, id: AppIconId): string | undefined {
  return (
    asarFile(env, id, "ico") ?? asarFile(env, DEFAULT_APP_ICON_ID, "ico") ?? legacyFile(env, "ico")
  );
}

/** Windows 任务栏：打包态需要 app.asar.unpacked 下的真实路径，最差回退 EXE 自身。 */
export function resolveTaskbarIconPath(env: AppIconPathEnv, id: AppIconId): string | undefined {
  if (env.platform !== "win32" || !env.packaged) return resolveAppIconPath(env, id);
  return (
    unpackedFile(env, id, "ico") ??
    unpackedFile(env, DEFAULT_APP_ICON_ID, "ico") ??
    resolveAppIconPath(env, id) ??
    env.execPath
  );
}

/** 系统 toast 图标：PNG 优先；打包态取 unpacked 真实路径。 */
export function resolveNotificationIconPath(
  env: AppIconPathEnv,
  id: AppIconId,
): string | undefined {
  if (env.platform === "win32" && env.packaged) {
    return (
      unpackedFile(env, id, "png") ??
      unpackedFile(env, DEFAULT_APP_ICON_ID, "png") ??
      asarFile(env, DEFAULT_APP_ICON_ID, "png") ??
      legacyFile(env, "png")
    );
  }
  return (
    asarFile(env, id, "png") ?? asarFile(env, DEFAULT_APP_ICON_ID, "png") ?? legacyFile(env, "png")
  );
}
