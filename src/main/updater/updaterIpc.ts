import { app, ipcMain } from "electron";
import { UPDATE_IPC } from "../../shared/update";
import { envelope, envelopeAsync } from "../ipc/envelope";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  initUpdater,
  installUpdate,
} from "./updaterService";

/** 注册应用更新 IPC（docs/design/35）。 */
export function registerUpdaterIpc(): void {
  initUpdater();

  ipcMain.handle(UPDATE_IPC.getVersion, () => envelope(() => app.getVersion()));

  ipcMain.handle(UPDATE_IPC.check, () => envelopeAsync(async () => checkForUpdates()));

  ipcMain.handle(UPDATE_IPC.download, () => envelopeAsync(async () => downloadUpdate()));

  ipcMain.handle(UPDATE_IPC.install, () =>
    envelope(() => {
      installUpdate();
      return null;
    }),
  );

  ipcMain.handle(UPDATE_IPC.getStatus, () => envelope(() => getUpdateStatus()));
}
