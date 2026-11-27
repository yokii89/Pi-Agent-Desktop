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
  kind: "text" | "quote" | "focus";
  text: string;
}

export interface ComposerDraftContent {
  content: ComposerDraftPart[];
  fileMentions: FileMention[];
  imageAttachments: ComposerImageAttachment[];
  fileAttachments: ComposerFileAttachment[];
  chatElements: BrowserContextItem[];
}

export interface ComposerDraft extends ComposerDraftContent {
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

/** 入队时保留可编辑内容；不把发送锁或待消费的编辑操作带回输入栏。 */
export function snapshotComposerDraft(draft: ComposerDraftContent): ComposerDraftContent {
  return {
    content: draft.content.map((part) => ({ ...part })),
    fileMentions: [...draft.fileMentions],
    imageAttachments: [...draft.imageAttachments],
    fileAttachments: [...draft.fileAttachments],
    chatElements: [...draft.chatElements],
  };
}

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
  private browserRevision = 0;
  private readonly capturedElements = new WeakMap<BrowserContextItem, number>();
  private readonly restoredDrafts = new WeakSet<ComposerDraftContent>();

  constructor(private readonly notify: () => void) {}

  getSnapshot = (): ComposerDraft => this.snapshot;

  /** 记录引用采集时的导航版本，排队期间发生导航后取回也能保留过期状态。 */
  capture(): ComposerDraftContent {
    const content = snapshotComposerDraft(this.snapshot);
    for (const item of content.chatElements) {
      this.capturedElements.set(item, this.browserRevision);
    }
    return content;
  }

  markChatElementsStale(): void {
    this.browserRevision += 1;
    this.update((draft) =>
      draft.chatElements.some((item) => !item.stale)
        ? { ...draft, chatElements: draft.chatElements.map((item) => ({ ...item, stale: true })) }
        : draft,
    );
  }

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

  /** 撤回消息时合并完整草稿，保留用户随后输入的正文和附件。 */
  restore(recovered: ComposerDraftContent): void {
    if (this.restoredDrafts.has(recovered)) return;
    this.restoredDrafts.add(recovered);
    const contains = <T>(current: T[], incoming: T[], key: (item: T) => string): boolean => {
      const existing = new Set(current.map(key));
      return incoming.every((item) => existing.has(key(item)));
    };
    const merge = <T>(current: T[], incoming: T[], key: (item: T) => string): T[] => {
      const seen = new Set(current.map(key));
      return [
        ...current,
        ...incoming.filter((item) => {
          const id = key(item);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        }),
      ];
    };
    this.update((draft) => {
      const inlineFiles = new Set(
        draft.content.filter((part) => part.kind === "file").map((part) => part.path),
      );
      const inlineElements = new Set(
        draft.content.filter((part) => part.kind === "element").map((part) => part.id),
      );
      // 退出事件可能先于 queued 回执；原输入尚在时不能再追加一份，也不能让迟到回执清空它。
      const alreadyPresent =
        sameComposerContent(draft.content, recovered.content) &&
        contains(draft.fileMentions, recovered.fileMentions, (item) => item.path) &&
        contains(draft.imageAttachments, recovered.imageAttachments, (item) => item.id) &&
        contains(draft.fileAttachments, recovered.fileAttachments, (item) => item.path) &&
        contains(draft.chatElements, recovered.chatElements, (item) => item.id);
      const content = alreadyPresent
        ? []
        : recovered.content.filter(
            (part) =>
              (part.kind !== "file" || !inlineFiles.has(part.path)) &&
              (part.kind !== "element" || !inlineElements.has(part.id)),
          );
      return {
        ...draft,
        content: [
          ...draft.content,
          ...(draft.content.length > 0 && content.length > 0
            ? [{ kind: "text" as const, text: "\n\n" }]
            : []),
          ...content,
        ],
        fileMentions: merge(draft.fileMentions, recovered.fileMentions, (item) => item.path),
        imageAttachments: merge(
          draft.imageAttachments,
          recovered.imageAttachments,
          (item) => item.id,
        ),
        fileAttachments: merge(
          draft.fileAttachments,
          recovered.fileAttachments,
          (item) => item.path,
        ),
        chatElements: merge(
          draft.chatElements,
          recovered.chatElements.map((item) => {
            const revision = this.capturedElements.get(item);
            return revision !== undefined && revision < this.browserRevision
              ? { ...item, stale: true }
              : item;
          }),
          (item) => item.id,
        ),
        edits: [...draft.edits, { kind: "focus", text: "" }],
      };
    });
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
      draft.markChatElementsStale();
    }
  }
}
