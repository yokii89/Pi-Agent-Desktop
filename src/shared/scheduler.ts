/**
 * 定时任务共享契约（docs 30 §2.4 的 PiDesk 裁剪版调度器）。
 * 三档调度规则（每 N 分钟 / 每天 HH:mm（可选周几）/ 一次性时刻），零 cron 依赖；
 * 纯调度数学也放在这里，渲染层表单才能在保存前实时预览「下次运行时间」。
 * 调度器只负责「到点把 prompt 发进会话」，不追踪 agent 执行成败——
 * 执行结果在会话流里，运行台账只记录派发/跳过/失败到派发为止的事实。
 */

/** IPC channel 常量（AGENTS.md 命名 `pidesk:<域>:<动作>`）。 */
export const SCHEDULER_IPC = {
  /** 读取全量快照（任务 + 运行台账）。 */
  list: "pidesk:scheduler:list",
  /** 新建任务。 */
  create: "pidesk:scheduler:create",
  /** 更新任务（按 id 覆盖输入字段）。 */
  update: "pidesk:scheduler:update",
  /** 删除任务及其运行台账。 */
  remove: "pidesk:scheduler:remove",
  /** 启停任务。 */
  setEnabled: "pidesk:scheduler:setEnabled",
  /** 立即运行一次（manual 触发；上一轮未结束时按冲突跳过）。 */
  runNow: "pidesk:scheduler:runNow",
  /** 主进程推送：快照变化（任务增删改、运行台账更新）。 */
  changed: "pidesk:scheduler:changed",
} as const;

/** 调度规则；`daily.weekdays` 为 null 表示每天，否则为周几集合（0=周日，对齐 Date.getDay）。 */
export type ScheduleRule =
  | { kind: "interval"; minutes: number }
  | { kind: "daily"; time: string; weekdays: number[] | null }
  | { kind: "once"; at: number };

/** 定时任务（落盘与推送共用形态）。 */
export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  /** 触发时 pi 会话的工作目录（项目目录）。 */
  cwd: string;
  /** 绑定既有会话 JSONL 则续聊同一会话；null = 每次触发新建会话。 */
  sessionFile: string | null;
  rule: ScheduleRule;
  enabled: boolean;
  /** 下次计划触发时刻（Unix ms）；一次性任务触发/过期后为 null。 */
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  runCount: number;
  /** 冲突跳过 + 错过丢弃的累计次数（错过补跑的其余点数也计入）。 */
  skipCount: number;
}

export type ScheduledRunTrigger = "schedule" | "catch-up" | "manual";
export type ScheduledRunStatus = "dispatched" | "skipped" | "failed";
/** skipped 的原因：conflict=上一轮未结束；expired=一次性任务错过且超出宽限。 */
export type ScheduledSkipReason = "conflict" | "expired";

/** 单次运行台账。 */
export interface ScheduledRunRecord {
  id: string;
  taskId: string;
  trigger: ScheduledRunTrigger;
  status: ScheduledRunStatus;
  /** 计划触发时刻（Unix ms）；manual 时等于实际时刻。 */
  scheduledAt: number;
  /** 实际派发/判定时刻（Unix ms）。 */
  startedAt: number;
  /** 调度偏差 ms = startedAt - scheduledAt（30 §5「触发时刻偏差」口径）。 */
  deviationMs: number;
  /** catch-up 标注：应用未运行/睡眠期间错过的触发点数（含本次补跑的那个点）。 */
  missedCount?: number;
  skipReason?: ScheduledSkipReason;
  /** 派发目标运行时会话 id。 */
  sessionId?: string;
  /** 派发目标的会话 JSONL（新建会话时回填，供「打开会话」）。 */
  sessionFile?: string;
  /** agent 转入空闲的时刻（best-effort）；缺失 = 未知（进程退出/应用重启）。 */
  finishedAt?: number;
  error?: string;
}

/** 创建 / 更新任务的动作输入（nextRunAt 等由主进程推导）。 */
export interface SchedulerTaskInput {
  name: string;
  prompt: string;
  cwd: string;
  sessionFile?: string | null;
  rule: ScheduleRule;
  enabled?: boolean;
}

/** 全量快照（list 响应与 changed 推送共用）。 */
export interface SchedulerSnapshot {
  tasks: ScheduledTask[];
  runs: ScheduledRunRecord[];
}

