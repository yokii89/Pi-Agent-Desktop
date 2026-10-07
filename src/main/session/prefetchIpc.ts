import { ipcMain } from "electron";
import type { PrefetchMetrics, PrefetchNotifyRequest } from "../../shared/contribution";
import { PREFETCH_IPC } from "../../shared/contribution";
import type { IpcResult } from "../../shared/ipc";
import { envelope } from "../ipc/envelope";
import { getPrefetchMetrics, notifyActiveSessionForPrefetch } from "./speculativePrefetch";

/** speculative 预热 IPC（docs/design/16 Phase G）。 */
export function registerPrefetchIpc(): void {
  ipcMain.handle(
    PREFETCH_IPC.metrics,
    (): IpcResult<PrefetchMetrics> => envelope(() => getPrefetchMetrics()),
  );

  ipcMain.handle(
    PREFETCH_IPC.notifyActive,
    (_event, req: PrefetchNotifyRequest): IpcResult<null> =>
      envelope(() => {
        notifyActiveSessionForPrefetch({
          sessionId: typeof req?.sessionId === "string" ? req.sessionId : undefined,
          sessionFile: typeof req?.sessionFile === "string" ? req.sessionFile : null,
          cwd: typeof req?.cwd === "string" ? req.cwd : null,
        });
        return null;
      }),
  );
}
