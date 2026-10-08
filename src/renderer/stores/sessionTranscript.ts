import { t } from "../../shared/i18n";
import type { PiAgentEvent, PiChatMessage, PiStreamDelta, PiUsage } from "../../shared/ipc";
import { addPiUsage, isZeroPiUsage } from "../../shared/usage";
import type { BrowserContextItem } from "../services/browserService";
import { imagesFromMessageContent, type UserMessageImage } from "../utils/imageAttach";
import {
  actionLabel,
  buildToolResult,
  classifyTool,
  parseToolArgs,
  type ToolKind,
  type ToolResultPayload,
  type ToolStatus,
} from "./toolPayload";

/**
 * 会话条目渲染模型（AGENTS.md「中央会话区规范」+ docs/中间栏对话流设计）：
 * 用户消息气泡、AI 文档流、run 边界与结构化工具块。
 * 纯函数 reducer：把 pi RPC 事件流组装成可渲染条目。
 */

export type RunStatus = "running" | "completed" | "failed" | "interrupted";

/** 一次自动重试的瞬时状态（auto_retry_start → end）。 */
export interface RunRetryInfo {
  attempt: number;
  maxAttempts: number;
  errorMessage: string | null;
}

/** 一次 agent run 的边界头（AgentRunHeader）。 */
export interface RunEntry {
  kind: "run";
  id: string;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  /** 当前是否在自动重试；null 表示未在重试。 */
  retry: RunRetryInfo | null;
  /** 本轮累计完成的重试次数（结束后保留，供失败态展示）。 */
  retryCount: number;
  /** 历史装载合成的 run（无精确起止事件），UI 不显示停止/重试。 */
  synthetic?: boolean;
  /** 本轮各次 assistant 调用 usage 的累加和（message_end 权威值求和）。 */
  usage: PiUsage | null;
  /** 本轮最近一次助手结束原因；agent_end 据此判定 failed / interrupted。 */
  lastStopReason: AssistantStopReason | null;
  /** 本轮最近一次错误原文（重试中间态先不落卡，最终失败时据此补一张）。 */
  lastErrorMessage: string | null;
  /** 本轮流内错误卡条目 id（同轮只保留最新一条，避免重试刷屏）。 */
  errorEntryId: string | null;
}

/** assistant 消息结束原因（pi stopReason 子集）。 */
export type AssistantStopReason = "error" | "aborted" | "length" | "stop" | "toolUse";

/** 流内轻量提示（compaction 等），不打断文档流节奏。 */
export interface NoticeEntry {
  kind: "notice";
  id: string;
  text: string;
  at: number;
  /** 稳定文案 key；渲染层可随语言重译。 */
  textKey?: string;
  /** 「进行中」提示（compaction 等）：结束后按此标记替换，不靠文案后缀匹配。 */
  pending?: boolean;
}

/**
 * 流内错误卡：LLM 调用失败 / 进程异常 / 压缩失败。
 * 文档流中的醒目块，不是气泡；与 notice 区分以获得 danger 视觉权重。
 */
export interface ErrorEntry {
  kind: "error";
  id: string;
  /** 短标题，如「模型调用失败」。 */
  title: string;
  /** 稳定错误 kind（如 `llm` / `process`）：重试清理按它匹配，不依赖已翻译标题。 */
  errorKey?: string;
  /** 完整错误原文（可复制）。 */
  message: string;
  at: number;
}

export interface UserEntry {
  kind: "user";
  id: string;
  text: string;
  /** 随消息发送的浏览器上下文条目（docs/design/05 P0-3：芯片嵌在用户气泡内）。 */
  items?: BrowserContextItem[];
  /** 随消息发送的图片附件（docs/design/21）；与 text 分槽，不进路径附注。 */
  images?: UserMessageImage[];
}

export interface ToolAssistantBlock {
  kind: "tool";
  toolCallId: string;
  name: string;
  toolKind: ToolKind;
  /** 行内动作标题：运行 / 已读取 / 已修改… */
  action: string;
  /** 行内扫读主体（命令 / 路径 / 查询词）。 */
  subject: string;
  /** 原始参数文本（兜底展开用）。 */
  argsText: string;
  /** 结构化参数（已解析）。 */
  args: unknown;
  status: ToolStatus;
  /** 结构化结果载荷；未结束或无法解析时为 null。 */
  result: ToolResultPayload | null;
  /** 原始结果文本（兜底展示）。 */
  resultText: string | null;
  startedAt: number | null;
  endedAt: number | null;
  /** 在 assistant content 数组中的槽位（并行工具与 message_end 对账用）。 */
  contentIndex: number;
}

export type AssistantBlock =
  | { kind: "text"; text: string; streaming?: boolean; contentIndex: number }
  | { kind: "thinking"; text: string; streaming?: boolean; contentIndex: number }
  | ToolAssistantBlock;

/** "刷新并截图"验证快照（docs/design/05 P1-3：截图以卡片回到会话流）。 */
export interface SnapshotEntry {
  kind: "snapshot";
  id: string;
  image: string;
  url: string;
  at: number;
}

