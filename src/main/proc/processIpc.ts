import { statSync } from "node:fs";
import { open } from "node:fs/promises";
import { ipcMain } from "electron";
import type {
  IpcResult,
  ManagedProcess,
  ProcDetail,
  ProcOutputStartResult,
  ProcStopAllResult,
  ProcStopResult,
  SessionId,
} from "../../shared/ipc";
import { PROC_IPC } from "../../shared/ipc";
import { envelope, envelopeAsync } from "../ipc/envelope";
import { getMainWindow } from "../window/createMainWindow";
import { resolveJobInfo } from "./jobLogs";
import { ProcOutputTailer } from "./processOutputTail";
import { procService } from "./procService";

function requireSessionId(raw: unknown): SessionId {
  if (typeof raw === "string" && raw.length > 0) return raw;
  throw new Error("缺少 sessionId");
}

function requireId(raw: unknown): string {
  if (typeof raw === "string" && raw.length > 0) return raw;
  throw new Error("缺少 id");
}

/**
 * 作业日志 tail（方案 B）：页签可见期间由渲染层 outputStart / outputStop 驱动，
 * 增量经 pidesk:proc:output 推主窗。ended 判定挂在作业快照的 live 状态上。
 */
const outputTailer = new ProcOutputTailer({
  readSlice: async (path, start, end) => {
    const handle = await open(path, "r");
    try {
      const length = end - start;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  },
  sizeOf: (path) => {
    try {
      return statSync(path).size;
    } catch {
      return null;
    }
  },
  now: () => Date.now(),
  isJobLive: (id) => procService.isJobLogLive(id),
});

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

  /** 详情页签：子树 / 端口 / 内存（只读查询，不改登记状态）。 */
  ipcMain.handle(
    PROC_IPC.detail,
    (_e, req: { sessionId?: unknown; id?: unknown }): Promise<IpcResult<ProcDetail>> =>
      envelopeAsync(() => procService.detail(requireSessionId(req?.sessionId), requireId(req?.id))),
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

  /** 开始 tail 作业日志（方案 B）；无 pi-bash-jobs 作业日志时 logPath 为 null。 */
  ipcMain.handle(
    PROC_IPC.outputStart,
    (_e, req: { id?: unknown }): Promise<IpcResult<ProcOutputStartResult>> =>
      envelopeAsync(async () => {
        const proc = procService.get(requireId(req?.id));
        if (!proc) throw new Error("进程登记项不存在");
        const info = resolveJobInfo(proc);
        if (!info) return { logPath: null };
        outputTailer.start(proc, info.path, (message) => {
          getMainWindow()?.webContents.send(PROC_IPC.output, message);
        });
        return { logPath: info.path };
      }),
  );

  /** 停止 tail；重复 / 未启动的 id 幂等。 */
  ipcMain.handle(
    PROC_IPC.outputStop,
    (_e, req: { id?: unknown }): IpcResult<null> =>
      envelope(() => {
        outputTailer.stop(requireId(req?.id));
        return null;
      }),
  );
}
