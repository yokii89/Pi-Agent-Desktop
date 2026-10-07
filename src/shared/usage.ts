/**
 * 用量统计共享契约（设置页「用量统计」面板）。
 * 数据源是 pi 原生会话 JSONL 的 assistant 消息 usage（PiDesk 不自建会话存储），
 * 主进程扫描聚合后返回结构化报表，渲染层只消费结果。
 * 口径：只累计 assistant 消息 usage；磁盘上独立的 type:"usage" 条目（工具内嵌
 * LLM 用量）不计入；成本独立求和，全 0 / 缺失由显示层降级为「—」。
 * 项目维度按会话文件的 cwd 归属（JSONL 头部，pi v3+）；「全部」档的热力图
 * 用 granularity:"day" 覆盖取全年按天分桶，色阶口径为当日 output。
 */

import type { PiUsage } from "./ipc";

/** IPC channel 常量（AGENTS.md 命名 `pidesk:<域>:<动作>`）。 */
export const USAGE_IPC = {
  /** 查询用量报表（扫描 ~/.pi/agent/sessions 聚合）。 */
  query: "pidesk:usage:query",
} as const;

/** 查询入参。 */
export interface UsageQuery {
  /** 只统计该时刻（Unix ms）之后的 assistant 消息；null/缺省 = 全部历史。 */
  since?: number | null;
  /**
   * 只统计归属键匹配的项目（见 resolveUsageProject）；null/缺省 = 全部项目。
   * 过滤发生在文件级：整个会话文件（即整段会话）归属一个项目。
   */
  project?: string | null;
  /** 桶粒度覆盖；null/缺省按跨度自动（≤90 天按天，否则按月）。年度热力图固定传 "day"。 */
  granularity?: UsageGranularity | null;
}

/** token 分项合计（字段名对齐 pi usage）。 */
export interface UsageTokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

/** 报表总量。 */
export interface UsageTotals extends UsageTokenTotals {
  /** 成本合计；provider 未上报 cost 的消息按 0 计。 */
  cost: number;
  /** 有用量消息的会话文件数。 */
  sessions: number;
  /** 计入统计的 assistant 消息数。 */
  assistantMessages: number;
}

/** 单个时间桶的用量。 */
export interface UsageDaySlice extends UsageTokenTotals {
  /**
   * 桶键：粒度为 day 时 `YYYY-MM-DD`，month 时 `YYYY-MM`（均按本地时区）。
   * 主进程只返回有数据的桶，空缺桶由图表层补零。
   */
  key: string;
  cost: number;
  /** 该桶内有用量消息的会话文件数（同一会话跨天会在多个桶各计一次）。 */
  sessions: number;
}

/** 项目归属（会话文件 → 项目）。 */
export interface UsageProject {
  /** 归属键：cwd 原文；cwd 缺失时为 `dir:<会话目录名>` 兜底。 */
  key: string;
  /** 会话工作目录（JSONL 头部，pi v3+ 携带）；旧文件缺失时为 null。 */
  cwd: string | null;
  /** 展示名：cwd 取路径末段；兜底为去掉 `--` 包装的会话目录名。 */
  name: string;
}

/**
 * 解析会话的项目归属。cwd 以 JSONL 头部为准——pi 的会话目录名反解有歧义
 * （路径分隔符与路径里的连字符都被编码为 `-`）；旧文件缺失 cwd 时退回
 * 按会话目录名分组，展示名去掉首尾的 `--` 包装。
 */
export function resolveUsageProject(cwd: unknown, dirName: string): UsageProject {
  if (typeof cwd === "string" && cwd.length > 0) {
    const segments = cwd.split(/[\\/]+/).filter(Boolean);
    return { key: cwd, cwd, name: segments[segments.length - 1] ?? cwd };
  }
  const stripped = dirName.replace(/^--/, "").replace(/--$/, "");
  return { key: `dir:${dirName}`, cwd: null, name: stripped.length > 0 ? stripped : dirName };
}

