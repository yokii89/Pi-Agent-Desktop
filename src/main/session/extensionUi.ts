/**
 * pi 扩展 UI 子协议（RPC `extension_ui_request` / `extension_ui_response`）的主进程侧。
 *
 * 契约（pi docs/rpc-extension-ui.md）：
 * - 对话框方法 `select` / `confirm` / `input` / `editor` 发出请求后**一直等**客户端回
 *   `extension_ui_response`（按 `id` 关联）。不回就是工具永久挂起（docs/design/122 §3）。
 * - 带 `timeout` 的请求由 pi 侧自行按未答结算，客户端**不能**再写回，只需撤窗。
 * - 发后即忘方法（`notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text`）
 *   不应答也不会挂起会话。
 *
 * 本模块刻意不 import electron / piSession：传输经 {@link SessionUiSink} 注入，
 * 协议解析与结算状态机因此可以纯测（AGENTS.md「测试」条款）。
 */
import type {
  SessionId,
  SessionUiDialogMethod,
  SessionUiDialogRequest,
  SessionUiNotice,
  SessionUiPush,
  SessionUiSettleReason,
} from "../../shared/ipc";

/** 传输注入点：推送给渲染层 + 写入指定会话 pi 的 stdin。 */
export interface SessionUiSink {
  /** 返回 false = 没投递出去（窗口已销毁 / 不存在），对话框永远不会有人作答。 */
  push(message: SessionUiPush): boolean;
  /** 写一行 JSONL；返回 false 表示该会话进程已不在。 */
  writeLine(sessionId: SessionId, record: Record<string, unknown>): boolean;
}

const DIALOG_METHODS = new Set<SessionUiDialogMethod>(["select", "confirm", "input", "editor"]);
/** 已知但本渲染器没有对应界面的发后即忘方法：消费掉、不应答、不转发。 */
const DROPPED_METHODS = new Set<string>(["setStatus", "setWidget", "setTitle", "set_editor_text"]);
const NOTICE_LEVELS = new Set<SessionUiNotice["level"]>(["info", "warning", "error"]);

/** 请求字段来自扩展（不可信输入），一律消毒后再进渲染层。 */
const MAX_ID_CHARS = 128;
const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 4000;
const MAX_OPTION_COUNT = 50;
const MAX_OPTION_CHARS = 500;
/** pi 侧 timeout 上限保护：异常大的值会让我们挂一个永不触发的定时器。 */
const MAX_TIMEOUT_MS = 60 * 60_000;

export interface SessionUiAnswer {
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

/**
 * 解析结果的四类：
 * - `dialog`：需要应答的对话框；
 * - `notice`：`notify`，降级成提示条；
 * - `drop`：已知但不渲染的发后即忘方法（消费掉即可，不应答）；
 * - `unknown`：**不认识的方法**。按未答应答一次——它若是对话框就能解开会话，
 *   若是发后即忘则 pi 侧按 id 查不到等待者、自然忽略。宁多答不漏答。
 * - `invalid`：结构不合法（连 id 都没有），无法应答。
 */
export type ParsedUiRequest =
  | { kind: "dialog"; id: string; request: SessionUiDialogRequest }
  | { kind: "notice"; id: string; notice: SessionUiNotice }
  | { kind: "drop" }
  | { kind: "unknown"; id: string; method: string }
  | { kind: "invalid" };

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function asString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return clip(value, max);
}

/** 消毒 `select` 候选项：非字符串项丢弃，空列表按「没有可选项」处理。 */
function normalizeOptions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || item.length === 0) continue;
    items.push(clip(item, MAX_OPTION_CHARS));
    if (items.length >= MAX_OPTION_COUNT) break;
  }
  return items.length > 0 ? items : undefined;
}

function normalizeTimeout(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.min(raw, MAX_TIMEOUT_MS);
}

