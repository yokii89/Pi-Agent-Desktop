import path from "node:path";
import { app, dialog, ipcMain, type OpenDialogOptions } from "electron";
import { t } from "../../shared/i18n";
import type { IpcResult } from "../../shared/ipc";
import { WALLPAPER_IPC } from "../../shared/ipc";
import { WALLPAPER_IMAGE_EXTENSIONS, WALLPAPER_VIDEO_EXTENSIONS } from "../../shared/wallpaper";
import { envelopeAsync } from "../ipc/envelope";
import { getSettings } from "../settings/settings";
import { getMainWindow } from "../window/createMainWindow";

/**
 * 注册壁纸文件选择 IPC（docs/design/111 / 112）。
 * 返回用户实际选中的路径（取消为 null）：是否支持由渲染层校验并提示，
 * 否则「在对话框里手输一个 .pkg」会静默变成取消。
 */
export function registerWallpaperIpc(): void {
  ipcMain.handle(
    WALLPAPER_IPC.pick,
    (): Promise<IpcResult<string | null>> =>
      envelopeAsync(async () => {
        const current = getSettings().wallpaperPath;
        const options: OpenDialogOptions = {
          title: t("settings.personalization.wallpaper.dialogTitle"),
          properties: ["openFile"],
          // 从当前壁纸所在目录继续找，没有则落到系统图片目录
          defaultPath: current ? path.dirname(current) : app.getPath("pictures"),
          filters: [
            {
              name: t("settings.personalization.wallpaper.filterMedia"),
              extensions: [...WALLPAPER_IMAGE_EXTENSIONS, ...WALLPAPER_VIDEO_EXTENSIONS],
            },
            {
              name: t("settings.personalization.wallpaper.filterImage"),
              extensions: [...WALLPAPER_IMAGE_EXTENSIONS],
            },
            {
              name: t("settings.personalization.wallpaper.filterVideo"),
              extensions: [...WALLPAPER_VIDEO_EXTENSIONS],
            },
          ],
        };
        const parent = getMainWindow();
        const result = parent
          ? await dialog.showOpenDialog(parent, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
      }),
  );
}
