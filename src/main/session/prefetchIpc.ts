import { ipcMain } from "electron";
import type { PrefetchMetrics } from "../../shared/contribution";
import { PREFETCH_IPC } from "../../shared/contribution";
import type { IpcResult } from "../../shared/ipc";
import { envelope } from "../ipc/envelope";
import { getPrefetchMetrics } from "./speculativePrefetch";

/** speculative 预热 IPC（docs/design/16 Phase G）。 */
export function registerPrefetchIpc(): void {
  ipcMain.handle(
    PREFETCH_IPC.metrics,
    (): IpcResult<PrefetchMetrics> => envelope(() => getPrefetchMetrics()),
  );

  ipcMain.handle(PREFETCH_IPC.notifyActive, (): IpcResult<null> => envelope(() => null));
}