/** 单个项目的用量（按会话 cwd 归属）。 */
export interface UsageProjectSlice extends UsageTokenTotals {
  key: string;
  cwd: string | null;
  name: string;
  cost: number;
  /** 该项目计入统计的会话文件数。 */
  sessions: number;
}

/** 单个项目单桶的用量（项目 × 时间桶交叉，仅含有数据的组合；粒度同 byDay）。 */
export interface UsageProjectDaySlice extends UsageTokenTotals {
  /** 项目归属键（UsageProject.key）。 */
  project: string;
  /** 桶键，口径同 UsageDaySlice.key。 */
  key: string;
  cost: number;
}

/** 单个 provider/model 的用量。 */
export interface UsageModelSlice extends UsageTokenTotals {
  provider: string;
  modelId: string;
  cost: number;
  /** 该模型出现过的会话文件数。 */
  sessions: number;
}

/** 用量报表（query 响应）。 */
export interface UsageReport {
  generatedAt: number;
  /** 查询起点（Unix ms）；null = 全部历史。 */
  since: number | null;
  /** byDay 桶的实际粒度（渲染层补零桶与横轴标签都要用）。 */
  granularity: UsageGranularity;
  totals: UsageTotals;
  /** 按桶键升序；仅含有数据的桶。 */
  byDay: UsageDaySlice[];
  /** 按 totalTokens 降序。 */
  byProject: UsageProjectSlice[];
  /** 项目 × 桶交叉用量（按桶键、项目键升序）；仅含有数据的组合。 */
  byProjectDay: UsageProjectDaySlice[];
  /** 按 totalTokens 降序。 */
  byModel: UsageModelSlice[];
}

// ---------------------------------------------------------------------------
// 纯函数（主进程聚合与渲染层 run 累加共用，便于 vitest 覆盖）
// ---------------------------------------------------------------------------

/** 时间桶粒度：跨度短按天，超过阈值按月，避免「全部」档柱状条过密。 */
export type UsageGranularity = "day" | "month";

/** 按天展示的最大跨度（天）；超过后聚合粒度降为月。 */
export const USAGE_MONTHLY_AFTER_DAYS = 90;

/** 依据时间跨度选择桶粒度。 */
export function pickUsageGranularity(sinceMs: number, untilMs: number): UsageGranularity {
  return untilMs - sinceMs > USAGE_MONTHLY_AFTER_DAYS * 86_400_000 ? "month" : "day";
}

