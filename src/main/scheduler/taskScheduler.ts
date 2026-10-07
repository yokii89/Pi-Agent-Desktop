/**
 * 定时任务调度器（docs 30 §2.4 的 PiDesk 裁剪版）。
 * ZCode 是「独立 scheduler 进程 + SQLite 台账 + 多 host 路由」；PiDesk 只有一类
 * 执行域（pi 会话子进程），因此收敛为主进程内的 setTimeout 链 + JSON 台账。
 * 到点动作只有一件事：确保目标会话就绪后把 prompt 发进去（复用既有 RPC 路径）。
 *
 * 三条调度语义（docs 30 §8 Q4，按文档建议落地）：
 * 1. 应用未运行期间错过的触发点：启动/唤醒时补跑一次并标注「错过 N 个触发点」；
 *    一次性任务错过即过期落账，不再补跑。
 * 2. 系统睡眠唤醒：powerMonitor.resume 后重扫 + 重臂，不信任休眠期间停摆的旧定时器。
 * 3. 上一轮未结束又到期：跳过并计数，不排队（排队语义是 docs 30 §1.2 的独立议题）。
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { powerMonitor } from "electron";
import {
  countMissedOccurrences,
  nextRunAfter,
  type RunNowOutcome,
  SCHEDULER_IPC,
  SCHEDULER_MAX_TIMER_MS,
  SCHEDULER_MISFIRE_GRACE_MS,
  SCHEDULER_TASK_LIMIT,
  type ScheduledRunRecord,
  type ScheduledRunTrigger,
  type ScheduledSkipReason,
  type ScheduledTask,
  type SchedulerSnapshot,
  sanitizeSchedulerTaskInput,
} from "../../shared/scheduler";
import {
  applyDefaultModelToSession,
  disposeSession,
  hasSession,
  promptSession,
} from "../session/piSession";
import {
  ensureSessionReady,
  getRuntimeSessionFile,
  getRuntimeState,
  hasModeTransition,
  onRuntimeActivity,
} from "../session/runtimeCoordinator";
import {
  loadScheduledTasks,
  saveScheduledTasks,
  trimScheduledRuns,
} from "../settings/scheduledTaskStore";
import { getMainWindow } from "../window/createMainWindow";

/** 派发判定余量：到期判定允许 500ms 提前量，避免定时器整数毫秒截断造成空转一轮。 */
const DUE_TOLERANCE_MS = 500;
/** prompt 接受超时：pi 正常毫秒级应答；超时按派发失败落账，不永久占住派发槽。 */
const PROMPT_TIMEOUT_MS = 60_000;

interface InFlightEntry {
  runId: string;
  sessionId: string;
  /** 派发时已知的会话 JSONL（新建会话在 ready 后回填）。 */
  sessionFile: string | null;
  /** true = 本调度器新建的会话（下一轮触发时回收其进程）；绑定会话永不回收。 */
  spawned: boolean;
}

let initialized = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let snapshot: SchedulerSnapshot = { tasks: [], runs: [] };
let offActivity: (() => void) | null = null;
/** task.id → 最近一次派发（冲突判定、上一轮进程回收、完成时刻回填）。 */
const inFlight = new Map<string, InFlightEntry>();
/** 同任务派发互斥：spawn 期间的异步空窗内，手动与定时触发不得双双通过冲突检查。 */
const dispatching = new Set<string>();

function findTask(taskId: string): ScheduledTask | undefined {
  return snapshot.tasks.find((task) => task.id === taskId);
}

function persist(): void {
  try {
    saveScheduledTasks(snapshot);
  } catch (error) {
    console.warn("[scheduler] 台账写盘失败", error);
  }
}

function pushChanged(): void {
  getMainWindow()?.webContents.send(SCHEDULER_IPC.changed, snapshot);
}

function commit(): void {
  persist();
  pushChanged();
}

function isSessionBusy(sessionId: string): boolean {
  // O(1) 定向查询：死会话由 getRuntimeState 归一为 cold（不算忙）；
  // 与 SESSION_IPC.prompt 的 assertNoModeTransition 同屏障：切换访问模式的会话视为忙
  if (hasModeTransition(sessionId)) return true;
  const state = getRuntimeState(sessionId);
  return state === "busy" || state === "starting";
}