/** runNow 的同步判定结果；派发结果异步回到台账，经 changed 推送。 */
export type RunNowOutcome =
  | { kind: "dispatching" }
  | { kind: "skipped"; reason: ScheduledSkipReason };

/** 应用未运行/睡眠期间错过的触发点：宽限内的照常补跑，超出则按错过处理。 */
export const SCHEDULER_MISFIRE_GRACE_MS = 5 * 60_000;
/** setTimeout 单次上限（2^31-1 ms ≈ 24.8 天）；更长延迟分片重臂。 */
export const SCHEDULER_MAX_TIMER_MS = 2_147_483_647;
/** 间隔规则的分钟数边界（1 分钟 ~ 7 天）。 */
export const SCHEDULER_INTERVAL_MIN_MINUTES = 1;
export const SCHEDULER_INTERVAL_MAX_MINUTES = 7 * 24 * 60;
/** 错过点计数展示上限（防间隔极小 + 长期停机时计数爆炸）。 */
export const SCHEDULER_MAX_MISSED_REPORT = 999;
/** 任务总数上限：调度器常驻主进程，无上限会被遗忘的任务拖住启动。 */
export const SCHEDULER_TASK_LIMIT = 50;
/** 运行台账容量：每任务 / 全局总量，超出时最旧的先淘汰。 */
export const SCHEDULER_RUNS_KEEP_PER_TASK = 50;
export const SCHEDULER_RUNS_KEEP_TOTAL = 300;
/** prompt 长度上限（与会话输入栏同数量级，防止误粘贴整本书）。 */
export const SCHEDULER_PROMPT_MAX_LENGTH = 20_000;

