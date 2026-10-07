import { ipcMain } from "electron";
import type { IpcResult } from "../../shared/ipc";
import type { RunNowOutcome, ScheduledTask, SchedulerSnapshot } from "../../shared/scheduler";
import { SCHEDULER_IPC } from "../../shared/scheduler";
import { envelope } from "../ipc/envelope";
import {
  createScheduledTask,
  getSchedulerSnapshot,
  removeScheduledTask,
  runScheduledTaskNow,
  setScheduledTaskEnabled,
  updateScheduledTask,
} from "./taskScheduler";

function requireId(raw: unknown): string {
  if (typeof raw === "string" && raw.length > 0) return raw;
  throw new Error("缺少任务 id");
}

/** 注册定时任务 IPC（请求-响应 + changed 推送，推送在 taskScheduler 内发出）。 */
export function registerSchedulerIpc(): void {
  ipcMain.handle(
    SCHEDULER_IPC.list,
    (): IpcResult<SchedulerSnapshot> => envelope(() => getSchedulerSnapshot()),
  );

  ipcMain.handle(
    SCHEDULER_IPC.create,
    (_event, req: unknown): IpcResult<ScheduledTask> => envelope(() => createScheduledTask(req)),
  );

  ipcMain.handle(
    SCHEDULER_IPC.update,
    (_event, req: { id?: unknown; patch?: unknown }): IpcResult<ScheduledTask> =>
      envelope(() => updateScheduledTask(requireId(req?.id), req?.patch)),
  );

  ipcMain.handle(
    SCHEDULER_IPC.remove,
    (_event, req: { id?: unknown }): IpcResult<null> =>
      envelope(() => removeScheduledTask(requireId(req?.id))),
  );

  ipcMain.handle(
    SCHEDULER_IPC.setEnabled,
    (_event, req: { id?: unknown; enabled?: unknown }): IpcResult<ScheduledTask> =>
      envelope(() => setScheduledTaskEnabled(requireId(req?.id), req?.enabled === true)),
  );

  ipcMain.handle(
    SCHEDULER_IPC.runNow,
    (_event, req: { id?: unknown }): IpcResult<RunNowOutcome> =>
      envelope(() => runScheduledTaskNow(requireId(req?.id))),
  );
}
