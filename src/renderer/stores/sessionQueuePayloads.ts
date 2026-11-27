import { t } from "../../shared/i18n";
import type {
  PiImageContent,
  PiQueuedMessages,
  PromptDisposition,
  QueueIntent,
} from "../../shared/ipc";
import { attachmentFromBase64, type UserMessageImage } from "../utils/imageAttach";
import { parseSteerCommand } from "../utils/steerCommand";
import type { ComposerDraftContent, ComposerDraftHandle } from "./composerDrafts";

export interface QueuedMessage {
  text: string;
  intent: QueueIntent;
  images?: PiImageContent[];
  displayImages?: UserMessageImage[];
  draft?: ComposerDraftContent;
}

export interface QueueItems<T> {
  steering: T[];
  followUp: T[];
}

export type QueuedMessagePayloads = QueueItems<QueuedMessage>;

type QueueKey = keyof PiQueuedMessages;
const QUEUE_KEYS: QueueKey[] = ["steering", "followUp"];
const empty = (): QueuedMessagePayloads => ({ steering: [], followUp: [] });

interface PendingMessage {
  message: QueuedMessage;
  accepted: boolean;
}

interface SessionQueue {
  current: QueuedMessagePayloads;
  pending: QueueItems<PendingMessage>;
  clearing: { removed: QueuedMessagePayloads; emptied: boolean } | null;
  closed: boolean;
}

/** pi 的队列 RPC 只有文本；完整草稿和图片仅在所属会话的窗口内存中保留。 */
export class SessionQueuePayloads {
  private readonly sessions = new Map<string, SessionQueue>();

  private session(id: string): SessionQueue {
    let queue = this.sessions.get(id);
    if (!queue) {
      queue = {
        current: empty(),
        pending: { steering: [], followUp: [] },
        clearing: null,
        closed: false,
      };
      this.sessions.set(id, queue);
    }
    return queue;
  }

  /** 先登记再调用 IPC：queue_update 可以先于 prompt 的受理回执到达。 */
  async submit(
    id: string,
    message: QueuedMessage,
    send: () => Promise<PromptDisposition>,
  ): Promise<PromptDisposition> {
    const queue = this.session(id);
    const key = message.intent === "steer" ? "steering" : "followUp";
    const pending = { message, accepted: false };
    queue.pending[key].push(pending);
    let queued = false;
    try {
      const disposition = await send();
      if (disposition === "queued" && queue.closed) {
        throw new Error(t("session.queue.processExited"));
      }
      queued = disposition === "queued";
      pending.accepted = queued;
      return disposition;
    } finally {
      // 已受理但尚未到达的队列事件仍可认领；其它结果不能污染下一条消息。
      if (!queued) {
        const index = queue.pending[key].indexOf(pending);
        if (index >= 0) queue.pending[key].splice(index, 1);
      }
    }
  }

  /** 按 FIFO 对齐全量快照，重复正文的不同图片不会共用同一份载荷。 */
  update(id: string, snapshot: PiQueuedMessages): QueuedMessage[] {
    const queue = this.session(id);
    const removed: QueuedMessage[] = [];
    for (const key of QUEUE_KEYS) {
      const before = queue.current[key];
      const texts = snapshot[key];
      let overlap = Math.min(before.length, texts.length);
      while (
        overlap > 0 &&
        !before.slice(before.length - overlap).every((item, index) => item.text === texts[index])
      ) {
        overlap -= 1;
      }
      const dropped = before.slice(0, before.length - overlap);
      removed.push(...dropped);
      queue.clearing?.removed[key].push(...dropped);
      queue.current[key] = [
        ...before.slice(before.length - overlap),
        ...texts.slice(overlap).map((text): QueuedMessage => {
          const pending = queue.pending[key];
          let index = pending.findIndex((item) => item.message.text === text);
          // pi 会在入队前展开技能/模板；此时保留原始可编辑草稿而使用展开后的队列正文。
          if (index < 0 && pending.length === 1 && pending[0].message.text.startsWith("/")) {
            index = 0;
          }
          const local = index >= 0 ? pending.splice(index, 1)[0].message : undefined;
          return local
            ? { ...local, text }
            : { text, intent: key === "steering" ? "steer" : "followUp" };
        }),
      ];
    }
    if (queue.clearing && snapshot.steering.length + snapshot.followUp.length === 0) {
      queue.clearing.emptied = true;
    }
    return removed;
  }

