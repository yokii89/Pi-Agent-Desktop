import { ipcMain } from "electron";
import type { IpcResult } from "../../shared/ipc";
import type { ViewEvent } from "../../shared/view";
import { VIEW_IPC } from "../../shared/view";
import type { BashJobRequest } from "../../shared/bashWorkspace";
import { envelope, envelopeAsync } from "../ipc/envelope";
import { getMainWindow } from "../window/createMainWindow";
import { bashJobAccess } from "./viewBashServices";
import { reportViewLayout, sendViewEvent } from "./viewHost";

function requireJobRequest(raw: unknown): BashJobRequest {
  if (!raw || typeof raw !== "object") throw new Error("Missing job request");
  const request = raw as Partial<BashJobRequest>;
  if (
    typeof request.viewId !== "string" ||
    !request.viewId ||
    request.viewId.length > 256 ||
    typeof request.jobId !== "string" ||
    !request.jobId ||
    request.jobId.length > 128
  ) {
    throw new Error("Invalid job request");
  }
  return { viewId: request.viewId, jobId: request.jobId };
}

/** 注册扩展 View IPC（docs/design/08 §9）。 */
export function registerViewIpc(): void {
  for (const [channel, action] of [
    [VIEW_IPC.bashRuntime, "inspect"],
    [VIEW_IPC.bashOpenLog, "openLog"],
  ] as const) {
    ipcMain.handle(channel, (event, raw: unknown) =>
      envelopeAsync(async () => {
        const window = getMainWindow();
        if (
          !window ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        ) {
          throw new Error("Untrusted job request");
        }
        const request = requireJobRequest(raw);
        if (action === "inspect") return bashJobAccess.inspect(request.viewId, request.jobId);
        await bashJobAccess.openLog(request.viewId, request.jobId);
        return null;
      }),
    );
  }

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
