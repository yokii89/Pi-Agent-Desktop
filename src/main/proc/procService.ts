import type {
  ManagedProcess,
  ProcPushMessage,
  ProcStopAllResult,
  ProcStopResult,
  SessionId,
} from "../../shared/ipc";
import { PROC_IPC } from "../../shared/ipc";
import { getMainWindow } from "../window/createMainWindow";
import {
  enumerateProcesses,
  killManagedProcess,
  killManagedProcessesSync,
  queryProcess,
} from "./processKill";
import { ProcessRegistry } from "./processRegistry";
import {
  type EnumerateProcesses,
  type ProcessSnapshotRow,
  ProcessWatcher,
  WATCH_TIMING,
} from "./processWatch";

/**
 * 后台进程域编排：登记表 + bash 边界监听 + 合批 push。
 * 不改 SessionPushMessage；推送走独立通道 `pidesk:proc:changed`。
 */
class ProcService {
  readonly registry = new ProcessRegistry({
    onChange: (sessionId) => this.schedulePush(sessionId),
  });

  private watcher: ProcessWatcher;
  private enumerate: EnumerateProcesses;
  private pushTimers = new Map<SessionId, ReturnType<typeof setTimeout>>();
  /** 退出时「保留」则放弃登记不 kill。 */
  private quitKeep = false;
  /** 上次非正常退出的残留提示（§5.4 P0）；消费一次后清空。 */
  private residualNotice = false;

  constructor(enumerate: EnumerateProcesses = enumerateProcesses) {
    this.enumerate = enumerate;
    this.watcher = new ProcessWatcher({
      enumerate,
      register: (input) => {
        this.registry.register(input);
      },
      markExited: (pid, sessionId) => {
        for (const proc of this.registry.listBySession(sessionId)) {
          if (proc.pid === pid && proc.status === "alive") {
            this.registry.setStatus(proc.id, "exited");
          }
        }
      },
    });
  }

  /** piSession 转发 bash tool_execution_start。 */
  noteBashStart(sessionId: SessionId, rootPid: number, toolCallId: string): void {
    void this.watcher.noteBashStart(sessionId, rootPid, toolCallId);
  }

  /** piSession 转发 bash tool_execution_end。 */
  noteBashEnd(sessionId: SessionId, toolCallId?: string): void {
    this.watcher.noteBashEnd(sessionId, toolCallId);
  }

  list(sessionId: SessionId): ManagedProcess[] {
    return this.registry.listBySession(sessionId);
  }

  listAlive(sessionId: SessionId): ManagedProcess[] {
    return this.registry.listAliveBySession(sessionId);
  }

  listAllAlive(): ManagedProcess[] {
    return this.registry.listAllAlive();
  }

  countAlive(sessionId: SessionId): number {
    return this.registry.countAlive(sessionId);
  }

  /**
   * 存活复核（§5.2）：agent 自杀 / 进程消失后标 exited。
   * 复核窗只覆盖登记后 15s，长期存活项靠 list / 浮窗打开时 lazy 校验。
   */
  async revalidate(sessionId: SessionId): Promise<ManagedProcess[]> {
    const alive = this.registry.listAliveBySession(sessionId);
    if (alive.length > 0) {
      const snapshot = await this.enumerate();
      if (snapshot) {
        for (const proc of alive) {
          const row = snapshot.get(proc.pid);
          if (!row) {
            this.registry.setStatus(proc.id, "exited");
            continue;
          }
          // PID 复用：创建时间漂移过大视为已消失
          if (proc.startedAt && row.startedAt && Math.abs(proc.startedAt - row.startedAt) > 2000) {
            this.registry.setStatus(proc.id, "exited");
          }
        }
      }
    }
    return this.registry.listBySession(sessionId);
  }

  async stop(id: string): Promise<ProcStopResult> {
    const proc = this.registry.get(id);
    if (!proc) return { stillAlive: false, message: "进程已不存在" };
    if (proc.status === "ignored") return { stillAlive: false, message: "已忽略" };
    const result = await killManagedProcess(proc);
    if (!result.stillAlive) {
      // 「进程已变化，未终止」= PID 复用拒杀；「进程已退出」= 已消失；其余 = 真 kill
      const status =
        result.message === "进程已变化，未终止" || result.message === "进程已退出"
          ? "exited"
          : "killed";
      this.registry.setStatus(id, status);
    }
    return result;
  }

  ignore(id: string): ManagedProcess | null {
    return this.registry.setStatus(id, "ignored");
  }

  async stopAll(sessionId: SessionId): Promise<ProcStopAllResult> {
    const alive = this.registry.listAliveBySession(sessionId);
    let stopped = 0;
    for (const proc of alive) {
      const result = await this.stop(proc.id);
      if (!result.stillAlive) stopped += 1;
    }
    return { stopped };
  }

  /** pi dispose：只取消未决 bash 边界，**不**清登记（有意留下的服务继续可见可停）。 */
  noteSessionDisposed(sessionId: SessionId): void {
    this.watcher.cancelSession(sessionId);
  }

  /** 会话登记清理（stopAll 之后或用户要求清空）；是否 kill 由调用方先决定。 */
  clearSession(sessionId: SessionId): void {
    this.watcher.cancelSession(sessionId);
    this.registry.clearSession(sessionId);
    const timer = this.pushTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.pushTimers.delete(sessionId);
    }
    this.push(sessionId, []);
  }

  /** 应用退出：kill 或放弃。 */
  prepareQuit(mode: "kill" | "keep"): number {
    if (mode === "keep") {
      this.quitKeep = true;
      this.registry.abandonAll();
      this.watcher.dispose();
      return 0;
    }
    const alive = this.registry.listAllAlive();
    const stopped = killManagedProcessesSync(alive);
    this.watcher.dispose();
    this.registry.abandonAll();
    return stopped;
  }

  isQuitKeep(): boolean {
    return this.quitKeep;
  }

  /** 启动时发现上次非正常退出（§5.4 P0）。 */
  markResidualNotice(): void {
    this.residualNotice = true;
  }

  /** 消费一次残留提示；无则 false。 */
  consumeResidualNotice(): boolean {
    const hit = this.residualNotice;
    this.residualNotice = false;
    return hit;
  }

  private schedulePush(sessionId: SessionId): void {
    if (this.pushTimers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.pushTimers.delete(sessionId);
      this.push(sessionId, this.registry.listBySession(sessionId));
    }, WATCH_TIMING.pushBatchMs);
    this.pushTimers.set(sessionId, timer);
  }

  private push(sessionId: SessionId, processes: ManagedProcess[]): void {
    const message: ProcPushMessage = { sessionId, processes };
    getMainWindow()?.webContents.send(PROC_IPC.changed, message);
  }
}

export const procService = new ProcService();

/** 测试可注入枚举实现。 */
export function createProcService(enumerate: EnumerateProcesses): ProcService {
  return new ProcService(enumerate);
}

export type { ProcService };
export { type ProcessSnapshotRow, queryProcess };
