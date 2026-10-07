import { ipcMain } from "electron";
import type { IpcResult } from "../../shared/ipc";
import type { ViewEvent } from "../../shared/view";
import { VIEW_IPC } from "../../shared/view";
import { envelope } from "../ipc/envelope";
import { sendViewEvent } from "./viewHost";

/** 注册扩展 View IPC（docs/design/08 §9）。 */
export function registerViewIpc(): void {
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
}