function appendRun(run: ScheduledRunRecord): void {
  // 内存台账同样裁剪：否则长期运行时 snapshot.runs 无界增长，且每次推送全量快照
  snapshot = { ...snapshot, runs: trimScheduledRuns([...snapshot.runs, run]) };
}

function recordSkipped(
  task: ScheduledTask,
  trigger: ScheduledRunTrigger,
  scheduledAt: number,
  now: number,
  reason: ScheduledSkipReason,
  missedCount?: number,
): ScheduledRunRecord {
  const run: ScheduledRunRecord = {
    id: `run_${randomUUID()}`,
    taskId: task.id,
    trigger,
    status: "skipped",
    scheduledAt,
    startedAt: now,
    deviationMs: now - scheduledAt,
    skipReason: reason,
  };
  if (missedCount !== undefined && missedCount > 0) run.missedCount = missedCount;
  appendRun(run);
  task.skipCount += 1;
  task.updatedAt = now;
  return run;
}

/**
 * 派发一次运行：确保会话就绪 → 发 prompt → 落台账。
 * 只等待 pi 接受 prompt；agent 执行的结束时刻由 runtime activity 旁路回填（best-effort）。
 */
async function dispatchRun(
  task: ScheduledTask,
  trigger: ScheduledRunTrigger,
  scheduledAt: number,
  missedCount = 0,
): Promise<void> {
  const now = Date.now();
  if (dispatching.has(task.id)) {
    recordSkipped(task, trigger, scheduledAt, now, "conflict");
    commit();
    return;
  }
  dispatching.add(task.id);
  try {
    const prev = inFlight.get(task.id);
    if (prev && isSessionBusy(prev.sessionId)) {
      recordSkipped(task, trigger, scheduledAt, now, "conflict");
      commit();
      return;
    }
    const run: ScheduledRunRecord = {
      id: `run_${randomUUID()}`,
      taskId: task.id,
      trigger,
      status: "dispatched",
      scheduledAt,
      startedAt: now,
      deviationMs: now - scheduledAt,
    };
    if (missedCount > 0) run.missedCount = missedCount;
    try {
      // spawnInstance 对不存在的 cwd 会静默回退到用户主目录——无人值守任务绝不能
      // 在家目录里跑起来，这里在派发前显式拦下并落账为失败
      if (!fs.existsSync(task.cwd)) {
        throw new Error(`工作目录不存在：${task.cwd}`);
      }
      if (task.sessionFile && !fs.existsSync(task.sessionFile)) {
        throw new Error(`绑定的会话文件不存在：${task.sessionFile}`);
      }
      const { sessionId } = await ensureSessionReady({
        cwd: task.cwd,
        ...(task.sessionFile ? { sessionFile: task.sessionFile } : {}),
        reason: "scheduled",
      });
      // 与 SESSION_IPC.start 同款对齐：冷启动模型表未就绪时重试；失败不阻塞派发
      try {
        await applyDefaultModelToSession(sessionId, { retries: 1, delayMs: 200 });
      } catch {
        // 模型对齐失败不取消本次运行
      }
      await promptSession(sessionId, task.prompt, undefined, PROMPT_TIMEOUT_MS);
      if (prev?.spawned && hasSession(prev.sessionId)) {
        // 新建会话型任务：回收上一轮的空闲进程，并行会话名额不被定时任务吃满；
        // JSONL 历史保留，用户再打开时按文件重新拉起
        try {
          disposeSession(prev.sessionId);
        } catch {
          // 已退出时忽略
        }
      }
      const spawnedFile = getRuntimeSessionFile(sessionId);
      run.sessionId = sessionId;
      run.sessionFile = task.sessionFile ?? spawnedFile ?? undefined;
      inFlight.set(task.id, {
        runId: run.id,
        sessionId,
        sessionFile: run.sessionFile ?? null,
        spawned: task.sessionFile === null,
      });
      task.lastRunAt = now;
      task.runCount += 1;
      task.updatedAt = now;
      appendRun(run);
    } catch (error) {
      run.status = "failed";
      run.error = error instanceof Error ? error.message : String(error);
      appendRun(run);
    }
    commit();
  } finally {
    dispatching.delete(task.id);
  }
}

