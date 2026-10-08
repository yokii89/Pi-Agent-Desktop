import os from "node:os";
import path from "node:path";
import { dialog, ipcMain } from "electron";
import type { IpcResult } from "../../shared/ipc";
import { PROJECT_IPC } from "../../shared/ipc";
import { envelopeAsync } from "../ipc/envelope";
import { getMainWindow } from "../window/createMainWindow";

/** 未配置默认项目目录时，文件夹选择器落到用户目录下的 PiDeskProjects。 */
export function fallbackProjectDir(): string {
  return path.join(os.homedir(), "PiDeskProjects");
}

/** 注册项目相关 IPC：系统文件夹选择器（docs/design/03 §2 / §8）。 */
export function registerProjectIpc(): void {
  ipcMain.handle(
    PROJECT_IPC.pick,
    (_event, req?: { defaultPath?: string | null }): Promise<IpcResult<string | null>> =>
      envelopeAsync(async () => {
        const configured = typeof req?.defaultPath === "string" ? req.defaultPath.trim() : "";
        const defaultPath = configured || fallbackProjectDir();
        const parent = getMainWindow();
        const result = parent
          ? await dialog.showOpenDialog(parent, {
              title: "选择项目文件夹",
              properties: ["openDirectory"],
              defaultPath,
            })
          : await dialog.showOpenDialog({
              title: "选择项目文件夹",
              properties: ["openDirectory"],
              defaultPath,
            });
        return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
      }),
  );
}
