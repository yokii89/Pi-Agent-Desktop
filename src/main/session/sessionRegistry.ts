/**
 * 会话运行时实例注册表（纯逻辑，无 Electron/子进程依赖）。
 * 主进程多 pi 并行的 Map 状态与 start 判定集中在此，便于单测。
 * 运行时 SessionId ≠ SessionSummary.id（JSONL 头部 id）。
 */
import type { SessionId } from "../../shared/ipc";

export interface SessionInstanceSnapshot {
  id: SessionId;
  sessionFile: string | null;
  /** 子进程是否仍存活（已 spawn 且未 exit/dispose）。 */
  childAlive: boolean;
  /** stdin 已 end、尚未 exit：禁止同 file 双写。 */
  shuttingDown: boolean;
}

export type StartDecision =
  /** 复用存活实例（同 sessionFile 或同 sessionId） */
  | { kind: "reuse"; sessionId: SessionId }
  /** 同 id 在途/存活需先 dispose 再 spawn */
  | { kind: "restart"; sessionId: SessionId }
  /** 同 file 正在 shutting down：明确拒绝，禁止并行双写 */
  | { kind: "reject"; error: string }
  /** 超过并发上限 */
  | { kind: "reject-limit"; error: string }
  /** 新建实例 */
  | { kind: "spawn"; sessionId: SessionId };

export const DEFAULT_MAX_PARALLEL_SESSIONS = 8;

export function normalizeMaxParallelSessions(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  return DEFAULT_MAX_PARALLEL_SESSIONS;
}

export class SessionRegistry {
  #sessions = new Map<SessionId, SessionInstanceSnapshot>();
  #fileToSessionId = new Map<string, SessionId>();
  /** 同 sessionFile 在途 start：TOCTOU 时第二次 start 等待同一 Promise。 */
  #fileStarts = new Map<string, Promise<SessionId>>();

  has(id: SessionId): boolean {
    return this.#sessions.has(id);
  }

  get(id: SessionId): SessionInstanceSnapshot | undefined {
    return this.#sessions.get(id);
  }

  get size(): number {
    return this.#sessions.size;
  }

  listIds(): SessionId[] {
    return [...this.#sessions.keys()];
  }

  /** 仅返回子进程存活且未 shuttingDown 的实例。 */
  findByFile(sessionFile: string): SessionInstanceSnapshot | null {
    const id = this.#fileToSessionId.get(sessionFile);
    if (!id) return null;
    const inst = this.#sessions.get(id);
    if (!inst?.childAlive || inst.shuttingDown) return null;
    return inst;
  }

  /** 反查：该 sessionFile 当前映射到的 SessionId（不论是否存活）。 */
  sessionIdForFile(sessionFile: string): SessionId | null {
    return this.#fileToSessionId.get(sessionFile) ?? null;
  }

  upsert(snapshot: SessionInstanceSnapshot): void {
    this.#sessions.set(snapshot.id, snapshot);
    if (snapshot.sessionFile) {
      this.#fileToSessionId.set(snapshot.sessionFile, snapshot.id);
    }
  }

  patch(
    id: SessionId,
    patch: Partial<Pick<SessionInstanceSnapshot, "sessionFile" | "childAlive" | "shuttingDown">>,
  ): void {
    const current = this.#sessions.get(id);
    if (!current) return;
    const next: SessionInstanceSnapshot = { ...current, ...patch };
    // file 变更：清旧索引再写新
    if (
      patch.sessionFile !== undefined &&
      current.sessionFile &&
      current.sessionFile !== next.sessionFile
    ) {
      if (this.#fileToSessionId.get(current.sessionFile) === id) {
        this.#fileToSessionId.delete(current.sessionFile);
      }
    }
    this.#sessions.set(id, next);
    if (next.sessionFile) {
      this.#fileToSessionId.set(next.sessionFile, id);
    }
  }

  /** exit / dispose：移除实例并清理 file 索引。 */
  remove(id: SessionId): void {
    const inst = this.#sessions.get(id);
    this.#sessions.delete(id);
    if (inst?.sessionFile && this.#fileToSessionId.get(inst.sessionFile) === id) {
      this.#fileToSessionId.delete(inst.sessionFile);
    }
  }

  clear(): void {
    this.#sessions.clear();
    this.#fileToSessionId.clear();
    this.#fileStarts.clear();
  }

  /**
   * start 判定（决策 #4/#7 + A2/A5）：
   * - 同 file 存活 → reuse
   * - 同 file shutting down → reject（禁止双写）
   * - 同 id 已存在 → restart
   * - 超上限且无法复用 → reject-limit（不自动杀最旧）
   * - 否则 spawn
   */
  decideStart(
    req: { sessionId?: SessionId; sessionFile?: string },
    createId: () => SessionId,
    maxParallel: number,
  ): StartDecision {
    const { sessionId, sessionFile } = req;

    if (sessionFile) {
      const existingId = this.#fileToSessionId.get(sessionFile);
      if (existingId) {
        const inst = this.#sessions.get(existingId);
        if (inst?.childAlive && !inst.shuttingDown) {
          return { kind: "reuse", sessionId: existingId };
        }
        if (inst?.shuttingDown) {
          return {
            kind: "reject",
            error: "该会话的 pi 进程正在结束，请稍后再打开",
          };
        }
      }
    }

    if (sessionId && this.#sessions.has(sessionId)) {
      const existing = this.#sessions.get(sessionId);
      if (existing?.shuttingDown) {
        return { kind: "reject", error: "该会话的 pi 进程正在结束，请稍后再打开" };
      }
      return { kind: "restart", sessionId };
    }

    const max = normalizeMaxParallelSessions(maxParallel);
    if (this.#sessions.size >= max) {
      return {
        kind: "reject-limit",
        error: `并行会话已达上限（${max}），请先在侧栏「结束进程」后再新建。`,
      };
    }

    return { kind: "spawn", sessionId: sessionId ?? createId() };
  }

  /** 同 file 在途 start：第二次调用返回既有 Promise，保证只 spawn 一次。 */
  beginFileStart(sessionFile: string, task: () => Promise<SessionId>): Promise<SessionId> {
    const inflight = this.#fileStarts.get(sessionFile);
    if (inflight) return inflight;
    const promise = task().finally(() => {
      this.#fileStarts.delete(sessionFile);
    });
    this.#fileStarts.set(sessionFile, promise);
    return promise;
  }

  fileStartInflight(sessionFile: string): Promise<SessionId> | null {
    return this.#fileStarts.get(sessionFile) ?? null;
  }
}
