import type { SessionId } from "../../shared/ipc";

/**
 * 进程枚举快照的单行（Win32_Process 子集）。
 * 纯数据结构，便于 processWatch 的 diff / BFS 做单测。
 */
export interface ProcessSnapshotRow {
  pid: number;
  ppid: number;
  name: string;
  commandLine: string;
  /** CreationDate → Unix ms；未知为 0。 */
  startedAt: number;
}

export type ProcessSnapshot = ReadonlyMap<number, ProcessSnapshotRow>;

/** 中间层 shell / 宿主：只作树边，不单独登记。 */
const SHELL_WRAPPERS = new Set(
  [
    "conhost.exe",
    "openconsole.exe",
    "cmd.exe",
    "bash.exe",
    "sh.exe",
    "zsh.exe",
    "powershell.exe",
    "pwsh.exe",
    "wsl.exe",
    "wslhost.exe",
    "windowsterminal.exe",
    "winpty-agent.exe",
    "winpty.exe",
  ].map((s) => s.toLowerCase()),
);

/**
 * 默认服务模式（命令行 / Name 不区分大小写子串；`node .*--watch` 为正则）。
 * 误报可接受、漏报可再收紧——用户可在浮窗「忽略」。
 */
const SERVICE_SUBSTRINGS = [
  "vite",
  "next dev",
  "nuxt",
  "webpack",
  "react-scripts",
  "ng serve",
  "npm run dev",
  "pnpm dev",
  "yarn dev",
  "uvicorn",
  "gunicorn",
  "fastapi",
  "django",
  "runserver",
  "flask",
  "hypercorn",
  "php -s",
  "dotnet watch",
  "cargo watch",
  "compiledaemon",
];

const SERVICE_REGEXES = [/node\s+[^\n]*--watch/i, /ruby\s+[^\n]*server/i, /\bair\b/i];

/** 是否为 shell / 宿主包装层（不单独登记）。 */
export function isShellWrapper(name: string): boolean {
  return SHELL_WRAPPERS.has(name.trim().toLowerCase());
}

/** 命令行或镜像名是否命中服务启发式。 */
export function matchesServicePattern(name: string, commandLine: string): boolean {
  const hay = `${name}\n${commandLine}`.toLowerCase();
  if (SERVICE_SUBSTRINGS.some((s) => hay.includes(s))) return true;
  return SERVICE_REGEXES.some((re) => re.test(commandLine) || re.test(name));
}

/** 展示用命令摘要：优先命令行，过长截断。 */
export function summarizeCommand(commandLine: string, name: string): string {
  const raw = (commandLine || name).trim().replace(/\s+/g, " ");
  if (raw.length <= 48) return raw;
  return `${raw.slice(0, 47)}…`;
}

/**
 * 以 rootPid 为根做 BFS 子树（含 root 自身）。
 * 仅遍历 snapshot 中仍存在的节点；死掉的中间父由 mergeAncestors 补历史边。
 */
export function collectSubtree(snapshot: ProcessSnapshot, rootPid: number): ProcessSnapshotRow[] {
  const out: ProcessSnapshotRow[] = [];
  const seen = new Set<number>();
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const row = snapshot.get(pid);
    if (!row) continue;
    out.push(row);
    for (const [childPid, child] of snapshot) {
      if (child.ppid === pid && !seen.has(childPid)) queue.push(childPid);
    }
  }
  return out;
}

/**
 * 合并多份快照（S0 基线 + S1 当前）做祖先回溯：
 * bash 等中间层退出后，子孙的 PPID 仍指向死 PID，需要历史边才能爬回 pi 根。
 */
export function mergeSnapshots(...maps: ProcessSnapshot[]): ProcessSnapshot {
  const merged = new Map<number, ProcessSnapshotRow>();
  for (const map of maps) {
    for (const [pid, row] of map) {
      // 后写覆盖：S1 的存活信息优先；PPID 以最早可见为准（S0 更接近创建时）
      const existing = merged.get(pid);
      if (!existing) {
        merged.set(pid, row);
      } else {
        merged.set(pid, {
          ...row,
          ppid: existing.ppid !== 0 ? existing.ppid : row.ppid,
          startedAt: existing.startedAt || row.startedAt,
        });
      }
    }
  }
  return merged;
}