/** 解析一行 `extension_ui_request`（纯函数，不做副作用）。 */
export function parseUiRequest(raw: unknown): ParsedUiRequest {
  if (!raw || typeof raw !== "object") return { kind: "invalid" };
  const record = raw as Record<string, unknown>;
  const id = asString(record.id, MAX_ID_CHARS);
  const method = typeof record.method === "string" ? record.method : "";
  if (!id) {
    // 没有 id 就无从关联应答；发后即忘方法照常消费，对话框方法只能放弃
    return DROPPED_METHODS.has(method) || method === "notify"
      ? { kind: "drop" }
      : { kind: "invalid" };
  }

  if (method === "notify") {
    const message = asString(record.message, MAX_BODY_CHARS);
    if (!message) return { kind: "drop" };
    const level =
      typeof record.notifyType === "string" &&
      NOTICE_LEVELS.has(record.notifyType as SessionUiNotice["level"])
        ? (record.notifyType as SessionUiNotice["level"])
        : "info";
    return { kind: "notice", id, notice: { message, level } };
  }

  if (DROPPED_METHODS.has(method)) return { kind: "drop" };
  if (!DIALOG_METHODS.has(method as SessionUiDialogMethod)) {
    return { kind: "unknown", id, method };
  }

  const request: SessionUiDialogRequest = {
    method: method as SessionUiDialogMethod,
    title: asString(record.title, MAX_TITLE_CHARS) ?? "",
  };
  const options = normalizeOptions(record.options);
  if (options) request.options = options;
  const message = asString(record.message, MAX_BODY_CHARS);
  if (message) request.message = message;
  const placeholder = asString(record.placeholder, MAX_TITLE_CHARS);
  if (placeholder) request.placeholder = placeholder;
  const prefill = asString(record.prefill, MAX_BODY_CHARS);
  if (prefill) request.prefill = prefill;
  const timeoutMs = normalizeTimeout(record.timeout);
  if (timeoutMs !== undefined) request.timeoutMs = timeoutMs;
  return { kind: "dialog", id, request };
}

/** 应答记录（写回 pi stdin）。 */
export function buildResponseRecord(id: string, answer: SessionUiAnswer): Record<string, unknown> {
  if (answer.cancelled === true) {
    return { type: "extension_ui_response", id, cancelled: true };
  }
  if (typeof answer.confirmed === "boolean") {
    return { type: "extension_ui_response", id, confirmed: answer.confirmed };
  }
  return { type: "extension_ui_response", id, value: answer.value ?? "" };
}

interface Pending {
  method: SessionUiDialogMethod;
  options?: string[];
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * 未应答的对话框登记表：按 `sessionId + id` 两级关联。
 * 进程级单例由 {@link initSessionUi} 建立（与 piSession 的 instances Map 同生命周期）。
 */
export class SessionUiLedger {
  #pending = new Map<SessionId, Map<string, Pending>>();

  constructor(private readonly sink: SessionUiSink) {}

  /** 该会话等待作答的对话框数量（侧栏「等待回答」标记的数据源）。 */
  pendingCount(sessionId: SessionId): number {
    return this.#pending.get(sessionId)?.size ?? 0;
  }