/** 汇总卡中单个文件的增删行数。 */
export interface EditsFileStat {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * 本轮文件编辑汇总卡：run 收口时由成功的 edit/write 工具结果聚合，
 * 出现在该轮文档流末尾（历史装载同样生成，保证恢复会话可回看）。
 */
export interface EditsSummaryEntry {
  kind: "editsSummary";
  id: string;
  files: EditsFileStat[];
  totalAdditions: number;
  totalDeletions: number;
  at: number;
}

export type SessionEntry =
  | UserEntry
  | SnapshotEntry
  | RunEntry
  | NoticeEntry
  | ErrorEntry
  | EditsSummaryEntry
  | { kind: "assistant"; id: string; blocks: AssistantBlock[] };

export type SessionAction =
  | { type: "clear" }
  | { type: "userMessage"; text: string; items?: BrowserContextItem[]; images?: UserMessageImage[] }
  | { type: "snapshot"; image: string; url: string }
  | { type: "event"; event: PiAgentEvent }
  /** 主进程合批后的流式事件：一次 action 顺序应用，只触发一次 setState。 */
  | { type: "events"; events: PiAgentEvent[] }
  | { type: "userStop" }
  /** 进程级错误（stderr / spawn 失败 / prompt 拒绝）入流展示。 */
  | { type: "processError"; message: string; title?: string }
  | {
      type: "loadMessages";
      messages: PiChatMessage[];
      /** 会话文件起始时间，用于合成 run 头的 startedAt 兜底。 */
      sessionStartedAt?: number;
    };

let uidCounter = 0;

function uid(): string {
  uidCounter += 1;
  return `entry-${uidCounter}`;
}

/** 会话条目 reducer：事件驱动组装 + 历史消息装载。 */
export function sessionEntriesReducer(
  state: SessionEntry[],
  action: SessionAction,
): SessionEntry[] {
  switch (action.type) {
    case "clear":
      return [];
    case "userMessage":
      return [
        ...state,
        {
          kind: "user",
          id: uid(),
          text: action.text,
          items: action.items,
          images: action.images,
        },
      ];
    case "snapshot":
      return [
        ...state,
        {
          kind: "snapshot",
          id: uid(),
          image: `data:image/png;base64,${action.image}`,
          url: action.url,
          at: Date.now(),
        },
      ];
    case "loadMessages":
      return entriesFromMessages(action.messages, action.sessionStartedAt);
    case "userStop":
      return markInterrupted(state);
    case "processError":
      return appendProcessError(state, action.message, action.title);
    case "event":
      return applyEvent(state, action.event);
    case "events": {
      let next = state;
      for (const event of action.events) {
        next = applyEvent(next, event);
      }
      return next;
    }
  }
}

// ---------------------------------------------------------------------------
// 事件组装
// ---------------------------------------------------------------------------

function applyEvent(entries: SessionEntry[], event: PiAgentEvent): SessionEntry[] {
  switch (event.type) {
    case "agent_start":
      return openRun(entries);
    case "agent_end":
      // willRetry=true：pi 还会自动重试/续跑，run 不应收口；
      // 中间失败不落错误卡（由后续 attempt 或最终 auto_retry_end 收口）
      if (event.willRetry === true) return removeTurnErrors(entries, "llm");
      return finalizeRun(entries, statusFromLastError(entries));
    case "agent_settled":
      return finalizeRun(entries, statusFromLastError(entries));
    case "message_start":
      // 用户角色消息由渲染层发送时乐观插入，忽略 pi 的回显，避免重复
      if (event.message.role !== "assistant") return entries;
      return [
        ...entries,
        { kind: "assistant", id: uid(), blocks: blocksFromContent(event.message.content, null) },
      ];
    case "message_update":
      return applyDelta(entries, event.assistantMessageEvent);
    case "message_end":
      if (event.message.role !== "assistant") return entries;
      // usage 累加放在 message_end（权威终值）：流式 partial 的 usage 会重复计入
      return accumulateRunUsage(applyMessageEnd(entries, event.message), event.message.usage);
    case "tool_execution_start":
      return upsertToolBlock(
        entries,
        event.toolCallId,
        event.toolName || "tool",
        event.args,
        (block) => ({
          ...block,
          name: event.toolName || block.name,
          toolKind: classifyTool(event.toolName || block.name),
          action: actionLabel(classifyTool(event.toolName || block.name)),
          status: "running",
          startedAt: block.startedAt ?? Date.now(),
          endedAt: null,
        }),
      );
    case "tool_execution_update":
      return upsertToolBlock(entries, event.toolCallId, "tool", undefined, (block) => {
        if (!event.partialResult) return block;
        const result = buildToolResult(block.toolKind, block.args, event.partialResult, false);
        const rawText =
          result.kind === "terminal"
            ? result.output
            : result.kind === "generic"
              ? result.resultText
              : null;
        return {
          ...block,
          result,
          resultText: capRawResultText(rawText ?? block.resultText),
        };
      });
    case "tool_execution_end":
      return upsertToolBlock(
        entries,
        event.toolCallId,
        event.toolName || "tool",
        undefined,
        (block) => {
          const name = event.toolName || block.name;
          const kind = classifyTool(name);
          const result = buildToolResult(kind, block.args, event.result, Boolean(event.isError));
          const rawText =
            result.kind === "terminal"
              ? result.output
              : result.kind === "generic"
                ? result.resultText
                : null;
          return {
            ...block,
            name,
            toolKind: kind,
            action: actionLabel(kind),
            status: event.isError ? "error" : "ok",
            result,
            resultText: capRawResultText(rawText ?? block.resultText),
            endedAt: Date.now(),
          };
        },
      );
    case "auto_retry_start":
      // 进入自动重试：清掉本 attempt 刚落下的失败卡，头栏改显「自动重试 n/m」
      return applyRetryStart(removeTurnErrors(entries, "llm"), event);
    case "auto_retry_end":
      return applyRetryEnd(entries, event);
    case "compaction_start":
      return [
        ...entries,
        {
          kind: "notice",
          id: uid(),
          pending: true,
          text: `${compactionLabel(event.reason)}${t("session.compact.runningSuffix")}`,
          at: Date.now(),
        },
      ];
    case "compaction_end":
      return appendCompactionEnd(entries, event);
    default:
      return entries;
  }
}

/** 根据本轮最近 stopReason 决定 run 终态：error→failed，aborted→interrupted，其余 completed。 */
function statusFromLastError(entries: SessionEntry[]): RunStatus {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind !== "run") continue;
    if (entry.lastStopReason === "error") return "failed";
    if (entry.lastStopReason === "aborted") return "interrupted";
    return "completed";
  }
  return "completed";
}

/** 把最新错误写入本轮 running run 的 lastStopReason（供 agent_end 判定终态）。 */
function recordStopReason(
  entries: SessionEntry[],
  stopReason: AssistantStopReason,
  errorMessage?: string,
): SessionEntry[] {
  const next = [...entries];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const entry = next[i];
    if (entry.kind === "run" && entry.status === "running") {
      next[i] = {
        ...entry,
        lastStopReason: stopReason,
        lastErrorMessage: errorMessage !== undefined ? errorMessage : entry.lastErrorMessage,
      };
      return next;
    }
    if (entry.kind === "run") break;
  }
  return next;
}

/** 当前用户轮的起始下标（最后一条 user 之后；无则 0）。 */
function findTurnStart(entries: SessionEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].kind === "user") return i + 1;
  }
  return 0;
}

/**
 * 当前用户轮终态失败时，唯一「重试」按钮的落点 entry id。
 * 自动重试会跨多个 run（agent_start 重开）留下一串失败头，中间 attempt 不带按钮；
 * 终态有错误卡时按钮挂在错误卡上，否则挂在最后一个 failed/interrupted run 头。
 * 成功轮次返回 null（历史错误卡也不再挂重试）。
 */