/**
 * 从 pid 沿 PPID 爬到 rootPid（允许经过已死节点，只要 merged 里有历史行）。
 * 到达返回 true；成环或断链返回 false。
 */
export function isDescendantOf(
  merged: ProcessSnapshot,
  pid: number,
  rootPid: number,
  maxHops = 64,
): boolean {
  let cur = pid;
  for (let hop = 0; hop < maxHops; hop += 1) {
    if (cur === rootPid) return true;
    const row = merged.get(cur);
    if (!row || row.ppid === 0 || row.ppid === cur) return false;
    cur = row.ppid;
  }
  return false;
}

/** 相对 baseline 新出现、且经历史边仍挂在 rootPid 子树上的进程。 */
export function diffNewInSubtree(
  baseline: ProcessSnapshot,
  current: ProcessSnapshot,
  rootPid: number,
): ProcessSnapshotRow[] {
  const merged = mergeSnapshots(baseline, current);
  const out: ProcessSnapshotRow[] = [];
  for (const [pid, row] of current) {
    if (baseline.has(pid)) continue;
    if (pid === rootPid) continue;
    if (!isDescendantOf(merged, pid, rootPid)) continue;
    out.push(row);
  }
  return out;
}

/**
 * 登记门槛：像服务 + 不在排除集 + 取「最深的干活进程」。
 * 同链上父子都命中时只留最深（如 npm → node/vite 只登记 vite）。
 */
export function pickServiceCandidates(rows: ProcessSnapshotRow[]): ProcessSnapshotRow[] {
  const eligible = rows.filter(
    (r) => !isShellWrapper(r.name) && matchesServicePattern(r.name, r.commandLine),
  );
  const parentIds = new Set(eligible.map((r) => r.pid));
  // 任一 eligible 是其父 → 当前不是最深，抑制父节点
  const suppressed = new Set<number>();
  for (const row of eligible) {
    if (parentIds.has(row.ppid)) suppressed.add(row.ppid);
  }
  return eligible.filter((r) => !suppressed.has(r.pid));
}

/** bash 边界快照窗口参数（docs/design/37 §3.1）。 */
export const WATCH_TIMING = {
  /** tool_execution_end 后延迟再快照 S1，等 spawn 稳定。 */
  settleMs: 800,
  /** 存活复核三次，丢掉短命 helper。 */
  recheckMs: [1000, 5000, 15000] as const,
  /** 登记/状态变化合批推送。 */
  pushBatchMs: 200,
} as const;

export interface BashBoundaryState {
  sessionId: SessionId;
  rootPid: number;
  toolCallId: string;
  /** tool_execution_start 时的基线 S0。 */
  baseline: ProcessSnapshot;
  startedAt: number;
}

/** 枚举函数注入，便于单测替换。 */
export type EnumerateProcesses = () => Promise<ProcessSnapshot | null>;

export interface ProcessWatcherDeps {
  enumerate: EnumerateProcesses;
  /** 候选通过复核后登记；返回 null 表示忽略/去重拒绝。 */
  register: (input: {
    sessionId: SessionId;
    pid: number;
    ppid: number;
    commandLine: string;
    name: string;
    startedAt: number;
    sourceToolCallId?: string;
  }) => void;
  /** PID 消失时标记 exited。 */
  markExited: (pid: number, sessionId: SessionId) => void;
}

/**
 * bash 边界编排：start 记基线，end 延迟快照 diff，再按复核窗丢短命进程。
 * 同 session 串行处理最近一次 bash（并发 bash 时后一次覆盖前一次的 pending）。
 */
