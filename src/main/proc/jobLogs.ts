/**
 * pi-bash-jobs 作业日志定位（方案 B）。
 *
 * 扩展把每个作业的 stdout（stripAnsi 后）tee 到
 * `<agentDir>/bash-jobs/logs/<piSessionId>/<jobId>.log`；PiDesk 主进程不知道 pi 的
 * sessionId / jobId，但扩展的作业快照 `<agentDir>/bash-jobs/<piSessionId>.json`
 * 存了每条作业的 pid——按 pid 精确匹配反查即可（快照文件名给出 piSessionId，
 * record.id 给出 jobId），不需要扩展改任何协议。
 *
 * 目录公式与扩展 `packages/pi-bash-jobs/paths.ts` 的 `jobLogPath` 是同一份契约，两边不得单动。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ManagedProcess } from "../../shared/ipc";
import { getPiAgentDir } from "../session/piInfo";

/** 快照里一条作业记录的最小切面（persist.ts 的 PersistedJob.record）。 */
export interface JobSnapshotRecord {
  id: string;
  pid?: number;
  status?: string;
  startedAt?: number;
}

export interface ParsedSnapshot {
  /** pi 的 sessionId（快照文件名去 .json）。 */
  sessionId: string;
  jobs: JobSnapshotRecord[];
}

/** 解析一份作业快照；坏 JSON / 缺 jobs / 记录缺 id 返回剔除后的结果（可单测）。 */
export function parseSnapshotFile(text: string, sessionId: string): ParsedSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const rawJobs = (parsed as { jobs?: unknown }).jobs;
  if (!Array.isArray(rawJobs)) return null;
  const jobs: JobSnapshotRecord[] = [];
  for (const item of rawJobs) {
    if (typeof item !== "object" || item === null) continue;
    const record = (item as { record?: unknown }).record;
    if (typeof record !== "object" || record === null) continue;
    const r = record as Record<string, unknown>;
    if (typeof r.id !== "string" || r.id.length === 0) continue;
    jobs.push({
      id: r.id,
      pid: Number(r.pid) > 0 ? Number(r.pid) : undefined,
      status: typeof r.status === "string" ? r.status : undefined,
      startedAt: Number(r.startedAt) > 0 ? Number(r.startedAt) : undefined,
    });
  }
  return { sessionId, jobs };
}

/**
 * pid 匹配：只认 running / orphaned——已结束作业的日志文件虽然还在（可打开），
 * 但「跟随」没有意义；同 pid 出现在多条记录（极端复用）取 startedAt 最新的。
 */
export function matchJobByPid(
  snapshots: readonly ParsedSnapshot[],
  pid: number,
): { sessionId: string; jobId: string } | null {
  let best: { sessionId: string; jobId: string; startedAt: number } | null = null;
  for (const snapshot of snapshots) {
    for (const job of snapshot.jobs) {
      if (job.pid !== pid) continue;
      if (job.status !== "running" && job.status !== "orphaned") continue;
      const startedAt = job.startedAt ?? 0;
      if (!best || startedAt > best.startedAt) {
        best = { sessionId: snapshot.sessionId, jobId: job.id, startedAt };
      }
    }
  }
  return best ? { sessionId: best.sessionId, jobId: best.jobId } : null;
}

/** 按扩展 paths.ts 同一公式推日志路径（目录布局是两侧共享的契约）。 */
export function jobLogPathFor(agentDir: string, sessionId: string, jobId: string): string {
  return join(agentDir, "bash-jobs", "logs", sessionId, `${jobId}.log`);
}

function loadSnapshots(dir: string): ParsedSnapshot[] {
  const snapshots: ParsedSnapshot[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return snapshots;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const text = readFileSync(join(dir, name), "utf8");
      const parsed = parseSnapshotFile(text, name.slice(0, -".json".length));
      if (parsed) snapshots.push(parsed);
    } catch {
      // 单个快照读失败跳过，不影响其余作业
    }
  }
  return snapshots;
}

/** 快照缓存：详情 3s 轮询 + tail 300ms tick 都走这里，避免每次读盘。 */
let cache: { at: number; snapshots: ParsedSnapshot[] } | null = null;
const SNAPSHOT_CACHE_MS = 2_000;

export interface JobLogInfo {
  path: string;
  /** 作业是否仍在 running / orphaned（跟随是否还有意义）。 */
  live: boolean;
}

/**
 * 反查登记项对应的作业日志。找不到匹配、日志文件尚不存在时返回 null。
 * 所有 IO 失败都降级为 null——作业日志是增强信息，不能影响详情本身。
 */
export function resolveJobInfo(
  proc: ManagedProcess,
  agentDir = getPiAgentDir(),
): JobLogInfo | null {
  try {
    const now = Date.now();
    if (!cache || now - cache.at > SNAPSHOT_CACHE_MS) {
      cache = { at: now, snapshots: loadSnapshots(join(agentDir, "bash-jobs")) };
    }
    const match = matchJobByPid(cache.snapshots, proc.pid);
    if (!match) return null;
    const path = jobLogPathFor(agentDir, match.sessionId, match.jobId);
    if (!existsSync(path)) return null;
    const job = cache.snapshots
      .find((snapshot) => snapshot.sessionId === match.sessionId)
      ?.jobs.find((item) => item.id === match.jobId);
    return { path, live: job?.status === "running" || job?.status === "orphaned" };
  } catch {
    return null;
  }
}

/** 测试钩子：清空快照缓存。 */
export function resetJobLogCache(): void {
  cache = null;
}