export function findRetrySurfaceId(entries: SessionEntry[]): string | null {
  const turnStart = findTurnStart(entries);
  let lastFailedRunId: string | null = null;
  let lastErrorId: string | null = null;
  let lastRunStatus: RunStatus | null = null;
  for (let i = turnStart; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.kind === "run") {
      lastRunStatus = entry.status;
      if (!entry.synthetic && (entry.status === "failed" || entry.status === "interrupted")) {
        lastFailedRunId = entry.id;
      }
    } else if (entry.kind === "error") {
      lastErrorId = entry.id;
    }
  }
  if (lastRunStatus !== "failed" && lastRunStatus !== "interrupted") return null;
  return lastErrorId ?? lastFailedRunId;
}

/**
 * 追加（或原地替换）当前用户轮内的错误卡：同轮同 errorKey 只保留最新一条。
 * 自动重试可能跨多个 run（agent_start 重开），不能只靠 run.errorEntryId，
 * 否则每次重开 run 都会再插一张，把流刷成一叠错误。
 */
function upsertRunErrorCard(
  entries: SessionEntry[],
  title: string,
  message: string,
  errorKey = "llm",
): SessionEntry[] {
  const next = [...entries];
  const turnStart = findTurnStart(next);
  let runIndex = -1;
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i].kind === "run") {
      runIndex = i;
      break;
    }
  }
  const run = runIndex >= 0 ? (next[runIndex] as RunEntry) : null;

  // 优先原地替换 run 已登记的错误卡（仍须在当前用户轮内）
  if (run?.errorEntryId) {
    const errIndex = next.findIndex((e) => e.id === run.errorEntryId && e.kind === "error");
    if (errIndex >= turnStart) {
      next[errIndex] = {
        kind: "error",
        id: run.errorEntryId,
        errorKey,
        title,
        message,
        at: Date.now(),
      };
      return next;
    }
  }

  // 同轮同 kind 已存在（跨 run 重试）→ 原地刷新，不叠新卡
  for (let i = next.length - 1; i >= turnStart; i -= 1) {
    const entry = next[i];
    if (entry.kind === "error" && (entry.errorKey ?? "llm") === errorKey) {
      next[i] = { ...entry, title, message, at: Date.now() };
      if (runIndex >= 0) {
        next[runIndex] = { ...(next[runIndex] as RunEntry), errorEntryId: entry.id };
      }
      return next;
    }
  }

  const errorId = uid();
  next.push({ kind: "error", id: errorId, errorKey, title, message, at: Date.now() });
  if (runIndex >= 0) {
    next[runIndex] = { ...(next[runIndex] as RunEntry), errorEntryId: errorId };
  }
  return next;
}

/** 清除当前用户轮内指定错误 kind 的错误卡（自动重试成功后撤掉中间失败态）。 */
function removeTurnErrors(entries: SessionEntry[], errorKey: string): SessionEntry[] {
  const turnStart = findTurnStart(entries);
  let removed = false;
  const next = entries.filter((entry, i) => {
    if (i < turnStart || entry.kind !== "error" || entry.errorKey !== errorKey) return true;
    removed = true;
    return false;
  });
  if (!removed) return entries;
  return next.map((entry) => {
    if (entry.kind !== "run" || entry.errorEntryId === null) return entry;
    const stillThere = next.some((e) => e.id === entry.errorEntryId && e.kind === "error");
    return stillThere ? entry : { ...entry, errorEntryId: null };
  });
}

/** 进程 stderr / spawn 失败 / prompt 拒绝：相邻重复只保留一条，避免刷屏。 */
function appendProcessError(
  entries: SessionEntry[],
  message: string,
  title = t("session.error.processTitle"),
): SessionEntry[] {
  const text = message.trim();
  if (!text) return entries;
  const last = entries.at(-1);
  if (last?.kind === "error" && last.errorKey === "process" && last.message === text) {
    return entries;
  }
  return [
    ...entries,
    {
      kind: "error",
      id: uid(),
      errorKey: "process",
      title,
      message: text,
      at: Date.now(),
    },
  ];
}

/**
 * abort 类错误文案（AbortError 标准文案 + pi 的裸 abort / 重试取消文案）。
 * pi 收到 abort 后，agent 循环会用已 abort 的信号再发起一次模型调用，失败以
 * stop=error + 该文案落盘/广播（JSONL 实证）——这是用户中断的痕迹，不是模型故障。
 */
const ABORT_ERROR_MESSAGES = new Set([
  "this operation was aborted",
  "the operation was aborted",
  "request was aborted",
  "operation aborted",
  "retry cancelled",
  "已中断",
  t("session.error.aborted"),
]);

function isAbortErrorMessage(message: string): boolean {
  return ABORT_ERROR_MESSAGES.has(message.trim().toLowerCase());
}

/** assistant stopReason → 错误卡文案；正常结束返回 null。 */
function errorCardFromStopReason(
  stopReason: string | undefined,
  errorMessage: string | undefined,
): {
  stopReason: AssistantStopReason;
  title: string;
  message: string;
  errorKey?: string;
} | null {
  if (stopReason === "error") {
    // abort 竞态残留的 stop=error 按中断收口：run 判 interrupted，不落「模型调用失败」卡
    if (errorMessage !== undefined && isAbortErrorMessage(errorMessage)) {
      return { stopReason: "aborted", title: "", message: "" };
    }
    return {
      stopReason: "error",
      errorKey: "llm",
      title: t("session.error.llm"),
      message: errorMessage?.trim() || t("session.error.unknown"),
    };
  }
  if (stopReason === "aborted") {
    const msg = errorMessage?.trim();
    // 用户主动 abort：run 头已显示「已中断」，标准 abort 文案不再叠错误卡
    if (!msg || isAbortErrorMessage(msg)) return null;
    return {
      stopReason: "aborted",
      errorKey: "aborted",
      title: t("session.error.aborted"),
      message: msg,
    };
  }
  if (stopReason === "length") {
    return {
      stopReason: "length",
      errorKey: "length",
      title: t("session.error.length"),
      message: errorMessage?.trim() || t("session.error.lengthDetail"),
    };
  }
  if (stopReason === "stop" || stopReason === "toolUse") {
    return { stopReason, title: "", message: "" };
  }
  return null;
}

function compactionLabel(reason?: string): string {
  if (reason === "manual") return t("session.compact.manual");
  if (reason === "overflow") return t("session.compact.overflow");
  return t("session.compact.threshold");
}

