import { ipcMain } from "electron";
import type {
  IpcResult,
  ManagedProcess,
  ProcStopAllResult,
  ProcStopResult,
  SessionId,
} from "../../shared/ipc";
import { PROC_IPC } from "../../shared/ipc";
import { envelope, envelopeAsync } from "../ipc/envelope";
import { procService } from "./procService";

function requireSessionId(raw: unknown): SessionId {
  if (typeof raw === "string" && raw.length > 0) return raw;
  throw new Error("缺少 sessionId");
}

function requireId(raw: unknown): string {
  if (typeof raw === "string" && raw.length > 0) return raw;
  throw new Error("缺少 id");
}

/** 后台进程域 IPC（docs/design/37 §4.1）。 */
export function registerProcIpc(): void {
  // list 前先 lazy 复核（§5.2）：消失的 PID 标 exited，计数只含 alive
  ipcMain.handle(
    PROC_IPC.list,
    (_e, req: { sessionId?: unknown }): Promise<IpcResult<ManagedProcess[]>> =>
      envelopeAsync(() => procService.revalidate(requireSessionId(req?.sessionId))),
  );

  ipcMain.handle(
    PROC_IPC.stop,
    (_e, req: { id?: unknown }): Promise<IpcResult<ProcStopResult>> =>
      envelopeAsync(() => procService.stop(requireId(req?.id))),
  );

  ipcMain.handle(
    PROC_IPC.ignore,
    (_e, req: { id?: unknown }): IpcResult<ManagedProcess | null> =>
      envelope(() => procService.ignore(requireId(req?.id))),
  );

  ipcMain.handle(
    PROC_IPC.stopAll,
    (_e, req: { sessionId?: unknown }): Promise<IpcResult<ProcStopAllResult>> =>
      envelopeAsync(() => procService.stopAll(requireSessionId(req?.sessionId))),
  );

  /** 上次非正常退出的残留提示（§5.4 P0）；消费一次即清。 */
  ipcMain.handle(
    PROC_IPC.residualNotice,
    (): IpcResult<boolean> => envelope(() => procService.consumeResidualNotice()),
  );
}
