import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  normalizeScheduleRule,
  SCHEDULER_RUNS_KEEP_PER_TASK,
  SCHEDULER_RUNS_KEEP_TOTAL,
  type ScheduledRunRecord,
  type ScheduledTask,
  type SchedulerSnapshot,
} from "../../shared/scheduler";

/**
 * 定时任务落盘（userData/scheduled-tasks.json）。
 * 放在 settings 模块而不是各业务目录：AGENTS.md 数据持久化条款要求集中收口，
 * 禁止业务代码散落 fs.writeFile。不并入 settings.json——任务与运行台账写入频率
 * 远高于用户设置，混进去会让每次触发都重写整份设置文件。
 *
 * 损坏处理与 settings.ts 同策略：读失败/字段非法时回退并丢弃坏条目（console.warn），
 * 下次保存即覆盖，不让调度器因脏文件拒启动。
 */

const SCHEDULED_TASKS_FILENAME = "scheduled-tasks.json";
const FILE_VERSION = 1;

interface ScheduledTasksFile {
  version: number;
  tasks: unknown[];
  runs: unknown[];
}

function filePath(): string {
  return path.join(app.getPath("userData"), SCHEDULED_TASKS_FILENAME);
}

/** 把磁盘上的单条任务收成合法形态；规则损坏等不可修复条目返回 null（调用方丢弃）。 */
function normalizeTask(raw: unknown): ScheduledTask | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<ScheduledTask>;
  if (typeof record.id !== "string" || !record.id) return null;
  if (typeof record.name !== "string" || !record.name) return null;
  if (typeof record.prompt !== "string" || !record.prompt) return null;
  if (typeof record.cwd !== "string" || !record.cwd) return null;
  let rule: ScheduledTask["rule"];
  try {
    rule = normalizeScheduleRule(record.rule);
  } catch {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    prompt: record.prompt,
    cwd: record.cwd,
    sessionFile:
      typeof record.sessionFile === "string" && record.sessionFile ? record.sessionFile : null,
    rule,
    enabled: record.enabled === true,
    nextRunAt:
      typeof record.nextRunAt === "number" && Number.isFinite(record.nextRunAt)
        ? record.nextRunAt
        : null,
    createdAt:
      typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
        ? record.createdAt
        : Date.now(),
    updatedAt:
      typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : Date.now(),
    lastRunAt:
      typeof record.lastRunAt === "number" && Number.isFinite(record.lastRunAt)
        ? record.lastRunAt
        : null,
    runCount:
      typeof record.runCount === "number" && Number.isFinite(record.runCount)
        ? Math.max(0, Math.floor(record.runCount))
        : 0,
    skipCount:
      typeof record.skipCount === "number" && Number.isFinite(record.skipCount)
        ? Math.max(0, Math.floor(record.skipCount))
        : 0,
  };
}

function normalizeRun(raw: unknown): ScheduledRunRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<ScheduledRunRecord>;
  if (typeof record.id !== "string" || !record.id) return null;
  if (typeof record.taskId !== "string" || !record.taskId) return null;
  if (
    record.trigger !== "schedule" &&
    record.trigger !== "catch-up" &&
    record.trigger !== "manual"
  ) {
    return null;
  }
  if (record.status !== "dispatched" && record.status !== "skipped" && record.status !== "failed") {
    return null;
  }
  if (
    typeof record.scheduledAt !== "number" ||
    typeof record.startedAt !== "number" ||
    !Number.isFinite(record.scheduledAt) ||
    !Number.isFinite(record.startedAt)
  ) {
    return null;
  }
  return {
    id: record.id,
    taskId: record.taskId,
    trigger: record.trigger,
    status: record.status,
    scheduledAt: record.scheduledAt,
    startedAt: record.startedAt,
    deviationMs: record.startedAt - record.scheduledAt,
    ...(typeof record.missedCount === "number" && record.missedCount > 0
      ? { missedCount: Math.floor(record.missedCount) }
      : {}),
    ...(record.skipReason === "conflict" || record.skipReason === "expired"
      ? { skipReason: record.skipReason }
      : {}),
    ...(typeof record.sessionId === "string" && record.sessionId
      ? { sessionId: record.sessionId }
      : {}),
    ...(typeof record.sessionFile === "string" && record.sessionFile
      ? { sessionFile: record.sessionFile }
      : {}),
    ...(typeof record.finishedAt === "number" && Number.isFinite(record.finishedAt)
      ? { finishedAt: record.finishedAt }
      : {}),
    ...(typeof record.error === "string" && record.error ? { error: record.error } : {}),
  };
}

/** 台账裁剪：每任务 + 全局双上限，最旧的先淘汰（内存与写盘共用，防长期运行无界增长）。 */
export function trimScheduledRuns(runs: ScheduledRunRecord[]): ScheduledRunRecord[] {
  const perTask = new Map<string, number>();
  const kept: ScheduledRunRecord[] = [];
  for (const run of runs) {
    const count = perTask.get(run.taskId) ?? 0;
    if (count < SCHEDULER_RUNS_KEEP_PER_TASK) {
      perTask.set(run.taskId, count + 1);
      kept.push(run);
    }
  }
  return kept.slice(-SCHEDULER_RUNS_KEEP_TOTAL);
}

/** 读取快照；文件缺失或损坏时返回空表，不抛错（调度器启动不应被脏文件阻塞）。 */
export function loadScheduledTasks(): SchedulerSnapshot {
  let parsed: ScheduledTasksFile | null = null;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath(), "utf8")) as ScheduledTasksFile;
  } catch {
    return { tasks: [], runs: [] };
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tasks)) {
    return { tasks: [], runs: [] };
  }
  const tasks: ScheduledTask[] = [];
  for (const raw of parsed.tasks) {
    const task = normalizeTask(raw);
    if (task) tasks.push(task);
    else console.warn("[scheduler] 丢弃无法归一的定时任务条目");
  }
  const runs: ScheduledRunRecord[] = [];
  if (Array.isArray(parsed.runs)) {
    for (const raw of parsed.runs) {
      const run = normalizeRun(raw);
      if (run) runs.push(run);
    }
  }
  return { tasks, runs: trimScheduledRuns(runs) };
}

/** 写穿保存（调用频率为「每次触发/增删改」，同步写即可，与 settings.ts 同策略）。 */
export function saveScheduledTasks(snapshot: SchedulerSnapshot): void {
  const file = filePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload: ScheduledTasksFile = {
    version: FILE_VERSION,
    tasks: snapshot.tasks,
    runs: trimScheduledRuns(snapshot.runs),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
}