function appendCompactionEnd(
  entries: SessionEntry[],
  event: {
    reason?: string;
    aborted?: boolean;
    errorMessage?: string;
    result?: {
      tokensBefore?: number;
      estimatedTokensAfter?: number;
    };
  },
): SessionEntry[] {
  // 压缩失败：错误原文入流（摘掉「…中」提示），不伪装成完成
  if (event.errorMessage?.trim()) {
    const next = [...entries];
    for (let i = next.length - 1; i >= 0; i -= 1) {
      const entry = next[i];
      if (entry.kind === "notice" && entry.pending === true) {
        next.splice(i, 1);
        break;
      }
      if (entry.kind === "run" || entry.kind === "assistant") break;
    }
    return [
      ...next,
      {
        kind: "error",
        id: uid(),
        errorKey: "compact",
        title: `${compactionLabel(event.reason)}${t("session.compact.failedSuffix")}`,
        message: event.errorMessage.trim(),
        at: Date.now(),
      },
    ];
  }

  const before = event.result?.tokensBefore;
  const after = event.result?.estimatedTokensAfter;
  const detail =
    before !== undefined && after !== undefined
      ? t("session.compact.tokenDetail", {
          before: formatTokens(before),
          after: formatTokens(after),
        })
      : "";
  // 覆盖同轮的「…中」提示，避免堆两条
  const next = [...entries];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const entry = next[i];
    if (entry.kind === "notice" && entry.pending === true) {
      next[i] = {
        ...entry,
        pending: false,
        text: `${compactionLabel(event.reason)}${t("session.compact.doneSuffix")}${detail}`,
      };
      return next;
    }
    if (entry.kind === "run" || entry.kind === "assistant") break;
  }
  return [
    ...entries,
    {
      kind: "notice",
      id: uid(),
      text: `${compactionLabel(event.reason)}${t("session.compact.doneSuffix")}${detail}`,
      at: Date.now(),
    },
  ];
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** 裸结果文本上限：与 toolPayload 展示上限对齐，避免 entries 无界膨胀。 */
const MAX_RESULT_TEXT = 256 * 1024;

function capRawResultText(text: string | null): string | null {
  if (text === null || text.length <= MAX_RESULT_TEXT) return text;
  return text.slice(0, MAX_RESULT_TEXT);
}

/** usage 数值未变时不替换 RunEntry，避免运行中 run 头每帧空刷。 */
function usageShallowEqual(a: PiUsage | null, b: PiUsage): boolean {
  if (!a) return false;
  return (
    a.input === b.input &&
    a.output === b.output &&
    a.cacheRead === b.cacheRead &&
    a.cacheWrite === b.cacheWrite &&
    a.totalTokens === b.totalTokens &&
    (a.cost?.total ?? null) === (b.cost?.total ?? null)
  );
}

/**
 * 把结束消息的 usage 累加进最近一个 running run（一轮 run 多次 assistant
 * 调用求和）；全 0 的失败/空消息不计，避免 run 头出现无意义的「0 tokens」。
 */
function accumulateRunUsage(entries: SessionEntry[], usage: PiUsage | undefined): SessionEntry[] {
  if (!usage || isZeroPiUsage(usage)) return entries;
  const next = [...entries];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const entry = next[i];
    if (entry.kind !== "run" || entry.status !== "running") continue;
    const merged = addPiUsage(entry.usage, usage);
    if (!merged || usageShallowEqual(entry.usage, merged)) return entries;
    next[i] = { ...entry, usage: merged };
    return next;
  }
  return entries;
}

function openRun(entries: SessionEntry[]): SessionEntry[] {
  // 开新 run 前收口上一轮：若上一轮以 error 收束且尚未终态，保留 failed 而不是强写 completed
  const next = closeOpenRuns(entries, statusFromLastError(entries));
  return [
    ...next,
    {
      kind: "run",
      id: uid(),
      status: "running",
      startedAt: Date.now(),
      endedAt: null,
      retry: null,
      retryCount: 0,
      usage: null,
      lastStopReason: null,
      lastErrorMessage: null,
      errorEntryId: null,
    },
  ];
}

function applyRetryStart(
  entries: SessionEntry[],
  event: { attempt: number; maxAttempts: number; errorMessage?: string },
): SessionEntry[] {
  const next = [...entries];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const entry = next[i];
    if (entry.kind !== "run") continue;
    if (entry.status !== "running") {
      // 无进行中 run 时兜底补一个，保证重试信息有落点
      next.push({
        kind: "run",
        id: uid(),
        status: "running",
        startedAt: Date.now(),
        endedAt: null,
        retry: {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          errorMessage: event.errorMessage ?? null,
        },
        retryCount: Math.max(0, event.attempt - 1),
        usage: null,
        lastStopReason: "error",
        lastErrorMessage: event.errorMessage ?? null,
        errorEntryId: null,
      });
      return next;
    }
    next[i] = {
      ...entry,
      retry: {
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        errorMessage: event.errorMessage ?? null,
      },
      lastErrorMessage: event.errorMessage ?? entry.lastErrorMessage,
    };
    return next;
  }
  return [
    ...entries,
    {
      kind: "run",
      id: uid(),
      status: "running",
      startedAt: Date.now(),
      endedAt: null,
      retry: {
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        errorMessage: event.errorMessage ?? null,
      },
      retryCount: Math.max(0, event.attempt - 1),
      usage: null,
      lastStopReason: "error",
      lastErrorMessage: event.errorMessage ?? null,
      errorEntryId: null,
    },
  ];
}

function applyRetryEnd(
  entries: SessionEntry[],
  event: { success?: boolean; finalError?: string },
): SessionEntry[] {
  let next = [...entries];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const entry = next[i];
    if (entry.kind === "run" && entry.status === "running") {
      next[i] = {
        ...entry,
        retry: null,
        retryCount: entry.retry ? entry.retryCount + 1 : entry.retryCount,
      };
      break;
    }
    if (entry.kind === "run") break;
  }
  if (event.success === false) {
    const finalError = event.finalError?.trim();
    // 重试链路里的 abort（退避睡眠被打断 / 重试期间用户中断）是中断不是模型故障：
    // 按中断收口，不落「模型调用失败」卡
    const aborted = finalError !== undefined && isAbortErrorMessage(finalError);
    for (let i = next.length - 1; i >= 0; i -= 1) {
      const entry = next[i];
      if (entry.kind === "run" && entry.status === "running") {
        next[i] = {
          ...entry,
          lastStopReason: aborted ? "aborted" : "error",
          lastErrorMessage: finalError ?? entry.lastErrorMessage,
        };
        break;
      }
      if (entry.kind === "run") break;
    }
    if (finalError && !aborted) {
      // 最终失败：同轮只落一张
      next = upsertRunErrorCard(next, t("session.error.llm"), finalError, "llm");
    }
  } else if (event.success === true) {
    // 重试成功：撤掉中间 attempt 留下的失败卡，避免「成功了还挂着错误」
    next = removeTurnErrors(next, "llm");
    for (let i = next.length - 1; i >= 0; i -= 1) {
      const entry = next[i];
      if (entry.kind === "run" && entry.status === "running") {
        next[i] = { ...entry, lastStopReason: null, lastErrorMessage: null };
        break;
      }
      if (entry.kind === "run") break;
    }
  }
  return next;
}

