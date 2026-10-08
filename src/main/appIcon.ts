import fs from "node:fs";
import path from "node:path";
import { app, nativeImage } from "electron";

/**
 * 应用图标资产解析（`build/icon.ico` / `build/icon.png`）。
 *
 * 打包态两个文件由 electron-builder `files` 收录；开发态落在仓库 `build/`。
 * 窗口/任务栏/托盘优先多尺寸 ICO；系统 toast 图片层优先 PNG（WinRT toast 对 PNG 更稳）。
 * 两个候选都缺失时返回 undefined，调用方回退到 EXE 内置图标或不展示。
 */
function findBuildIcon(order: readonly ("icon.ico" | "icon.png")[]): string | undefined {
  const buildDir = path.join(app.getAppPath(), "build");
  for (const name of order) {
    const candidate = path.join(buildDir, name);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // 试下一个候选
    }
  }
  return undefined;
}

/** 窗口 / 任务栏图标路径：优先 ICO（原生多尺寸）。 */
export function resolveAppIconPath(): string | undefined {
  return findBuildIcon(["icon.ico", "icon.png"]);
}

/**
 * 系统 toast 图标路径：优先 PNG。
 * Electron 会把它写成 toast 的 `appLogoOverride`，不传则 Windows 只回 AUMID、无应用图。
 */
export function resolveNotificationIconPath(): string | undefined {
  return findBuildIcon(["icon.png", "icon.ico"]);
}

/** 托盘图标：与窗口同源，加载失败返回 undefined（调用方选择不建托盘）。 */
export function resolveAppIconImage(): Electron.NativeImage | undefined {
  const file = resolveAppIconPath();
  if (!file) return undefined;
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? undefined : image;
}
