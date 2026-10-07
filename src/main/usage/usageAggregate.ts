import type { PiUsage } from "../../shared/ipc";
import {
  pickUsageGranularity,
  type UsageDaySlice,
  type UsageGranularity,
  type UsageModelSlice,
  type UsageProject,
  type UsageProjectDaySlice,
  type UsageProjectSlice,
  type UsageReport,
  type UsageTotals,
  usageBucketKey,
} from "../../shared/usage";

/**
 * 用量纯聚合（无 IO，可被 vitest 直接覆盖）：
 * 项目/时间过滤 → 时间分桶 → 模型与项目分组。IO 与缓存见 usageScanner.ts。
 */

/** 单条计入统计的 assistant 用量记录。 */
export interface UsageEntry {
  /** 消息时间（Unix ms）；磁盘缺失时回退文件 mtime。 */
  ts: number;
  usage: PiUsage;
  provider: string | null;
  model: string | null;
}

/** 单个会话文件扫描出的用量（聚合输入）。 */
export interface FileUsage {
  file: string;
  /** 项目归属（JSONL 头部 cwd，缺失时按会话目录名兜底），见 shared/usage resolveUsageProject。 */
  project: UsageProject;
  entries: UsageEntry[];
}

/** 聚合选项：granularity 覆盖分桶粒度（热力图固定 day）；project 按归属键过滤文件。 */
export interface AggregateUsageOptions {
  granularity?: UsageGranularity | null;
  project?: string | null;
}

interface BucketAcc {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
}

function emptyBucket(): BucketAcc {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: 0,
  };
}

function addEntry(bucket: BucketAcc, entry: UsageEntry): void {
  bucket.input += entry.usage.input;
  bucket.output += entry.usage.output;
  bucket.cacheRead += entry.usage.cacheRead;
  bucket.cacheWrite += entry.usage.cacheWrite;
  bucket.totalTokens += entry.usage.totalTokens;
  bucket.cost += entry.usage.cost?.total ?? 0;
}

/** 未知 provider/model 在明细表中的占位。 */
export const USAGE_UNKNOWN = "unknown";

/**
 * 文件级用量 → 报表。项目过滤发生在文件级（整个会话归属一个项目）；
 * 分桶粒度在过滤后一次确定（options.granularity 优先，否则 ≤90 天按天、
 * 超过按月），保证所有条目同口径；「全部」档的跨度从最早数据点起算。
 */
export function aggregateUsage(
  files: FileUsage[],
  since: number | null,
  nowMs: number,
  options: AggregateUsageOptions = {},
): UsageReport {
  const scoped =
    options.project == null ? files : files.filter((f) => f.project.key === options.project);

  // 第一遍：按 since 过滤消息级条目，并求最早时间点以确定桶粒度
  const filtered: FileUsage[] = [];
  let earliestTs = Number.POSITIVE_INFINITY;
  for (const file of scoped) {
    const entries = since === null ? file.entries : file.entries.filter((e) => e.ts >= since);
    if (entries.length === 0) continue;
    for (const entry of entries) {
      if (entry.ts < earliestTs) earliestTs = entry.ts;
    }
    filtered.push({ file: file.file, project: file.project, entries });
  }

  const granularity: UsageGranularity =
    options.granularity ??
    (since !== null
      ? pickUsageGranularity(since, nowMs)
      : Number.isFinite(earliestTs)
        ? pickUsageGranularity(earliestTs, nowMs)
        : "day");

  // 第二遍：固定粒度下聚合
  const totals: UsageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: 0,
    sessions: 0,
    assistantMessages: 0,
  };
  const dayBuckets = new Map<string, BucketAcc>();
  const dayFileSets = new Map<string, Set<string>>();
  interface ModelBucket extends BucketAcc {
    provider: string;
    modelId: string;
    sessions: number;
  }
  const modelBuckets = new Map<string, ModelBucket>();
  interface ProjectBucket extends BucketAcc {
    project: UsageProject;
    sessions: number;
  }
  const projectBuckets = new Map<string, ProjectBucket>();
  const projectDayBuckets = new Map<string, Map<string, BucketAcc>>();

  for (const file of filtered) {
    totals.sessions += 1;
    totals.assistantMessages += file.entries.length;
    let projectBucket = projectBuckets.get(file.project.key);
    if (!projectBucket) {
      projectBucket = { ...emptyBucket(), project: file.project, sessions: 0 };
      projectBuckets.set(file.project.key, projectBucket);
    }
    projectBucket.sessions += 1;
    const fileModels = new Set<string>();
    for (const entry of file.entries) {
      addEntry(totals, entry);
      addEntry(projectBucket, entry);

      const dayKey = usageBucketKey(entry.ts, granularity);
      const dayBucket = dayBuckets.get(dayKey) ?? emptyBucket();
      addEntry(dayBucket, entry);
      dayBuckets.set(dayKey, dayBucket);
      let dayFiles = dayFileSets.get(dayKey);
      if (!dayFiles) {
        dayFiles = new Set();
        dayFileSets.set(dayKey, dayFiles);
      }
      dayFiles.add(file.file);

      let perProject = projectDayBuckets.get(dayKey);
      if (!perProject) {
        perProject = new Map();
        projectDayBuckets.set(dayKey, perProject);
      }
      const projectDayBucket = perProject.get(file.project.key) ?? emptyBucket();
      addEntry(projectDayBucket, entry);
      perProject.set(file.project.key, projectDayBucket);

      const provider = entry.provider || USAGE_UNKNOWN;
      const modelId = entry.model || USAGE_UNKNOWN;
      const modelKey = `${provider}/${modelId}`;
      let modelBucket = modelBuckets.get(modelKey);
      if (!modelBucket) {
        modelBucket = { ...emptyBucket(), provider, modelId, sessions: 0 };
        modelBuckets.set(modelKey, modelBucket);
      }
      addEntry(modelBucket, entry);
      if (!fileModels.has(modelKey)) {
        fileModels.add(modelKey);
        modelBucket.sessions += 1;
      }
    }
  }

  const byDay: UsageDaySlice[] = [...dayBuckets.entries()]
    .map(([key, bucket]) => ({
      key,
      ...bucket,
      sessions: dayFileSets.get(key)?.size ?? 0,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const byProject: UsageProjectSlice[] = [...projectBuckets.values()]
    .map((bucket) => ({
      key: bucket.project.key,
      cwd: bucket.project.cwd,
      name: bucket.project.name,
      input: bucket.input,
      output: bucket.output,
      cacheRead: bucket.cacheRead,
      cacheWrite: bucket.cacheWrite,
      totalTokens: bucket.totalTokens,
      cost: bucket.cost,
      sessions: bucket.sessions,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
  const byProjectDay: UsageProjectDaySlice[] = [...projectDayBuckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .flatMap(([key, perProject]) =>
      [...perProject.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([project, bucket]) => ({ project, key, ...bucket })),
    );
  const byModel: UsageModelSlice[] = [...modelBuckets.values()]
    .map((bucket) => ({
      provider: bucket.provider,
      modelId: bucket.modelId,
      input: bucket.input,
      output: bucket.output,
      cacheRead: bucket.cacheRead,
      cacheWrite: bucket.cacheWrite,
      totalTokens: bucket.totalTokens,
      cost: bucket.cost,
      sessions: bucket.sessions,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    generatedAt: nowMs,
    since,
    granularity,
    totals,
    byDay,
    byProject,
    byProjectDay,
    byModel,
  };
}