  listPending(sessionId: SessionId): string[] {
    return [...(this.#pending.get(sessionId)?.keys() ?? [])];
  }

  /**
   * 处理一条 `extension_ui_request`。返回 true 表示本域已消费（含被丢弃的发后即忘方法），
   * 调用方不必再走事件白名单分支。
   */
  handleRecord(sessionId: SessionId, raw: unknown): boolean {
    const parsed = parseUiRequest(raw);
    switch (parsed.kind) {
      case "notice":
        this.sink.push({ sessionId, type: "notice", id: parsed.id, payload: parsed.notice });
        return true;
      case "drop":
        return true;
      case "unknown":
        // 不认识的方法：按未答应答一次，绝不让会话挂在一个我们渲染不出来的请求上
        return this.sink.writeLine(sessionId, buildResponseRecord(parsed.id, { cancelled: true }));
      case "invalid":
        return false;
      case "dialog":
        return this.#openDialog(sessionId, parsed.id, parsed.request);
    }
  }

  /**
   * 渲染层作答。返回 false 表示该请求已被超时 / 会话结束先行结算，或应答与方法不匹配
   * （如 `select` 回了候选项之外的值）——此时不写回 pi。
   */
  respond(sessionId: SessionId, id: string, answer: SessionUiAnswer): boolean {
    const byId = this.#pending.get(sessionId);
    const pending = byId?.get(id);
    if (!byId || !pending) return false;
    if (!this.#answerMatchesMethod(pending, answer)) return false;

    this.#disarm(pending);
    byId.delete(id);
    if (byId.size === 0) this.#pending.delete(sessionId);
    if (!this.sink.writeLine(sessionId, buildResponseRecord(id, answer))) return false;
    this.sink.push({ sessionId, type: "settled", id, payload: { reason: "answered" } });
    return true;
  }

  /**
   * 会话中断 / 退出 / 销毁：把该会话所有未答对话框按未答结算。
   * 进程可能已经死了（writeLine 返回 false），但渲染层必须收到撤窗通知。
   */
  dropSession(sessionId: SessionId, reason: SessionUiSettleReason = "session"): void {
    const byId = this.#pending.get(sessionId);
    if (!byId || byId.size === 0) {
      this.#pending.delete(sessionId);
      return;
    }
    this.#pending.delete(sessionId);
    for (const [id, pending] of byId) {
      this.#disarm(pending);
      this.sink.writeLine(sessionId, buildResponseRecord(id, { cancelled: true }));
      this.sink.push({ sessionId, type: "settled", id, payload: { reason } });
    }
  }

  #openDialog(sessionId: SessionId, id: string, request: SessionUiDialogRequest): boolean {
    const byId = this.#pending.get(sessionId) ?? new Map<string, Pending>();
    this.#pending.set(sessionId, byId);
    // 同一 id 重发（pi 不会，防御性）：不重复登记，也不重复弹窗
    if (byId.has(id)) return true;

    byId.set(id, {
      method: request.method,
      options: request.options,
      timer:
        request.timeoutMs === undefined ? null : this.#armTimeout(sessionId, id, request.timeoutMs),
    });
    if (this.sink.push({ sessionId, type: "request", id, payload: request })) return true;
    // 窗口已销毁 / 不存在：弹窗永远没人看到，当场按未答结算，不留挂死的会话
    const pending = byId.get(id);
    if (pending) this.#disarm(pending);
    byId.delete(id);
    if (byId.size === 0) this.#pending.delete(sessionId);
    return this.sink.writeLine(sessionId, buildResponseRecord(id, { cancelled: true }));
  }

  #armTimeout(sessionId: SessionId, id: string, timeoutMs: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      const byId = this.#pending.get(sessionId);
      const pending = byId?.get(id);
      if (!byId || !pending) return;
      byId.delete(id);
      if (byId.size === 0) this.#pending.delete(sessionId);
      // pi 侧已自行按未答结算，不能再写回，只撤窗
      this.sink.push({ sessionId, type: "settled", id, payload: { reason: "timeout" } });
    }, timeoutMs);
    timer.unref?.();
    return timer;
  }

  #disarm(pending: Pending): void {
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = null;
  }

  #answerMatchesMethod(pending: Pending, answer: SessionUiAnswer): boolean {
    if (answer.cancelled === true) return true;
    if (pending.method === "confirm") return typeof answer.confirmed === "boolean";
    if (pending.method === "select") {
      return typeof answer.value === "string" && (pending.options?.includes(answer.value) ?? false);
    }
    return typeof answer.value === "string";
  }
}

let ledger: SessionUiLedger | null = null;

/** 创建登记表（piSession 首次需要时调用一次；测试可自建实例）。 */
export function initSessionUi(sink: SessionUiSink): SessionUiLedger {
  ledger = new SessionUiLedger(sink);
  return ledger;
}

/** 取登记表；尚未初始化（还没有任何会话）时为 null。 */
export function getSessionUiLedger(): SessionUiLedger | null {
  return ledger;
}

/** 该会话是否有等待用户作答的对话框；未初始化时为 0。 */
export function pendingUiCount(sessionId: SessionId): number {
  return ledger?.pendingCount(sessionId) ?? 0;
}
