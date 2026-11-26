import { ipcMain } from "electron";
import type { IpcResult } from "../../shared/ipc";
import type { ViewEvent } from "../../shared/view";
import { VIEW_IPC } from "../../shared/view";
import { envelope } from "../ipc/envelope";
import { getMainWindow } from "../window/createMainWindow";
import { replayViewState, reportViewLayout, sendViewEvent } from "./viewHost";

/** 注册扩展 View IPC（docs/design/08 §9）。 */
export function registerViewIpc(): void {
  ipcMain.handle(
    VIEW_IPC.replay,
    (event): IpcResult<null> =>
      envelope(() => {
        const window = getMainWindow();
        if (
          !window ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error("Untrusted View requester.");
        replayViewState();
        return null;
      }),
  );
  ipcMain.handle(
    VIEW_IPC.sendEvent,
    (_event, req: { id: string; event: ViewEvent }): IpcResult<null> =>
      envelope(() => {
        if (typeof req?.id !== "string" || !req.id) throw new Error("缺少视图 id");
        const event = req.event;
        if (!event || typeof event !== "object" || typeof event.type !== "string") {
          throw new Error("无效的 ViewEvent");
        }
        sendViewEvent(req.id, event);
        return null;
      }),
  );

  ipcMain.handle(
    VIEW_IPC.layout,
    (_event, req: { id: string; width: number; height?: number }): IpcResult<null> =>
      envelope(() => {
        if (typeof req?.id !== "string" || !req.id) throw new Error("缺少视图 id");
        if (typeof req.width !== "number" || !Number.isFinite(req.width) || req.width <= 0) {
          throw new Error("无效的面板宽度");
        }
        if (
          req.height !== undefined &&
          (typeof req.height !== "number" || !Number.isFinite(req.height) || req.height <= 0)
        ) {
          throw new Error("无效的面板高度");
        }
        reportViewLayout(req.id, req.width, req.height);
        return null;
      }),
  );
}