function tickDueTasks(now: number): void {
  const due = snapshot.tasks.filter(
    (task) => task.enabled && task.nextRunAt !== null && task.nextRunAt <= now + DUE_TOLERANCE_MS,
  );
  if (due.length === 0) return;
  // 先推进计划再异步派发：防止 spawn 期间同一触发点被重复处理
  const dispatched: Array<{ task: ScheduledTask; scheduledAt: number }> = [];
  for (const task of due) {
    const scheduledAt = task.nextRunAt as number;
    task.nextRunAt =
      task.rule.kind === "once" ? null : nextRunAfter(task.rule, now, task.createdAt);
    task.updatedAt = now;
    dispatched.push({ task, scheduledAt });
  }
  commit();
  for (const item of dispatched) {
    void dispatchRun(item.task, "schedule", item.scheduledAt);
  }
}

/**
 * 错过补扫（启动 / 睡眠唤醒共用）：宽限内的触发点留给正常 tick，
 * 超出宽限的循环任务补跑一次并标注错过数，一次性任务过期落账不再补跑。
 */
function misfireScan(now: number): void {
  const catchUps: Array<{ task: ScheduledTask; scheduledAt: number; missed: number }> = [];
  let dirty = false;
  for (const task of snapshot.tasks) {
    if (!task.enabled || task.nextRunAt === null) continue;
    if (task.nextRunAt > now - SCHEDULER_MISFIRE_GRACE_MS) continue;
    if (task.rule.kind === "once") {
      recordSkipped(task, "schedule", task.nextRunAt, now, "expired");
      task.nextRunAt = null;
      task.updatedAt = now;
      dirty = true;
      continue;
    }
    const missed = countMissedOccurrences(task.rule, task.nextRunAt, now, task.createdAt);
    const scheduledAt = task.nextRunAt;
    task.nextRunAt = nextRunAfter(task.rule, now, task.createdAt);
    // 补跑一个点，其余错过的点计入 skipCount（不排队、不逐点补跑）
    task.skipCount += Math.max(0, missed - 1);
    task.updatedAt = now;
    dirty = true;
    catchUps.push({ task, scheduledAt, missed });
  }
  if (dirty) commit();
  for (const item of catchUps) {
    void dispatchRun(item.task, "catch-up", item.scheduledAt, item.missed);
  }
}

function armTimer(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!initialized) return;
  let minAt: number | null = null;
  for (const task of snapshot.tasks) {
    if (!task.enabled || task.nextRunAt === null) continue;
    if (minAt === null || task.nextRunAt < minAt) minAt = task.nextRunAt;
  }
  if (minAt === null) return;
  const delay = Math.min(Math.max(minAt - Date.now(), 0) + 25, SCHEDULER_MAX_TIMER_MS);
  timer = setTimeout(() => {
    timer = null;
    const now = Date.now();
    tickDueTasks(now);
    armTimer();
  }, delay);
}

function handleRuntimeActivity(
  sessionId: string,
  activity: "busy" | "idle" | "exit",
  meta?: { willRetry?: boolean },
): void {
  if (activity === "exit") {
    for (const [taskId, entry] of [...inFlight]) {
      if (entry.sessionId === sessionId) inFlight.delete(taskId);
    }
    return;
  }
  if (activity !== "idle") return;
  // 自动重试的 agent_end 不是真空闲（agent_start 紧随其后），不回填完成时刻
  if (meta?.willRetry) return;
  const now = Date.now();
  let dirty = false;
  for (const entry of inFlight.values()) {
    if (entry.sessionId !== sessionId) continue;
    const run = snapshot.runs.find((item) => item.id === entry.runId);
    if (run && run.status === "dispatched" && run.finishedAt === undefined) {
      run.finishedAt = now;
      dirty = true;
    }
  }
  if (dirty) commit();
}

function handleResume(): void {
  misfireScan(Date.now());
  armTimer();
}

/** 当前快照（设置页概览等只读场景）。 */
export function getSchedulerSnapshot(): SchedulerSnapshot {
  return snapshot;
}

/** 创建/更新共用的落盘前校验：目录与会话文件必须真实存在，堵住 spawnInstance 的主目录回退。 */
function assertTargetsExist(cwd: string, sessionFile: string | null): void {
  if (!fs.existsSync(cwd)) {
    throw new Error(`工作目录不存在：${cwd}`);
  }
  if (sessionFile && !fs.existsSync(sessionFile)) {
    throw new Error(`绑定的会话文件不存在：${sessionFile}`);
  }
}

