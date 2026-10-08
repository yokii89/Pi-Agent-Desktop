import { ipcMain } from "electron";
import type { SessionRuntimeSnapshot } from "../../shared/contribution";
import { RUNTIME_IPC } from "../../shared/contribution";
import type { IpcResult } from "../../shared/ipc";
import { envelope } from "../ipc/envelope";
import { listRuntimeSnapshots } from "./runtimeCoordinator";

/** Session Runtime 快照 IPC（docs/design/16 Phase C）。 */
export function registerRuntimeIpc(): void {
  ipcMain.handle(
    RUNTIME_IPC.snapshot,
    (): IpcResult<SessionRuntimeSnapshot[]> => envelope(() => listRuntimeSnapshots()),
  );
}
