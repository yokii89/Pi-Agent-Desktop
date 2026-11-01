/**
 * 未应答的扩展对话框（pi `extension_ui_request`）在渲染层的轻量外部存储（docs/design/123）。
 *
 * 只镜像主进程登记表里「还活着」的那几个请求：`request` 入表、`settled` 出表。
 * 真值仍在主进程（超时、会话退出、写回失败都在那里结算），本表不做任何判定，
 * 因此也不需要在组件卸载时清理。
 */
import { useSyncExternalStore } from "react";
import type { SessionId, SessionUiPush, SessionUiRespondRequest } from "../../shared/ipc";
import { sessionUiService } from "../services/sessionUiService";

export interface PendingUiDialog {
  sessionId: SessionId;
  /** pi 侧请求 id，作答必须原样带回。 */
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  options?: string[];
  message?: string;
  placeholder?: string;
  prefill?: string;
}

export interface UiAnswerPayload {
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

let items: readonly PendingUiDialog[] = [];
/** 派生态：挂着未答对话框的会话集合（侧栏「等待回答」同源，docs/design/82）。 */
let sessionIds: ReadonlySet<string> = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setItems(next: readonly PendingUiDialog[]): void {
  if (next === items) return;
  items = next;
  const ids = new Set<string>();
  for (const item of next) ids.add(item.sessionId);
  // 内容不变则沿用同一实例：侧栏整列跟着快照身份重渲染，不能每次新建 Set
  const same = ids.size === sessionIds.size && [...ids].every((id) => sessionIds.has(id));
  if (!same) sessionIds = ids;
  emit();
}

function removeById(id: string): void {
  const next = items.filter((item) => item.id !== id);
  if (next.length !== items.length) setItems(next);
}

export const sessionUiStore = {
  get(): readonly PendingUiDialog[] {
    return items;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** 该会话是否还在等用户作答（侧栏「等待回答」标记的数据源）。 */
  hasPending(sessionId: SessionId | null | undefined): boolean {
    if (!sessionId) return false;
    return sessionIds.has(sessionId);
  },
  /** 消费一条推送；`notice` 由调用方降级成提示条，不入表。 */
  applyPush(message: SessionUiPush): "dialog" | "settle" | "notice" | "none" {
    if (message.type === "request") {
      if (items.some((item) => item.id === message.id)) return "none";
      const { sessionId, id, payload } = message;
      setItems([
        ...items,
        {
          sessionId,
          id,
          method: payload.method,
          title: payload.title,
          options: payload.options,
          message: payload.message,
          placeholder: payload.placeholder,
          prefill: payload.prefill,
        },
      ]);
      return "dialog";
    }
    if (message.type === "settled") {
      const before = items.length;
      removeById(message.id);
      return items.length === before ? "none" : "settle";
    }
    return "notice";
  },
  /** 作答。请求已被先行结算（或应答与方法不匹配）时本地一并出表。 */
  async answer(dialog: PendingUiDialog, answer: UiAnswerPayload): Promise<boolean> {
    const req: SessionUiRespondRequest = {
      sessionId: dialog.sessionId,
      id: dialog.id,
      value: answer.value,
      confirmed: answer.confirmed,
      cancelled: answer.cancelled,
    };
    let settled = false;
    try {
      settled = await sessionUiService.respond(req);
    } catch {
      settled = false;
    }
    if (!settled) removeById(dialog.id);
    return settled;
  },
};

/** 全部未答对话框（按到达顺序）。 */
export function usePendingUiDialogs(): readonly PendingUiDialog[] {
  return useSyncExternalStore(sessionUiStore.subscribe, sessionUiStore.get);
}

/** 挂着未答扩展对话框的会话集合（运行时 SessionId）；侧栏行状态用。 */
export function usePendingUiSessionIds(): ReadonlySet<string> {
  return useSyncExternalStore(sessionUiStore.subscribe, () => sessionIds);
}