export function createScheduledTask(raw: unknown): ScheduledTask {
  const input = sanitizeSchedulerTaskInput(raw);
  if (snapshot.tasks.length >= SCHEDULER_TASK_LIMIT) {
    throw new Error(`定时任务最多 ${SCHEDULER_TASK_LIMIT} 个，请先删除部分任务`);
  }
  const now = Date.now();
  if (input.rule.kind === "once" && input.rule.at <= now) {
    throw new Error("一次性任务的触发时间必须晚于当前时刻");
  }
  assertTargetsExist(input.cwd, input.sessionFile ?? null);
  const task: ScheduledTask = {
    id: `task_${randomUUID()}`,
    name: input.name,
    prompt: input.prompt,
    cwd: input.cwd,
    sessionFile: input.sessionFile ?? null,
    rule: input.rule,
    enabled: input.enabled ?? true,
    nextRunAt: nextRunAfter(input.rule, now, now),
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    runCount: 0,
    skipCount: 0,
  };
  snapshot = { ...snapshot, tasks: [...snapshot.tasks, task] };
  commit();
  armTimer();
  return task;
}

export function updateScheduledTask(id: string, raw: unknown): ScheduledTask {
  const task = findTask(id);
  if (!task) throw new Error("任务不存在或已被删除");
  const input = sanitizeSchedulerTaskInput(raw);
  const now = Date.now();
  if (input.rule.kind === "once" && input.rule.at <= now) {
    throw new Error("一次性任务的触发时间必须晚于当前时刻");
  }
  assertTargetsExist(input.cwd, input.sessionFile ?? null);
  task.name = input.name;
  task.prompt = input.prompt;
  task.cwd = input.cwd;
  task.sessionFile = input.sessionFile ?? null;
  task.rule = input.rule;
  task.enabled = input.enabled ?? task.enabled;
  task.nextRunAt = nextRunAfter(input.rule, now, task.createdAt);
  task.updatedAt = now;
  commit();
  armTimer();
  return task;
}

export function removeScheduledTask(id: string): null {
  const task = findTask(id);
  if (!task) throw new Error("任务不存在或已被删除");
  snapshot = {
    tasks: snapshot.tasks.filter((item) => item.id !== id),
    runs: snapshot.runs.filter((run) => run.taskId !== id),
  };
  inFlight.delete(id);
  commit();
  armTimer();
  return null;
}

export function setScheduledTaskEnabled(id: string, enabled: boolean): ScheduledTask {
  const task = findTask(id);
  if (!task) throw new Error("任务不存在或已被删除");
  task.enabled = enabled;
  // 重新启用时不做错过补跑（用户主动操作，立即触发会显得失控），从现在起算下一轮
  if (enabled && task.nextRunAt !== null && task.nextRunAt < Date.now()) {
    task.nextRunAt = nextRunAfter(task.rule, Date.now(), task.createdAt);
  }
  task.updatedAt = Date.now();
  commit();
  armTimer();
  return task;
}

/** 立即运行一次：同步判定冲突后异步派发，结果经 changed 推送回到台账。 */
export function runScheduledTaskNow(id: string): RunNowOutcome {
  const task = findTask(id);
  if (!task) throw new Error("任务不存在或已被删除");
  const now = Date.now();
  const prev = inFlight.get(task.id);
  if (dispatching.has(task.id) || (prev && isSessionBusy(prev.sessionId))) {
    recordSkipped(task, "manual", now, now, "conflict");
    commit();
    return { kind: "skipped", reason: "conflict" };
  }
  void dispatchRun(task, "manual", now);
  return { kind: "dispatching" };
}

/** 应用就绪后初始化：读台账 → 错过补扫 → 挂 activity 旁路与唤醒钩子 → 重臂定时器。 */
export function initTaskScheduler(): void {
  if (initialized) return;
  initialized = true;
  snapshot = loadScheduledTasks();
  inFlight.clear();
  misfireScan(Date.now());
  offActivity = onRuntimeActivity(handleRuntimeActivity);
  powerMonitor.on("resume", handleResume);
  armTimer();
}

export function disposeTaskScheduler(): void {
  if (!initialized) return;
  initialized = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  offActivity?.();
  offActivity = null;
  powerMonitor.off("resume", handleResume);
}
