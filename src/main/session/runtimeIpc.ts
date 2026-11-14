import { ipcMain } from "electron";
import type { SessionRuntimeSnapshot } from "../../shared/contribution";
import { RUNTIME_IPC, type RuntimeViewingRequest } from "../../shared/contribution";
import type { IpcResult } from "../../shared/ipc";
import { envelope } from "../ipc/envelope";
import { getMainWindow } from "../window/createMainWindow";
import { noteViewingSession } from "./idleReclaim";
import { listRuntimeSnapshots } from "./runtimeCoordinator";

/** Session Runtime 快照 IPC（docs/design/16 Phase C）。 */
export function registerRuntimeIpc(): void {
  ipcMain.handle(
    RUNTIME_IPC.snapshot,
    (): IpcResult<SessionRuntimeSnapshot[]> => envelope(() => listRuntimeSnapshots()),
  );

  // 渲染层 active 会话上报（docs/design/138）：空闲回收据此豁免「用户正在看」的会话
  ipcMain.handle(RUNTIME_IPC.noteViewing, (event, req?: RuntimeViewingRequest) =>
    envelope(() => {
      if (event.sender !== getMainWindow()?.webContents) return null;
      noteViewingSession(req);
      return null;
    }),
  );
}
