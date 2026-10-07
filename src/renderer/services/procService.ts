import type {
  ManagedProcess,
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
  stopAll(sessionId: SessionId): Promise<ProcStopAllResult> {
    return unwrap(requireProc().stopAll(sessionId));
  },
  onChanged(callback: (message: ProcPushMessage) => void): () => void {
    return requireProc().onChanged(callback);
  },
  residualNotice(): Promise<boolean> {
    return unwrap(requireProc().residualNotice());
  },
};
