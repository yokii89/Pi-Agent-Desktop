import type {
  ManagedProcess,
  ProcDetail,
  ProcDetailRequest,
  ProcOutputPushMessage,
  ProcOutputStartResult,
  ProcPushMessage,
  ProcStopAllResult,
  ProcStopResult,
  SessionId,
} from "../../shared/ipc";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

function requireProc(): NonNullable<ReturnType<typeof pideskApi>>["proc"] {
  const api = pideskApi()?.proc;
  if (!api) throw new Error("preload 未就绪");
  return api;
}

/**
 * 后台进程 IPC 封装（docs/design/37）。
 * 渲染只 invoke + 收 push；枚举与 kill 全在主进程。
 */
export const procService = {
  list(sessionId: SessionId): Promise<ManagedProcess[]> {
    return unwrap(requireProc().list(sessionId));
  },
  stop(id: string): Promise<ProcStopResult> {
    return unwrap(requireProc().stop(id));
  },
  ignore(id: string): Promise<ManagedProcess | null> {
    return unwrap(requireProc().ignore(id));
  },
  /** 进程详情（子树 / 端口 / 内存）；详情页签可见时轮询。 */
  detail(req: ProcDetailRequest): Promise<ProcDetail> {
    return unwrap(requireProc().detail(req));
  },
  stopAll(sessionId: SessionId): Promise<ProcStopAllResult> {
    return unwrap(requireProc().stopAll(sessionId));
  },
  onChanged(callback: (message: ProcPushMessage) => void): () => void {
    return requireProc().onChanged(callback);
  },
  residualNotice(): Promise<boolean> {
    return unwrap(requireProc().residualNotice());
  },
  /** 开始 tail 作业日志（方案 B）；无 pi-bash-jobs 作业日志时 logPath 为 null。 */
  outputStart(id: string): Promise<ProcOutputStartResult> {
    return unwrap(requireProc().outputStart(id));
  },
  /** 停止 tail；未启动的 id 幂等。 */
  outputStop(id: string): Promise<null> {
    return unwrap(requireProc().outputStop(id));
  },
  onOutput(callback: (message: ProcOutputPushMessage) => void): () => void {
    return requireProc().onOutput(callback);
  },
};
