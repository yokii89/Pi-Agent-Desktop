import { ipcMain } from "electron";
import type { IpcResult } from "../../shared/ipc";
import { USAGE_IPC, type UsageReport } from "../../shared/usage";
import { envelopeAsync } from "../ipc/envelope";
import { queryUsageReport } from "./usageScanner";

/** 注册用量统计 IPC（请求-响应）；入参归一在 usageScanner（非法值按宽松语义降级）。 */
export function registerUsageIpc(): void {
  ipcMain.handle(
    USAGE_IPC.query,
    (_event, req: unknown): Promise<IpcResult<UsageReport>> =>
      envelopeAsync(() => queryUsageReport(req)),
  );
}