export class ProcessWatcher {
  private readonly deps: ProcessWatcherDeps;
  private readonly pending = new Map<
    SessionId,
    { state: BashBoundaryState; timer: ReturnType<typeof setTimeout> | null }
  >();
  private readonly recheckTimers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(deps: ProcessWatcherDeps) {
    this.deps = deps;
  }

  /** tool_execution_start（bash）：记 t0 + 基线 S0。 */
  async noteBashStart(sessionId: SessionId, rootPid: number, toolCallId: string): Promise<void> {
    if (this.disposed || rootPid <= 0) return;
    const baseline = (await this.deps.enumerate()) ?? new Map();
    const existing = this.pending.get(sessionId);
    if (existing?.timer) clearTimeout(existing.timer);
    this.pending.set(sessionId, {
      state: { sessionId, rootPid, toolCallId, baseline, startedAt: Date.now() },
      timer: null,
    });
  }

  /**
   * tool_execution_end（bash）：+settleMs 再快照 S1 并 diff 登记。
   * toolCallId 可选：传入时仅当与 pending 的 bash 调用匹配才收口。
   */
  noteBashEnd(sessionId: SessionId, toolCallId?: string): void {
    if (this.disposed) return;
    const entry = this.pending.get(sessionId);
    if (!entry) return;
    if (toolCallId !== undefined && entry.state.toolCallId !== toolCallId) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.resolveBoundary(sessionId);
    }, WATCH_TIMING.settleMs);
  }

  /** 会话 dispose：取消未决边界（不 kill 后台，回收由调用方决定）。 */
  cancelSession(sessionId: SessionId): void {
    const entry = this.pending.get(sessionId);
    if (entry?.timer) clearTimeout(entry.timer);
    this.pending.delete(sessionId);
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.pending.clear();
    for (const timer of this.recheckTimers) clearTimeout(timer);
    this.recheckTimers.clear();
  }

  private async resolveBoundary(sessionId: SessionId): Promise<void> {
    const entry = this.pending.get(sessionId);
    if (!entry || this.disposed) return;
    this.pending.delete(sessionId);
    const current = await this.deps.enumerate();
    if (!current || this.disposed) return;
    const rows = diffNewInSubtree(entry.state.baseline, current, entry.state.rootPid);
    const candidates = pickServiceCandidates(rows);
    for (const row of candidates) {
      // 先活过 1s 复核再登记（设计 §3.1）：短命 helper 直接丢
      this.scheduleRecheck(sessionId, row, entry.state.toolCallId, 0);
    }
  }

  /** 按 recheckMs 逐级复核；第 0 档通过才登记，后续档消失标 exited。 */
  private scheduleRecheck(
    sessionId: SessionId,
    row: ProcessSnapshotRow,
    toolCallId: string,
    step: number,
  ): void {
    const delays = WATCH_TIMING.recheckMs;
    const delay = step === 0 ? delays[0] : delays[step] - delays[step - 1];
    const timer = setTimeout(
      () => {
        this.recheckTimers.delete(timer);
        void this.runRecheck(sessionId, row, toolCallId, step);
      },
      Math.max(0, delay),
    );
    this.recheckTimers.add(timer);
  }

  private async runRecheck(
    sessionId: SessionId,
    row: ProcessSnapshotRow,
    toolCallId: string,
    step: number,
  ): Promise<void> {
    if (this.disposed) return;
    const snapshot = await this.deps.enumerate();
    const alive = snapshot?.get(row.pid);
    if (!alive) {
      if (step > 0) this.deps.markExited(row.pid, sessionId);
      return;
    }
    if (step === 0) {
      this.deps.register({
        sessionId,
        pid: row.pid,
        ppid: alive.ppid,
        commandLine: alive.commandLine || row.commandLine,
        name: alive.name || row.name,
        startedAt: alive.startedAt || row.startedAt,
        sourceToolCallId: toolCallId,
      });
    }
    if (step + 1 < WATCH_TIMING.recheckMs.length) {
      this.scheduleRecheck(sessionId, { ...row, ...alive }, toolCallId, step + 1);
    }
  }
}
