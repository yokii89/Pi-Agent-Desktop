import type {
  ManagedProcess,
  ProcDetail,
  ProcPushMessage,
  ProcStopAllResult,
  ProcStopResult,
  SessionId,
} from "../../shared/ipc";
import { PROC_IPC } from "../../shared/ipc";
import {
  loadProcRegistry,
  type PersistedIgnored,
  type PersistedProc,
  procIdentity,
  saveProcRegistry,
} from "../settings/procRegistryStore";
import { getMainWindow } from "../window/createMainWindow";
import { readProcessDetail } from "./processDetail";
import {
  enumerateProcesses,
  getProcessSnapshot,
  isPidReuse,
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

/** 认领待收养项时可复用的快照最大年龄：启动收养刚枚举过一次，不必再来一次。 */
const CLAIM_SNAPSHOT_MAX_AGE_MS = 15_000;
/** 登记变化频繁，整份 JSON 重写跟推送一样合批。 */
const PERSIST_DEBOUNCE_MS = 1_500;
/** managed-processes.json 的当前版本。 */
const PERSIST_FILE_VERSION = 1;

/**
 * 后台进程域编排：登记表 + bash 边界监听 + 合批 push + 跨重启收养（docs/design/133）。
 * 不改 SessionPushMessage；推送走独立通道 `pidesk:proc:changed`。
 */
class ProcService {
  readonly registry = new ProcessRegistry({
    onChange: (sessionId) => {
      this.schedulePush(sessionId);
      this.schedulePersist();
    },
  });

  private watcher: ProcessWatcher;
  private enumerate: EnumerateProcesses;
  private pushTimers = new Map<SessionId, ReturnType<typeof setTimeout>>();
  /** 退出时「保留」则放弃登记不 kill。 */
  private quitKeep = false;
  /** 上次非正常退出的残留提示（§5.4 P0）；消费一次后清空。 */
  private residualNotice = false;
  /** 会话 JSONL 锚点：SessionId 每次启动都换，落盘与重启收养只认 sessionFile。 */
  private readonly sessionFiles = new Map<SessionId, string>();
  /** 上次运行留下、还没被同名会话认领的登记项（认领时才进桶，避免幽灵行）。 */
  private pendingAdopt: PersistedProc[] = [];
  /** 用户点过「忽略」的进程，跨重启保持忽略；启动收养时按存活收敛。 */
  private ignoredMap = new Map<string, PersistedIgnored>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

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
    const proc = this.registry.get(id);
    const sessionFile = proc ? this.sessionFiles.get(proc.sessionId) : undefined;
    if (proc && sessionFile) {
      // 忽略要跨重启有效：桶里的行会随 clearSession 消失，键先记到独立表
      const key = procIdentity(sessionFile, proc.pid, proc.startedAt);
      this.ignoredMap.set(key, {
        sessionFile,
        pid: proc.pid,
        commandLine: proc.commandLine,
        startedAt: proc.startedAt,
      });
    }
    return this.registry.setStatus(id, "ignored");
  }

  /** 进程详情（子树 / 端口 / 内存）；只接受属于该 session 的登记 id。 */
  async detail(sessionId: SessionId, id: string): Promise<ProcDetail> {
    const proc = this.registry.get(id);
    if (!proc || proc.sessionId !== sessionId) throw new Error("进程登记项不存在");
    return readProcessDetail(proc);
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

  /**
   * piSession 启动 / 重开：记住 JSONL 锚点，并把上次留下的同 sessionFile 登记项认领回来。
   * 认领时才进桶——行要能被 5s 对账与详情轮询纠错，挂在一个没有会话的桶里没有意义。
   */
  noteSessionFile(sessionId: SessionId, sessionFile: string | null): void {
    if (!sessionFile) return;
    this.sessionFiles.set(sessionId, sessionFile);
    void this.claimPending(sessionId, sessionFile);
  }

  /** 上次运行的条目先在这里验存活，验过的进待认领池，等对应会话开起来才成行。 */
  async adoptSurvivors(): Promise<void> {
    const file = loadProcRegistry();
    this.ignoredMap = new Map(
      file.ignored.map((item) => [procIdentity(item.sessionFile, item.pid, item.startedAt), item]),
    );
    if (file.entries.length === 0) return;
    const snapshot = await this.enumerate();
    if (!snapshot) {
      // 枚举失败 ≠ 进程消失，但也拿不到证据：条目原样留着，下次启动再判
      this.pendingAdopt = file.entries;
      return;
    }
    // 忽略项也按存活收敛：进程已经没了还留着键，等于给未来同 pid 的进程发免死金牌
    for (const [key, item] of [...this.ignoredMap]) {
      const row = snapshot.get(item.pid);
      if (!row || isPidReuse(item, row)) this.ignoredMap.delete(key);
    }
    this.pendingAdopt = file.entries.filter(
      (entry) =>
        !this.ignoredMap.has(procIdentity(entry.sessionFile, entry.pid, entry.startedAt)) &&
        (() => {
          const row = snapshot.get(entry.pid);
          return !!row && !isPidReuse(entry, row);
        })(),
    );
    this.persist();
  }

  private async claimPending(sessionId: SessionId, sessionFile: string): Promise<void> {
    const take = this.pendingAdopt.filter((entry) => entry.sessionFile === sessionFile);
    if (take.length === 0) return;
    // 启动收养刚枚举过，15s 内的快照直接用；拿不到就整批留到下次认领，不登记未验证的进程
    const snapshot = await getProcessSnapshot(CLAIM_SNAPSHOT_MAX_AGE_MS);
    if (!snapshot) return;
    this.pendingAdopt = this.pendingAdopt.filter((entry) => entry.sessionFile !== sessionFile);
    for (const entry of take) {
      const row = snapshot.get(entry.pid);
      if (!row || isPidReuse(entry, row)) continue;
      this.registry.register({
        sessionId,
        pid: entry.pid,
        ppid: entry.ppid,
        commandLine: entry.commandLine,
        name: entry.name,
        startedAt: entry.startedAt,
        origin: entry.origin,
      });
    }
  }

  /** 登记变化写盘很频繁，整份 JSON 重写跟推送一样合批一次。 */
  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimer.unref?.();
  }

  /** 落盘：在世登记项 + 未认领条目 + 忽略键；退出路径走同步版。 */
  private persist(): void {
    const entries: PersistedProc[] = [];
    for (const proc of this.registry.listAllAlive()) {
      const sessionFile = this.sessionFiles.get(proc.sessionId);
      if (!sessionFile) continue;
      entries.push({
        sessionFile,
        pid: proc.pid,
        ppid: proc.ppid,
        name: proc.name,
        commandLine: proc.commandLine,
        startedAt: proc.startedAt,
        registeredAt: proc.registeredAt,
        origin: proc.origin,
      });
    }
    entries.push(...this.pendingAdopt);
    saveProcRegistry({
      version: PERSIST_FILE_VERSION,
      entries,
      ignored: [...this.ignoredMap.values()],
    });
  }

  /** 应用退出：kill 或放弃。两条路都要先把在世项写盘，abandonAll 之后就没有登记表了。 */
  prepareQuit(mode: "kill" | "keep"): number {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persist();
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