function closeRun(entries: SessionEntry[], status: RunStatus): SessionEntry[] {
  return closeOpenRuns(entries, status);
}

/** 用户可见的 run 终态收口：failed 时补齐唯一错误卡。 */
function finalizeRun(entries: SessionEntry[], status: RunStatus): SessionEntry[] {
  const closed = closeRun(entries, status);
  return status === "failed" ? ensureFinalErrorCard(closed) : closed;
}

function closeOpenRuns(entries: SessionEntry[], status: RunStatus): SessionEntry[] {
  const next = [...entries];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const entry = next[i];
    if (entry.kind === "run" && entry.status === "running") {
      const endedAt = entry.endedAt ?? Date.now();
      next[i] = {
        ...entry,
        status,
        endedAt,
        retry: null,
      };
      // 不变量（docs/design/13 P0-2）：run 一旦收口，其下不允许残留 streaming 块。
      // 正常路径 message_end 会复位，但中断 / 进程被杀 / 事件乱序时该事件可能缺失，
      // 必须在此兜底，否则「思考中」脉冲与打字光标常驻，用户误以为仍在运行。
      const closedTools = markRunningTools(
        next,
        status === "completed" ? "ok" : "cancelled",
        endedAt,
      );
      const closedStreams = markAssistantStreamsClosed(closedTools);
      return appendEditsSummary(closedStreams, i);
    }
    if (entry.kind === "run") break;
  }
  return next;
}

/**
 * 终态 failed 时确保同轮有且仅有一张「模型调用失败」：
 * 重试中间态可能从未落卡（或被清掉），用 run 上暂存的原文补最终那张。
 * upsert 对同轮同标题原地替换，已有卡时只刷新文案。
 */
function ensureFinalErrorCard(entries: SessionEntry[]): SessionEntry[] {
  const turnStart = findTurnStart(entries);
  for (let i = entries.length - 1; i >= turnStart; i -= 1) {
    const entry = entries[i];
    if (entry.kind !== "run") continue;
    if (entry.status !== "failed") return entries;
    const message = entry.lastErrorMessage?.trim();
    if (!message) return entries;
    return upsertRunErrorCard(entries, t("session.error.llm"), message, "llm");
  }
  return entries;
}

/** 路径归一（仅用于去重 key，展示仍保留原始 path）。 */
function fileEditKey(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * 从 run 之后的 assistant 块收集成功落地的文件编辑。
 * 只认 toolKind 为 edit/write 且 status=ok 的 change 载荷；
 * 同一文件多次编辑按路径合并累加。
 */
function collectFileEdits(entries: SessionEntry[], fromIndex: number): EditsFileStat[] {
  const byPath = new Map<string, EditsFileStat>();
  for (let i = fromIndex; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.kind !== "assistant") continue;
    for (const block of entry.blocks) {
      if (block.kind !== "tool") continue;
      if (block.toolKind !== "edit" && block.toolKind !== "write") continue;
      if (block.status !== "ok") continue;
      const result = block.result;
      if (result?.kind !== "change") continue;
      const path = result.path || block.subject;
      if (!path) continue;
      const key = fileEditKey(path);
      const additions = result.additions ?? 0;
      const deletions = result.deletions ?? 0;
      const existing = byPath.get(key);
      if (existing) {
        existing.additions += additions;
        existing.deletions += deletions;
      } else {
        byPath.set(key, { path, additions, deletions });
      }
    }
  }
  return [...byPath.values()];
}

/** run 收口后追加文件编辑汇总卡；无编辑则原样返回。 */
function appendEditsSummary(entries: SessionEntry[], runIndex: number): SessionEntry[] {
  const files = collectFileEdits(entries, runIndex + 1);
  if (files.length === 0) return entries;
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const file of files) {
    totalAdditions += file.additions;
    totalDeletions += file.deletions;
  }
  return [
    ...entries,
    {
      kind: "editsSummary",
      id: uid(),
      files,
      totalAdditions,
      totalDeletions,
      at: Date.now(),
    },
  ];
}

function markInterrupted(entries: SessionEntry[]): SessionEntry[] {
  return finalizeRun(entries, "interrupted");
}

/** run 结束时把仍在跑的工具块收尾，避免永久 spinner。endedAt 默认取当下（实时收口）。 */
function markRunningTools(
  entries: SessionEntry[],
  status: ToolStatus,
  endedAt: number = Date.now(),
): SessionEntry[] {
  return entries.map((entry) => {
    if (entry.kind !== "assistant") return entry;
    let touched = false;
    const blocks = entry.blocks.map((block) => {
      if (block.kind !== "tool" || block.status !== "running") return block;
      touched = true;
      return { ...block, status, endedAt: block.endedAt ?? endedAt };
    });
    return touched ? { ...entry, blocks } : entry;
  });
}

/** run 收口时把仍在流式中的 text/thinking 块复位（message_end 缺失的中断路径兜底）。 */
function markAssistantStreamsClosed(entries: SessionEntry[]): SessionEntry[] {
  let touched = false;
  const next = entries.map((entry) => {
    if (entry.kind !== "assistant") return entry;
    let entryTouched = false;
    const blocks = entry.blocks.map((block) => {
      if ((block.kind === "text" || block.kind === "thinking") && block.streaming === true) {
        entryTouched = true;
        return { ...block, streaming: false };
      }
      return block;
    });
    if (entryTouched) {
      touched = true;
      return { ...entry, blocks };
    }
    return entry;
  });
  return touched ? next : entries;
}

/** 对最后一个 assistant 条目做块级变更；不存在时兜底创建（message_start 缺失场景）。 */
function mutateLastAssistant(
  entries: SessionEntry[],
  mutate: (blocks: AssistantBlock[]) => AssistantBlock[] | null,
): SessionEntry[] {
  const last = entries.at(-1);
  if (last?.kind !== "assistant") {
    const blocks = mutate([]) ?? [];
    return [...entries, { kind: "assistant", id: uid(), blocks }];
  }
  const mutated = mutate([...last.blocks]);
  if (!mutated) return entries;
  const next = [...entries];
  next[next.length - 1] = { ...last, blocks: mutated };
  return next;
}

