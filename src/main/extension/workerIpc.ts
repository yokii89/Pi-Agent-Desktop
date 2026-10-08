import { ipcMain } from "electron";
import type { ExtensionWorkerStatus, WorkerAcquireResult } from "../../shared/contribution";
import { WORKER_IPC } from "../../shared/contribution";
import type { IpcResult } from "../../shared/ipc";
import { envelopeAsync } from "../ipc/envelope";
import { acquireWorkerLease, getWorkerStatus, releaseWorkerLease } from "./extensionWorkerManager";

/** Extension Worker lease IPC（docs/design/16 Phase F）。 */
export function registerWorkerIpc(): void {
  ipcMain.handle(
    WORKER_IPC.acquire,
    (): Promise<IpcResult<WorkerAcquireResult>> => envelopeAsync(() => acquireWorkerLease()),
  );

  ipcMain.handle(
    WORKER_IPC.release,
    (): Promise<IpcResult<ExtensionWorkerStatus>> =>
      envelopeAsync(async () => releaseWorkerLease()),
  );

  ipcMain.handle(
    WORKER_IPC.status,
    (): Promise<IpcResult<ExtensionWorkerStatus>> => envelopeAsync(async () => getWorkerStatus()),
  );
}
