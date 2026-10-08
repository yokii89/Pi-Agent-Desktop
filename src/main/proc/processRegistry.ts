import type { ManagedProcess, ManagedProcessStatus, SessionId } from "../../shared/ipc";

/**
 * ManagedProcess 登记表（内存态，不持久化——重启后按存活扫描自愈见设计 §5.4 P0）。
 * 按 sessionId 分桶；状态流转只经本模块，便于合批 push 与单测。
 */
export type ProcessRegistrySnapshot = ReadonlyMap<SessionId, readonly ManagedProcess[]>;

export interface ProcessRegistryHooks {
  /** 登记/状态变化后回调（由外层做 ~200ms 合批推送）。 */
  onChange?: (sessionId: SessionId, processes: ManagedProcess[]) => void;
}

function makeId(sessionId: SessionId, pid: number, startedAt: number): string {
  return `${sessionId}:${pid}:${startedAt}`;
}

export class ProcessRegistry {
  private readonly bySession = new Map<SessionId, Map<string, ManagedProcess>>();
  private readonly hooks: ProcessRegistryHooks;

  constructor(hooks: ProcessRegistryHooks = {}) {
    this.hooks = hooks;
  }

  /** 登记候选；同 PID 已存在则不重复登记，返回既有项。 */
  register(input: {
    sessionId: SessionId;
    pid: number;
    ppid: number;
    commandLine: string;
    name: string;
    startedAt: number;
    sourceToolCallId?: string;
  }): ManagedProcess | null {
    const bucket = this.ensureBucket(input.sessionId);
    const id = makeId(input.sessionId, input.pid, input.startedAt || Date.now());
    const existing = bucket.get(id);
    if (existing) {
      // ignored 本 session 不再出现（docs/design/37 §3.3）
      return existing.status === "ignored" ? null : existing;
    }
    // 同 session 同 PID：alive 去重；ignored 本 session 不再出现
    for (const proc of bucket.values()) {
      if (proc.pid !== input.pid) continue;
      if (proc.status === "ignored") return null;
      if (proc.status === "alive") return proc;
    }
    const now = Date.now();
    const proc: ManagedProcess = {
      id,
      sessionId: input.sessionId,
      pid: input.pid,
      ppid: input.ppid,
      commandLine: input.commandLine,
      name: input.name,
      startedAt: input.startedAt || now,
      registeredAt: now,
      sourceToolCallId: input.sourceToolCallId,
      status: "alive",
    };
    bucket.set(id, proc);
    this.emit(input.sessionId);
    return proc;
  }

  /** 状态流转；ignored/exited 后保留在桶内直到 session 清理。 */
  setStatus(id: string, status: ManagedProcessStatus): ManagedProcess | null {
    for (const [sessionId, bucket] of this.bySession) {
      const proc = bucket.get(id);
      if (!proc) continue;
      if (proc.status === status) return proc;
      const next: ManagedProcess = { ...proc, status };
      bucket.set(id, next);
      this.emit(sessionId);
      return next;
    }
    return null;
  }

  get(id: string): ManagedProcess | null {
    for (const bucket of this.bySession.values()) {
      const proc = bucket.get(id);
      if (proc) return proc;
    }
    return null;
  }

  listBySession(sessionId: SessionId): ManagedProcess[] {
    return [...(this.bySession.get(sessionId)?.values() ?? [])];
  }

  /** 仅 status=alive（浮窗计数与回收确认用）。 */
  listAliveBySession(sessionId: SessionId): ManagedProcess[] {
    return this.listBySession(sessionId).filter((p) => p.status === "alive");
  }

  listAllAlive(): ManagedProcess[] {
    const out: ManagedProcess[] = [];
    for (const sessionId of this.bySession.keys()) {
      out.push(...this.listAliveBySession(sessionId));
    }
    return out;
  }

  countAlive(sessionId: SessionId): number {
    return this.listAliveBySession(sessionId).length;
  }

  countAllAlive(): number {
    return this.listAllAlive().length;
  }

  /** 会话清理：移除该会话全部登记项（不 kill——回收策略由调用方决定）。 */
  clearSession(sessionId: SessionId): void {
    if (!this.bySession.delete(sessionId)) return;
    this.emit(sessionId);
  }

  /** 应用退出前放弃全部登记（用户选「保留」时）。 */
  abandonAll(): void {
    const ids = [...this.bySession.keys()];
    this.bySession.clear();
    for (const sessionId of ids) this.emit(sessionId);
  }

  private ensureBucket(sessionId: SessionId): Map<string, ManagedProcess> {
    let bucket = this.bySession.get(sessionId);
    if (!bucket) {
      bucket = new Map();
      this.bySession.set(sessionId, bucket);
    }
    return bucket;
  }

  private emit(sessionId: SessionId): void {
    this.hooks.onChange?.(sessionId, this.listBySession(sessionId));
  }
}