function applyDelta(entries: SessionEntry[], delta: PiStreamDelta): SessionEntry[] {
  const contentIndex =
    "contentIndex" in delta && typeof delta.contentIndex === "number"
      ? delta.contentIndex
      : undefined;
  switch (delta.type) {
    case "text_start":
      return mutateLastAssistant(entries, (blocks) => {
        const existing = findBlockByIndex(blocks, contentIndex, "text");
        if (existing !== -1) return null;
        return [
          ...blocks,
          {
            kind: "text",
            text: "",
            streaming: true,
            contentIndex: contentIndex ?? nextContentIndex(blocks),
          },
        ];
      });
    case "text_delta":
      return mutateLastAssistant(entries, (blocks) =>
        appendToKindedBlock(blocks, "text", delta.delta, contentIndex),
      );
    case "thinking_start":
      return mutateLastAssistant(entries, (blocks) => {
        const existing = findBlockByIndex(blocks, contentIndex, "thinking");
        if (existing !== -1) return null;
        return [
          ...blocks,
          {
            kind: "thinking",
            text: "",
            streaming: true,
            contentIndex: contentIndex ?? nextContentIndex(blocks),
          },
        ];
      });
    case "thinking_delta":
      return mutateLastAssistant(entries, (blocks) =>
        appendToKindedBlock(blocks, "thinking", delta.delta, contentIndex),
      );
    case "toolcall_start":
      return mutateLastAssistant(entries, (blocks) => {
        if (blocks.some((block) => block.kind === "tool" && block.toolCallId === delta.id)) {
          return null;
        }
        const name = delta.toolName || "tool";
        const kind = classifyTool(name);
        return [
          ...blocks,
          createToolBlock(
            delta.id || uid(),
            name,
            kind,
            "",
            undefined,
            contentIndex ?? nextContentIndex(blocks),
          ),
        ];
      });
    case "toolcall_delta":
      return mutateLastAssistant(entries, (blocks) => {
        const index = findToolIndexForArgs(blocks, contentIndex);
        if (index === -1) return null;
        const block = blocks[index] as ToolAssistantBlock;
        const argsText = block.argsText + delta.delta;
        const args = tryParseJson(argsText) ?? argsText;
        const parsed = parseToolArgs(block.toolKind, args);
        blocks[index] = {
          ...block,
          argsText,
          args,
          subject: parsed.subject || block.subject,
        };
        return blocks;
      });
    default:
      // text/thinking/toolcall 的闭合以 message_end 权威对账为准
      return entries;
  }
}

function findBlockByIndex(
  blocks: AssistantBlock[],
  contentIndex: number | undefined,
  kind: "text" | "thinking",
): number {
  if (contentIndex === undefined) {
    const last = blocks.at(-1);
    return last && last.kind === kind ? blocks.length - 1 : -1;
  }
  return blocks.findIndex((block) => block.kind === kind && block.contentIndex === contentIndex);
}

function nextContentIndex(blocks: AssistantBlock[]): number {
  let max = -1;
  for (const block of blocks) {
    if (block.contentIndex > max) max = block.contentIndex;
  }
  return max + 1;
}

/** args 增量优先归到同 contentIndex 的 running 工具；否则最后一个 running 工具。 */
function findToolIndexForArgs(blocks: AssistantBlock[], contentIndex: number | undefined): number {
  if (contentIndex !== undefined) {
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const block = blocks[i];
      if (
        block.kind === "tool" &&
        block.contentIndex === contentIndex &&
        block.status === "running"
      ) {
        return i;
      }
    }
  }
  return findLastRunningToolIndex(blocks);
}

function createToolBlock(
  toolCallId: string,
  name: string,
  kind: ToolKind,
  argsText: string,
  args: unknown,
  contentIndex = 0,
): ToolAssistantBlock {
  const parsed = parseToolArgs(kind, args);
  return {
    kind: "tool",
    toolCallId,
    name,
    toolKind: kind,
    action: actionLabel(kind),
    subject: parsed.subject,
    argsText,
    args,
    status: "running",
    result: null,
    resultText: null,
    startedAt: Date.now(),
    endedAt: null,
    contentIndex,
  };
}

function appendToKindedBlock(
  blocks: AssistantBlock[],
  kind: "text" | "thinking",
  delta: string,
  contentIndex?: number,
): AssistantBlock[] {
  const target = findBlockByIndex(blocks, contentIndex, kind);
  if (target !== -1) {
    const block = blocks[target];
    if (block.kind === kind) {
      blocks[target] = { ...block, text: block.text + delta, streaming: true };
      return blocks;
    }
  }
  return [
    ...blocks,
    kind === "text"
      ? {
          kind: "text",
          text: delta,
          streaming: true,
          contentIndex: contentIndex ?? nextContentIndex(blocks),
        }
      : {
          kind: "thinking",
          text: delta,
          streaming: true,
          contentIndex: contentIndex ?? nextContentIndex(blocks),
        },
  ];
}

function findLastRunningToolIndex(blocks: AssistantBlock[]): number {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i].kind === "tool" && (blocks[i] as ToolAssistantBlock).status === "running") {
      return i;
    }
  }
  return -1;
}

