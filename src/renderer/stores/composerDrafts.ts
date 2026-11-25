import type { PromptDisposition } from "../../shared/ipc";
import type { BrowserContextItem } from "../services/browserService";
import type { ComposerFileAttachment } from "../utils/fileAttach";
import type { ComposerImageAttachment } from "../utils/imageAttach";
import type { FileMention } from "./composerStore";

/** 只保存可编辑内容的语义数据，恢复时重新创建芯片，不保存 HTML 或 DOM。 */
export type ComposerDraftPart =
  | { kind: "text"; text: string }
  | { kind: "file"; path: string }
  | { kind: "slash"; name: string }
  | { kind: "element"; id: string };

/** 对话区元素芯片上限，沿用浏览器拾取的有界保留规则。 */
export const MAX_CHAT_ELEMENTS = 12;

export interface ComposerDraftEdit {
  kind: "text" | "quote";
  text: string;
}

export interface ComposerDraft {
  content: ComposerDraftPart[];
  fileMentions: FileMention[];
  imageAttachments: ComposerImageAttachment[];
  fileAttachments: ComposerFileAttachment[];
  chatElements: BrowserContextItem[];
  edits: ComposerDraftEdit[];
  sending: boolean;
}

const EMPTY_DRAFT: ComposerDraft = {
  content: [],
  fileMentions: [],
  imageAttachments: [],
  fileAttachments: [],
  chatElements: [],
  edits: [],
  sending: false,
};

/** 首页按项目隔离；会话按运行时桶隔离，认领 JSONL 不改变草稿身份。 */
export function composerDraftKey(
  sessionId: string | null,
  cwd: string | null,
  phase?: "empty" | "running" | "idle",
): string {
  return sessionId === null || phase === "empty" ? `home:${cwd ?? ""}` : `session:${sessionId}`;
}

/** 忽略 DOM 文本节点拆分产生的重复上报，避免编辑一字就重建选区。 */
export function sameComposerContent(a: ComposerDraftPart[], b: ComposerDraftPart[]): boolean {
  return (
    a.length === b.length &&
    a.every((part, index) => {
      const other = b[index];
      switch (part.kind) {
        case "text":
          return other.kind === "text" && part.text === other.text;
        case "file":
          return other.kind === "file" && part.path === other.path;
        case "slash":
          return other.kind === "slash" && part.name === other.name;
        case "element":
          return other.kind === "element" && part.id === other.id;
        default:
          return false;
      }
    })
  );
}

/** 回调绑定草稿对象而非可复用的首页 key，迁移后迟到的回执/附件仍归原会话。 */
export class ComposerDraftHandle {
  private snapshot = EMPTY_DRAFT;
  private submitting = false;

  constructor(private readonly notify: () => void) {}

  getSnapshot = (): ComposerDraft => this.snapshot;

  update = (update: (draft: ComposerDraft) => ComposerDraft): void => {
    const next = update(this.snapshot);
    if (next === this.snapshot) return;
    this.snapshot = next;
    this.notify();
  };

  addChatElement(item: BrowserContextItem): void {
    this.update((draft) => {
      if (draft.chatElements.some((entry) => entry.id === item.id)) return draft;
      const chatElements = [...draft.chatElements, { ...item, attached: true }].slice(
        -MAX_CHAT_ELEMENTS,
      );
      const alive = new Set(chatElements.map((entry) => entry.id));
      return {
        ...draft,
        chatElements,
        content: draft.content.filter((part) => part.kind !== "element" || alive.has(part.id)),
      };
    });
  }

  removeChatElement(id: string): void {
    this.update((draft) =>
      draft.chatElements.some((item) => item.id === id)
        ? {
            ...draft,
            chatElements: draft.chatElements.filter((item) => item.id !== id),
            content: draft.content.filter((part) => part.kind !== "element" || part.id !== id),
          }
        : draft,
    );
  }

  clearChatElements(): void {
    this.update((draft) =>
      draft.chatElements.length > 0
        ? {
            ...draft,
            chatElements: [],
            content: draft.content.filter((part) => part.kind !== "element"),
          }
        : draft,
    );
  }

  enqueue(edit: ComposerDraftEdit): void {
    if (!edit.text.trim()) return;
    this.update((draft) => ({ ...draft, edits: [...draft.edits, edit] }));
  }

  /** 原子取出：StrictMode 重放与多个回填结果不会重复消费或互相覆盖。 */
  takeEdits = (): ComposerDraftEdit[] => {
    const edits = this.snapshot.edits;
    if (edits.length > 0) this.update((draft) => ({ ...draft, edits: [] }));
    return edits;
  };

  /** pi 受理后才清空；等待期间的编辑、切页与其它会话草稿不受回执影响。 */
  submit = async (send: () => Promise<PromptDisposition | null>): Promise<boolean> => {
    if (this.submitting) return false;
    this.submitting = true;
    const pending = { ...this.snapshot, sending: true };
    this.update(() => pending);
    try {
      const accepted = await send();
      if (accepted === null) return false;
      if (this.snapshot === pending) this.update(() => EMPTY_DRAFT);
      return true;
    } finally {
      this.submitting = false;
      this.update((current) => (current.sending ? { ...current, sending: false } : current));
    }
  };
}

/** 窗口内存中的会话草稿；切页/卸载不丢失，不把未发送正文或图片写入磁盘。 */
export class ComposerDraftStore {
  private readonly drafts = new Map<string, ComposerDraftHandle>();
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify = (): void => {
    for (const listener of this.listeners) listener();
  };

  /** 在异步操作开始时绑定；之后即使原 key 被新任务复用，也不重定向写入。 */
  bind(key: string): ComposerDraftHandle {
    let draft = this.drafts.get(key);
    if (!draft) {
      draft = new ComposerDraftHandle(this.notify);
      this.drafts.set(key, draft);
    }
    return draft;
  }

  get = (key: string): ComposerDraft => this.drafts.get(key)?.getSnapshot() ?? EMPTY_DRAFT;

  update(key: string, update: (draft: ComposerDraft) => ComposerDraft): void {
    this.bind(key).update(update);
  }

  /** 首页启动成功或临时桶换权威 id 时，迁移同一草稿对象；失败不迁移首页。 */
  move(from: string, to: string, expected?: ComposerDraftHandle): boolean {
    if (from === to) return true;
    const source = this.drafts.get(from);
    if (!source || (expected && source !== expected)) return false;
    const target = this.drafts.get(to);
    if (target && target.getSnapshot() !== EMPTY_DRAFT) return false;
    this.drafts.set(to, source);
    this.drafts.delete(from);
    this.notify();
    return true;
  }

  submit(key: string, send: () => Promise<PromptDisposition | null>): Promise<boolean> {
    return this.bind(key).submit(send);
  }

  /** 浏览器发生真实导航时，所有会话中引用旧页面的元素都应标记过期。 */
  markChatElementsStale(): void {
    for (const draft of this.drafts.values()) {
      draft.update((current) =>
        current.chatElements.some((item) => !item.stale)
          ? {
              ...current,
              chatElements: current.chatElements.map((item) => ({ ...item, stale: true })),
            }
          : current,
      );
    }
  }
}
