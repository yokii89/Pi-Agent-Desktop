import { ipcMain } from "electron";
import { NOTIFICATION_IPC, type SystemToastRequest } from "../../shared/notification";
import { envelope } from "../ipc/envelope";
import { showSystemToast } from "./toastService";

/** 注册系统桌面 toast IPC（docs/design/24）。 */
export function registerNotificationIpc(): void {
  ipcMain.handle(NOTIFICATION_IPC.showToast, (_event, req: SystemToastRequest) =>
    envelope(() => showSystemToast(req ?? { title: "" })),
  );
}