  beginClear(id: string): void {
    this.session(id).clearing = { removed: empty(), emptied: false };
  }

  /** 用 clear_queue 实际取回的后缀对账，排除往返期间已交付的队首消息。 */
  finishClear(id: string, snapshot: PiQueuedMessages): QueuedMessagePayloads {
    const queue = this.sessions.get(id);
    if (!queue) throw new Error(t("session.queue.processExited"));
    const result = empty();
    for (const key of QUEUE_KEYS) {
      const removed = queue.clearing?.removed[key] ?? [];
      const candidates = queue.clearing?.emptied ? removed : [...removed, ...queue.current[key]];
      let end = candidates.length;
      const taken = new Set<QueuedMessage>();
      for (let index = snapshot[key].length - 1; index >= 0; index -= 1) {
        const text = snapshot[key][index];
        let found = end - 1;
        while (found >= 0 && candidates[found].text !== text) found -= 1;
        const message = found >= 0 ? candidates[found] : undefined;
        if (message) {
          end = found;
          taken.add(message);
        }
        result[key].unshift(message ?? { text, intent: key === "steering" ? "steer" : "followUp" });
      }
      queue.current[key] = queue.current[key].filter((item) => !taken.has(item));
    }
    queue.clearing = null;
    return result;
  }

  /** 未见清空快照的收缩属于交付；已清空但 RPC 失败时状态不明，保留给用户确认。 */
  cancelClear(id: string): { delivered: QueuedMessage[]; recovered: QueuedMessage[] } {
    const queue = this.sessions.get(id);
    const clearing = queue?.clearing;
    if (queue) queue.clearing = null;
    if (!clearing) return { delivered: [], recovered: [] };
    const removed = [...clearing.removed.steering, ...clearing.removed.followUp];
    return clearing.emptied
      ? { delivered: [], recovered: removed }
      : { delivered: removed, recovered: [] };
  }

  /** 进程退出前取回未交付及清空结果未确认的消息；关闭状态同时废止迟到的受理回执。 */
  release(id: string): QueuedMessage[] {
    const queue = this.sessions.get(id);
    if (!queue) return [];
    const messages = [
      ...(queue.clearing?.removed.steering ?? []),
      ...queue.current.steering,
      ...queue.pending.steering.filter((item) => item.accepted).map((item) => item.message),
      ...(queue.clearing?.removed.followUp ?? []),
      ...queue.current.followUp,
      ...queue.pending.followUp.filter((item) => item.accepted).map((item) => item.message),
    ];
    this.delete(id);
    return messages;
  }

  delete(id: string): void {
    const queue = this.sessions.get(id);
    if (queue) queue.closed = true;
    this.sessions.delete(id);
  }
}

/** 改变排队类型后，撤回的可编辑 /steer 前缀也必须与当前队列一致。 */
export function withQueueIntent(message: QueuedMessage, intent: QueueIntent): QueuedMessage {
  if (message.intent === intent || !message.draft) return { ...message, intent };
  const content = [...message.draft.content];
  while (content[0]?.kind === "text" && !content[0].text.trim()) content.shift();
  const first = content[0];
  if (first?.kind === "slash" && first.name.toLowerCase() === "steer") content.shift();
  else if (first?.kind === "text")
    content[0] = { ...first, text: parseSteerCommand(first.text).text };
  if (intent === "steer") content.unshift({ kind: "text", text: "/steer " });
  return { ...message, intent, draft: { ...message.draft, content } };
}

/** 没有本地草稿的旁路发送仍能从原始图片载荷恢复可再次发送的附件。 */
export function restoreQueuedMessages(draft: ComposerDraftHandle, messages: QueuedMessage[]): void {
  for (const message of messages) {
    if (message.draft) {
      draft.restore(message.draft);
    } else {
      draft.restore({
        content: message.text ? [{ kind: "text", text: message.text }] : [],
        fileMentions: [],
        imageAttachments: (message.images ?? []).map((image, index) =>
          attachmentFromBase64(image.data, image.mimeType, message.displayImages?.[index]?.name),
        ),
        fileAttachments: [],
        chatElements: [],
      });
    }
  }
}