/** 时间戳 → 桶键（本地时区；day=`YYYY-MM-DD`，month=`YYYY-MM`）。 */
export function usageBucketKey(ms: number, granularity: UsageGranularity): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  if (granularity === "month") return `${d.getFullYear()}-${mm}`;
  return `${d.getFullYear()}-${mm}-${String(d.getDate()).padStart(2, "0")}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 累加两份 usage（run 内多次 assistant 调用求和、扫描聚合共用）。
 * totalTokens 优先取两侧上报值之和（与 run 头徽标口径一致）；
 * 任一侧带 cost 时按字段求和。两份都为空时返回 null。
 */
export function addPiUsage(
  a: PiUsage | null | undefined,
  b: PiUsage | null | undefined,
): PiUsage | null {
  if (!a && !b) return null;
  const num = (value: unknown): number => (isFiniteNumber(value) ? value : 0);
  const result: PiUsage = {
    input: num(a?.input) + num(b?.input),
    output: num(a?.output) + num(b?.output),
    cacheRead: num(a?.cacheRead) + num(b?.cacheRead),
    cacheWrite: num(a?.cacheWrite) + num(b?.cacheWrite),
    totalTokens: num(a?.totalTokens) + num(b?.totalTokens),
  };
  // totalTokens 缺失/非法时退回分项和，保证显示总量与分项自洽
  if (result.totalTokens === 0) {
    result.totalTokens = result.input + result.output + result.cacheRead + result.cacheWrite;
  }
  if (a?.cost || b?.cost) {
    result.cost = {
      input: num(a?.cost?.input) + num(b?.cost?.input),
      output: num(a?.cost?.output) + num(b?.cost?.output),
      cacheRead: num(a?.cost?.cacheRead) + num(b?.cost?.cacheRead),
      cacheWrite: num(a?.cost?.cacheWrite) + num(b?.cost?.cacheWrite),
      total: num(a?.cost?.total) + num(b?.cost?.total),
    };
  }
  return result;
}

/** usage 全字段是否为 0（全 0 的 aborted/失败消息不值得写入 run 头）。 */
export function isZeroPiUsage(usage: PiUsage): boolean {
  return (
    usage.input === 0 &&
    usage.output === 0 &&
    usage.cacheRead === 0 &&
    usage.cacheWrite === 0 &&
    usage.totalTokens === 0
  );
}

/**
 * 宽松校验并归一磁盘 JSONL / RPC 事件里的 usage 对象；结构不符返回 null。
 * totalTokens 缺失时退回分项和；cost 结构不符时整体丢弃。
 */
export function sanitizePiUsage(raw: unknown): PiUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const num = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const input = num(record.input);
  const output = num(record.output);
  const cacheRead = num(record.cacheRead);
  const cacheWrite = num(record.cacheWrite);
  const totalTokens = num(record.totalTokens);
  if (
    input === undefined &&
    output === undefined &&
    cacheRead === undefined &&
    cacheWrite === undefined &&
    totalTokens === undefined
  ) {
    return null;
  }
  const usage: PiUsage = {
    input: input ?? 0,
    output: output ?? 0,
    cacheRead: cacheRead ?? 0,
    cacheWrite: cacheWrite ?? 0,
    totalTokens: totalTokens ?? (input ?? 0) + (output ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0),
  };
  const cost = record.cost;
  if (typeof cost === "object" && cost !== null) {
    const c = cost as Record<string, unknown>;
    usage.cost = {
      input: num(c.input) ?? 0,
      output: num(c.output) ?? 0,
      cacheRead: num(c.cacheRead) ?? 0,
      cacheWrite: num(c.cacheWrite) ?? 0,
      total: num(c.total) ?? 0,
    };
  }
  return usage;
}

// ---------------------------------------------------------------------------
// 热力图色阶（设置页「全部」档年度热力图；纯函数便于 vitest 覆盖）
// ---------------------------------------------------------------------------

/** 色阶阈值：当日 output 与三档分界的比较结果即 1..4 档。 */
export interface UsageHeatScale {
  thresholds: [number, number, number];
}

/**
 * 依据窗口内「活跃日 output 值」计算色阶阈值。≥4 个样本按四分位——token
 * 分布重尾，线性分桶会让全部活跃日挤在同一档；样本不足退化为按最大值线性
 * 四等分。无活跃日返回 null（整图为空档）。
 */
export function computeUsageHeatScale(values: number[]): UsageHeatScale | null {
  const active = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (active.length === 0) return null;
  if (active.length < 4) {
    const max = active[active.length - 1];
    return { thresholds: [max / 4, max / 2, (max * 3) / 4] };
  }
  const quantile = (p: number): number => {
    const index = p * (active.length - 1);
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    return active[lo] + (active[hi] - active[lo]) * (index - lo);
  };
  return { thresholds: [quantile(0.25), quantile(0.5), quantile(0.75)] };
}

/** 值 → 色阶档位：0 = 无用量（空格），1..4 = 强度递增。 */
export function usageHeatLevel(scale: UsageHeatScale | null, value: number): 0 | 1 | 2 | 3 | 4 {
  if (scale === null || !Number.isFinite(value) || value <= 0) return 0;
  if (value <= scale.thresholds[0]) return 1;
  if (value <= scale.thresholds[1]) return 2;
  if (value <= scale.thresholds[2]) return 3;
  return 4;
}