/** 解析 "HH:mm"（严格两位段，0≤h≤23、0≤m≤59）；非法返回 null。 */
export function parseHHMM(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** 格式化为 "HH:mm"。 */
export function formatHHMM(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** 是否为绝对路径（调度目标目录 / 会话文件的最低要求）。 */
export function isAbsolutePath(value: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(value);
}

/**
 * 计算规则在 afterMs 之后的下一次触发时刻（本地时区，严格大于 afterMs）。
 * interval 用任务创建时刻做锚点推进（对齐 ZCode 的 anchorAt 设计），
 * 避免墙钟对齐语义下的逐轮漂移；anchorAt 必须早于 afterMs。
 * 一次性任务已过期时返回 null。
 */
export function nextRunAfter(rule: ScheduleRule, afterMs: number, anchorAt: number): number | null {
  switch (rule.kind) {
    case "once":
      return rule.at > afterMs ? rule.at : null;
    case "interval": {
      const step = rule.minutes * 60_000;
      if (step <= 0) return null;
      // 锚点本身是首个计划点：after 早于锚点时钳回锚点，不向锚点之前倒推
      const k = Math.max(0, Math.ceil((afterMs + 1 - anchorAt) / step));
      return anchorAt + k * step;
    }
    case "daily": {
      const hm = parseHHMM(rule.time);
      if (!hm) return null;
      const weekdays = rule.weekdays;
      const start = new Date(afterMs);
      for (let i = 0; i < 8; i += 1) {
        const candidate = new Date(
          start.getFullYear(),
          start.getMonth(),
          start.getDate() + i,
          hm.hour,
          hm.minute,
          0,
          0,
        );
        if (candidate.getTime() <= afterMs) continue;
        if (weekdays && !weekdays.includes(candidate.getDay())) continue;
        return candidate.getTime();
      }
      return null;
    }
  }
}

/**
 * 统计 (fromMs, toMs) 区间内的计划触发点数——错过场景的「已错过 N 次」口径。
 * 迭代步进（interval 走公式跳变，daily 逐日），cap 兜底防病态区间。
 */
export function countMissedOccurrences(
  rule: ScheduleRule,
  fromMs: number,
  toMs: number,
  anchorAt: number,
  cap = SCHEDULER_MAX_MISSED_REPORT,
): number {
  if (toMs <= fromMs) return 0;
  let cursor = fromMs;
  let count = 0;
  while (count < cap) {
    const t = nextRunAfter(rule, cursor - 1, anchorAt);
    if (t === null || t >= toMs) break;
    count += 1;
    // 游标必须跨过命中点，否则 once / interval 在同一点上死循环到 cap
    cursor = t + 1;
  }
  return count;
}

/** 规则校验与归一；非法输入抛中文错误（主进程信封原样回传）。 */
export function normalizeScheduleRule(raw: unknown): ScheduleRule {
  if (!raw || typeof raw !== "object") throw new Error("调度规则无效");
  const record = raw as {
    kind?: unknown;
    minutes?: unknown;
    time?: unknown;
    weekdays?: unknown;
    at?: unknown;
  };
  switch (record.kind) {
    case "interval": {
      const minutes =
        typeof record.minutes === "number" && Number.isFinite(record.minutes)
          ? Math.floor(record.minutes)
          : NaN;
      // NaN 与任何数值比较均为 false，必须先挡掉，否则 minutes: NaN 能通过校验落库
      if (
        !Number.isFinite(minutes) ||
        minutes < SCHEDULER_INTERVAL_MIN_MINUTES ||
        minutes > SCHEDULER_INTERVAL_MAX_MINUTES
      ) {
        throw new Error(
          `间隔必须在 ${SCHEDULER_INTERVAL_MIN_MINUTES}~${SCHEDULER_INTERVAL_MAX_MINUTES} 分钟之间`,
        );
      }
      return { kind: "interval", minutes };
    }
    case "daily": {
      if (typeof record.time !== "string" || !parseHHMM(record.time)) {
        throw new Error("时间格式无效，应为 HH:mm");
      }
      let weekdays: number[] | null = null;
      if (Array.isArray(record.weekdays)) {
        const set = new Set<number>();
        for (const item of record.weekdays) {
          if (typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 6) {
            set.add(item);
          }
        }
        // 空数组 = 永不触发，等价于停用，直接拒绝避免做出一个「假启用」任务
        if (set.size === 0) throw new Error("请至少选择一个星期（或改回每天）");
        weekdays = [...set].sort((a, b) => a - b);
      }
      return { kind: "daily", time: parseHHMM(record.time) ? record.time : "09:00", weekdays };
    }
    case "once": {
      if (typeof record.at !== "number" || !Number.isFinite(record.at) || record.at <= 0) {
        throw new Error("一次性任务的时间无效");
      }
      return { kind: "once", at: Math.floor(record.at) };
    }
    default:
      throw new Error("调度规则无效");
  }
}

/** 创建/更新入参校验；返回裁剪后的合法输入。 */
export function sanitizeSchedulerTaskInput(raw: unknown): SchedulerTaskInput {
  if (!raw || typeof raw !== "object") throw new Error("参数不完整");
  const record = raw as {
    name?: unknown;
    prompt?: unknown;
    cwd?: unknown;
    sessionFile?: unknown;
    rule?: unknown;
    enabled?: unknown;
  };
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) throw new Error("请填写任务名称");
  if (name.length > 80) throw new Error("任务名称不能超过 80 字");
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (!prompt) throw new Error("请填写提示词");
  if (prompt.length > SCHEDULER_PROMPT_MAX_LENGTH) {
    throw new Error(`提示词不能超过 ${SCHEDULER_PROMPT_MAX_LENGTH} 字`);
  }
  const cwd = typeof record.cwd === "string" ? record.cwd.trim() : "";
  if (!cwd || !isAbsolutePath(cwd)) throw new Error("请选择有效的工作目录");
  let sessionFile: string | null = null;
  if (typeof record.sessionFile === "string" && record.sessionFile.trim()) {
    const file = record.sessionFile.trim();
    if (!isAbsolutePath(file)) throw new Error("会话文件路径无效");
    sessionFile = file;
  }
  const rule = normalizeScheduleRule(record.rule);
  // enabled 缺省时不兜底：编辑停用任务不得被隐式重新启用，默认值由调用方决定
  const out: SchedulerTaskInput = { name, prompt, cwd, sessionFile, rule };
  if (typeof record.enabled === "boolean") out.enabled = record.enabled;
  return out;
}

/** 任务 id 前缀（crypto.randomUUID 由主进程生成）。 */
export function isScheduledTaskId(value: unknown): value is string {
  return typeof value === "string" && /^task_[0-9a-f-]{36}$/.test(value);
}