/** message_end 为权威数据：重建 text/thinking 块，工具块按 id 保留运行态与结果；并落盘 stopReason 错误。 */
function applyMessageEnd(entries: SessionEntry[], message: PiChatMessage): SessionEntry[] {
  const last = entries.at(-1);
  const card = errorCardFromStopReason(message.stopReason, message.errorMessage);

  // 模型错误（stopReason=error）中间态不落卡：可能紧接着 auto_retry，
  // 只记 lastErrorMessage，由 finalizeRun / auto_retry_end 在终态补唯一一张。
  const deferModelCard = card?.stopReason === "error";

  if (last?.kind !== "assistant") {
    // 无 message_start 时兜底：仅错误也入流
    if (card?.title) {
      if (card.stopReason === "stop" || card.stopReason === "toolUse") return entries;
      let next = recordStopReason(entries, card.stopReason, card.message);
      if (!deferModelCard) {
        next = upsertRunErrorCard(next, card.title, card.message, card.errorKey ?? "llm");
      }
      return next;
    }
    return entries;
  }

  const existingTools = new Map<string, ToolAssistantBlock>();
  for (const block of last.blocks) {
    if (block.kind === "tool") existingTools.set(block.toolCallId, block);
  }
  const rebuilt = blocksFromContent(message.content, existingTools).map((block) =>
    block.kind === "text" || block.kind === "thinking" ? { ...block, streaming: false } : block,
  );

  // stop/toolUse 之外的结束原因，或正常 stop：把漏收的 running 工具收成终态，避免永久 spinner
  if (message.stopReason !== "toolUse") {
    for (let i = 0; i < rebuilt.length; i += 1) {
      const block = rebuilt[i];
      if (block.kind !== "tool" || block.status !== "running") continue;
      rebuilt[i] = {
        ...block,
        status:
          message.stopReason === "error" || message.stopReason === "aborted" ? "cancelled" : "ok",
        endedAt: block.endedAt ?? Date.now(),
      };
    }
  }

  let next = [...entries];
  // 空内容且非错误：丢掉空 assistant 壳
  if (rebuilt.length === 0 && !card?.title) {
    if (last.blocks.length === 0) {
      // 空壳也要落 stopReason（abort 残留的空错误消息正好命中这里），
      // 否则 agent_end 会把 run 误收口为 completed
      if (card) {
        next = recordStopReason(next, card.stopReason, card.title ? card.message : undefined);
      }
      next.pop();
      return next;
    }
    return entries;
  }
  if (rebuilt.length > 0 || last.blocks.length > 0) {
    next[next.length - 1] = { ...last, blocks: rebuilt.length > 0 ? rebuilt : last.blocks };
  } else {
    next.pop();
  }

  if (card) {
    next = recordStopReason(next, card.stopReason, card.title ? card.message : undefined);
    if (card.title && !deferModelCard) {
      next = upsertRunErrorCard(next, card.title, card.message, card.errorKey ?? "llm");
    }
  }
  return next;
}

function upsertToolBlock(
  entries: SessionEntry[],
  toolCallId: string,
  fallbackName: string,
  fallbackArgs: unknown,
  patch: (block: ToolAssistantBlock) => ToolAssistantBlock,
): SessionEntry[] {
  // 工具事件可能跨多个 assistant 条目（并行/续写）；按 id 全量检索，避免只改 last 导致状态悬空
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind !== "assistant") continue;
    const index = entry.blocks.findIndex(
      (block) => block.kind === "tool" && block.toolCallId === toolCallId,
    );
    if (index === -1) continue;
    const blocks = [...entry.blocks];
    blocks[index] = patch(blocks[index] as ToolAssistantBlock);
    const next = [...entries];
    next[i] = { ...entry, blocks };
    return next;
  }

  const last = entries.at(-1);
  const baseBlocks = last?.kind === "assistant" ? last.blocks : [];
  const fresh = createToolBlock(
    toolCallId,
    fallbackName,
    classifyTool(fallbackName),
    typeof fallbackArgs === "string" ? fallbackArgs : JSON.stringify(fallbackArgs ?? null),
    fallbackArgs,
    nextContentIndex(baseBlocks),
  );
  if (last?.kind !== "assistant") {
    return [...entries, { kind: "assistant", id: uid(), blocks: [patch(fresh)] }];
  }
  const next = [...entries];
  next[next.length - 1] = { ...last, blocks: [...last.blocks, patch(fresh)] };
  return next;
}

// ---------------------------------------------------------------------------
// 历史消息装载
// ---------------------------------------------------------------------------

/**
 * 按用户消息切分合成 Run 边界（历史 JSONL 无精确 agent_start/end）。
 * 状态由该轮 assistant 的 stopReason 推导；最后一轮若无 assistant 则不产生空 run。
 */
function entriesFromMessages(messages: PiChatMessage[], sessionStartedAt?: number): SessionEntry[] {
  const entries: SessionEntry[] = [];
  let pendingRunStart: number | null = null;
  let runOpened = false;
  let fallbackAt = sessionStartedAt ?? Date.now();
  let runErrorEntryId: string | null = null;
  let runLastStopReason: AssistantStopReason | null = null;

  const closeSyntheticRun = (endedAt: number | null): void => {
    if (!runOpened) return;
    const status: RunStatus =
      runLastStopReason === "error"
        ? "failed"
        : runLastStopReason === "aborted"
          ? "interrupted"
          : "completed";
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry.kind === "run" && entry.synthetic && entry.status === "running") {
        // 终态必须落真实 endedAt：留 null 会让 AgentRunHeader 拿挂载时刻当终点，
        // 历史最后一轮的用时会随组件重挂载一直变大
        const resolvedEnd = endedAt ?? entry.startedAt;
        const closed = markRunningTools(
          entries.map((item, index) =>
            index === i ? { ...item, status, endedAt: resolvedEnd } : item,
          ),
          status === "completed" ? "ok" : "cancelled",
          resolvedEnd,
        );
        const withSummary = appendEditsSummary(closed, i);
        entries.length = 0;
        entries.push(...withSummary);
        return;
      }
      if (entry.kind === "run") return;
    }
  };

  const openSyntheticRun = (startedAt: number): void => {
    entries.push({
      kind: "run",
      id: uid(),
      status: "running",
      startedAt,
      endedAt: null,
      retry: null,
      retryCount: 0,
      synthetic: true,
      usage: null,
      lastStopReason: null,
      lastErrorMessage: null,
      errorEntryId: null,
    });
    runOpened = true;
    runErrorEntryId = null;
    runLastStopReason = null;
  };

  for (const message of messages) {
    const ts = messageTimestamp(message) ?? fallbackAt;
    fallbackAt = ts;

    if (message.role === "user") {
      closeSyntheticRun(ts);
      const text = extractText(message.content) ?? "";
      const images = imagesFromMessageContent(message.content);
      if (text.trim().length > 0 || images.length > 0) {
        entries.push({
          kind: "user",
          id: uid(),
          text,
          images: images.length > 0 ? images : undefined,
        });
      }
      pendingRunStart = ts;
      runOpened = false;
      continue;
    }

    if (message.role === "assistant") {
      if (pendingRunStart !== null && !runOpened) {
        openSyntheticRun(pendingRunStart);
      }
      const blocks = blocksFromContent(message.content, null);
      if (blocks.length > 0) {
        entries.push({
          kind: "assistant",
          id: uid(),
          blocks,
        });
      }
      accumulateSyntheticUsage(entries, message.usage);
      const card = errorCardFromStopReason(message.stopReason, message.errorMessage);
      if (card) {
        runLastStopReason = card.stopReason;
        // 历史装载：同轮只保留最后一条错误卡（与实时语义一致）
        if (card.title) {
          if (runErrorEntryId) {
            const idx = entries.findIndex((e) => e.id === runErrorEntryId && e.kind === "error");
            if (idx >= 0) {
              entries[idx] = {
                kind: "error",
                id: runErrorEntryId,
                errorKey: card.errorKey,
                title: card.title,
                message: card.message,
                at: ts,
              };
            }
          } else {
            const errorId = uid();
            entries.push({
              kind: "error",
              id: errorId,
              errorKey: card.errorKey,
              title: card.title,
              message: card.message,
              at: ts,
            });
            runErrorEntryId = errorId;
            for (let i = entries.length - 1; i >= 0; i -= 1) {
              const entry = entries[i];
              if (entry.kind === "run" && entry.status === "running") {
                entries[i] = {
                  ...entry,
                  errorEntryId: errorId,
                  lastStopReason: card.stopReason,
                  lastErrorMessage: card.title ? card.message : entry.lastErrorMessage,
                };
                break;
              }
            }
          }
        }
        for (let i = entries.length - 1; i >= 0; i -= 1) {
          const entry = entries[i];
          if (entry.kind === "run" && entry.status === "running") {
            entries[i] = {
              ...entry,
              lastStopReason: card.stopReason,
              lastErrorMessage: card.title ? card.message : entry.lastErrorMessage,
            };
            break;
          }
        }
      }
      continue;
    }

    if (message.role === "toolResult") {
      if (pendingRunStart !== null && !runOpened) {
        openSyntheticRun(pendingRunStart);
      }
      attachToolResult(entries, message, ts);
    }
  }
  // 最后一轮用最后一条消息的时间戳收口（而不是 null / Date.now()）
  closeSyntheticRun(fallbackAt);
  return entries;
}

function messageTimestamp(message: PiChatMessage): number | null {
  const record = message as unknown as { timestamp?: unknown };
  if (typeof record.timestamp === "number" && Number.isFinite(record.timestamp)) {
    return record.timestamp;
  }
  return null;
}

/**
 * 历史装载：把 assistant 消息的 usage 累加进当前合成 run（就地改 entries，
 * 与实时 message_end 的累加同口径），历史会话的 run 头徽标由此点亮。
 */
function accumulateSyntheticUsage(entries: SessionEntry[], usage: PiUsage | undefined): void {
  if (!usage || isZeroPiUsage(usage)) return;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind !== "run" || entry.status !== "running") continue;
    const merged = addPiUsage(entry.usage, usage);
    if (merged && !usageShallowEqual(entry.usage, merged)) {
      entries[i] = { ...entry, usage: merged };
    }
    return;
  }
}

/**
 * 把 toolResult 消息回填到前面最近的同 id 工具块（历史装载路径）。
 * pi 磁盘 JSONL 把 toolCallId / toolName / isError 写在 message 上，不在 content 里。
 */
function attachToolResult(entries: SessionEntry[], message: PiChatMessage, endedAt: number): void {
  const toolCallId =
    message.toolCallId ?? readStringField(message.content, "toolCallId") ?? undefined;
  if (!toolCallId) return;
  const content = message.content;
  const resultText = extractText(content);
  const isError =
    message.isError === true ||
    readStringField(content, "isError") === "true" ||
    content.some(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        (block as { isError?: unknown }).isError === true,
    );
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind !== "assistant") continue;
    const index = entry.blocks.findIndex(
      (block) => block.kind === "tool" && block.toolCallId === toolCallId,
    );
    if (index === -1) continue;
    const block = entry.blocks[index] as ToolAssistantBlock;
    const result = buildToolResult(block.toolKind, block.args, content, isError);
    const blocks = [...entry.blocks];
    blocks[index] = {
      ...block,
      status: isError ? "error" : "ok",
      result,
      resultText: capRawResultText(resultText ?? block.resultText),
      endedAt: block.endedAt ?? endedAt,
    };
    // entries 是 entriesFromMessages 正在组装的本地数组，就地写回；
    // 此前补丁落在局部副本上从未生效，历史装载的工具结果一直丢失
    entries[i] = { ...entry, blocks };
    return;
  }
}

// ---------------------------------------------------------------------------
// 收窄工具（pi 各角色 content 块结构不同，全部按 unknown 收窄）
// ---------------------------------------------------------------------------

/** 从 pi 消息 content 数组装配渲染块；toolBlocksById 用于保留流式期的工具块状态。 */
function blocksFromContent(
  content: unknown[],
  toolBlocksById: Map<string, ToolAssistantBlock> | null,
): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  content.forEach((raw, contentIndex) => {
    const text = asRecord(raw);
    if (text && text.type === "text" && typeof text.text === "string") {
      blocks.push({ kind: "text", text: text.text, contentIndex });
      return;
    }
    if (text && text.type === "thinking" && typeof text.thinking === "string") {
      blocks.push({ kind: "thinking", text: text.thinking, contentIndex });
      return;
    }
    if (text && text.type === "toolCall" && typeof text.id === "string") {
      const existing = toolBlocksById?.get(text.id);
      if (existing) {
        blocks.push(
          existing.argsText.length === 0 && text.arguments !== undefined
            ? {
                ...existing,
                args: text.arguments,
                argsText: toolArgsText(text.arguments),
                subject:
                  parseToolArgs(existing.toolKind, text.arguments).subject || existing.subject,
                contentIndex,
              }
            : { ...existing, contentIndex },
        );
      } else {
        const name = typeof text.name === "string" ? text.name : "tool";
        blocks.push(
          createToolBlock(
            text.id,
            name,
            classifyTool(name),
            toolArgsText(text.arguments),
            text.arguments,
            contentIndex,
          ),
        );
      }
    }
  });
  return blocks;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** 参数美化：字符串原样、对象序列化；空返回 ""。 */
function toolArgsText(argumentsValue: unknown): string {
  if (typeof argumentsValue === "string") return argumentsValue;
  if (argumentsValue !== undefined && argumentsValue !== null) {
    try {
      return JSON.stringify(argumentsValue, null, 2);
    } catch {
      return String(argumentsValue);
    }
  }
  return "";
}

/** 从消息 content 提取纯文本（text 块数组 / 字符串 / 嵌套 content 的通用提取）。 */
export function extractText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map(extractText).filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  const record = asRecord(value);
  if (!record) return null;
  if (typeof record.text === "string") return record.text;
  if (typeof record.thinking === "string") return record.thinking;
  if (record.content !== undefined) return extractText(record.content);
  return null;
}

function readStringField(value: unknown, field: string): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = readStringField(item, field);
      if (found !== null) return found;
    }
    return null;
  }
  const record = asRecord(value);
  return record && typeof record[field] === "string" ? (record[field] as string) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
