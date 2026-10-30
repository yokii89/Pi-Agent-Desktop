import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ThinkingLevelId } from "../../shared/ipc";
import { type ComposerFileAttachment, MAX_ATTACH_FILES } from "../utils/fileAttach";
import { type ComposerImageAttachment, MAX_ATTACH_IMAGES } from "../utils/imageAttach";
import { moveById } from "../utils/listReorder";

/**
 * 输入栏访问模式（docs/design/14）：芯片只是注册槽的呈现，
 * 「完全访问」为内建基线，其余模式由 pi 扩展经 access-mode 注册槽提供，
 * 状态真值在扩展侧（extensionViewStore.visibleAccessModes）。
 */

/** @ 引用的工作区文件。 */
export interface FileMention {
  /** 绝对路径。 */
  path: string;
  /** 相对项目根的展示路径（/ 分隔）。 */
  displayPath: string;
  /** 文件或文件夹（与候选栏图标一致）。 */
  kind?: "file" | "dir";
}

interface ComposerStoreValue {
  thinkingLevel: ThinkingLevelId;
  /** 当前模型可用档位；无存活会话（能力未知）时回退设计稿五档。 */
  thinkingLevels: ThinkingLevelId[];
  setThinkingLevel: (level: ThinkingLevelId) => void;
  /**
   * pi 真值回填（会话启动 / 切换 / 切模型 / thinking_level_changed）：
   * available 为空表示能力未知，只更新当前档位、保留现有档位集合。
   */
  syncThinkingState: (level: ThinkingLevelId, available: ThinkingLevelId[]) => void;
  /** 已选 @ 文件（空态/会话态共用；发送后清空）。 */
  fileMentions: FileMention[];
  addFileMention: (item: FileMention) => void;
  removeFileMention: (path: string) => void;
  clearFileMentions: () => void;
  /** 待发图片附件（docs/design/21）；发送后清空。 */
  imageAttachments: ComposerImageAttachment[];
  /** 追加附件；超出 MAX_ATTACH_IMAGES 返回 false。 */
  addImageAttachment: (item: ComposerImageAttachment) => boolean;
  removeImageAttachment: (id: string) => void;
  clearImageAttachments: () => void;
  /** 拖拽排序：把 fromId 挪到 toId 位置（docs/design/21 P2）。 */
  reorderImageAttachments: (fromId: string, toId: string) => void;
  /** 待发非图片文件附件（docs/design/25，路径引用）；发送后清空。 */
  fileAttachments: ComposerFileAttachment[];
  /** 追加文件附件；超限或路径重复返回 false。 */
  addFileAttachment: (item: ComposerFileAttachment) => boolean;
  removeFileAttachment: (id: string) => void;
  clearFileAttachments: () => void;
  reorderFileAttachments: (fromId: string, toId: string) => void;
  /**
   * 会话流「添加到对话栏」的待消费引用（docs/design/12）：
   * SessionView（划选工具条）与 TaskInput（持有 ComposerHandle）是兄弟组件，经此桥接；
   * seq 去重保证单次消费。 */
  pendingQuote: { text: string; seq: number } | null;
  quoteComposer: (text: string) => void;
  consumePendingQuote: () => void;
  /**
   * 待追加到编辑器末尾的纯文本（清空队列回填、停止时取回排队消息）。
   * SessionProvider 只持有状态，真正写入 contenteditable 由 TaskInput 消费。
   */
  pendingInsert: { text: string; seq: number } | null;
  appendToComposer: (text: string) => void;
  consumePendingInsert: () => void;
}

const ComposerStoreContext = createContext<ComposerStoreValue | null>(null);

/** pi 默认档位（DEFAULT_THINKING_LEVEL=medium）；五档里正好是中间位，不会默认落在顶档。 */
const DEFAULT_THINKING_LEVEL: ThinkingLevelId = "medium";

/** 无存活会话时不知道模型能力：回退设计稿的五档（低/中/高/极高/最高）。 */
export const THINKING_FALLBACK_LEVELS: ThinkingLevelId[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** 同一顺序的档位集合才复用旧引用，避免每次刷新都让整棵输入栏重渲染。 */
function sameLevels(a: ThinkingLevelId[], b: ThinkingLevelId[]): boolean {
  return a.length === b.length && a.every((level, i) => level === b[i]);
}

/** ComposerProvider 每轮渲染同步的最新思考档位，供组件外读取。 */
let currentThinkingLevel: ThinkingLevelId = DEFAULT_THINKING_LEVEL;

/**
 * 组件外读取当前思考档位。
 * sessionStore 在发送链路里冷启动成功后要补应用档位（docs/会话进程懒加载方案 §3.5），
 * 但它在 Provider 之外拿不到 Context，走这个模块级 getter。
 */
export function getComposerThinkingLevel(): ThinkingLevelId {
  return currentThinkingLevel;
}

/**
 * 输入栏偏好（思考档位 / @ 文件）。
 * 放在 SessionArea 之上的 Provider：空态↔会话态切换会卸载 TaskInput，
 * 偏好不应因此重置。
 */
export function ComposerProvider({ children }: { children: ReactNode }) {
  const [thinkingLevel, setThinkingLevelState] = useState<ThinkingLevelId>(DEFAULT_THINKING_LEVEL);
  const [thinkingLevels, setThinkingLevelsState] =
    useState<ThinkingLevelId[]>(THINKING_FALLBACK_LEVELS);
  currentThinkingLevel = thinkingLevel;
  const [fileMentions, setFileMentions] = useState<FileMention[]>([]);
  const [imageAttachments, setImageAttachments] = useState<ComposerImageAttachment[]>([]);
  // 同步镜像：add 要在同一调用栈内返回是否超限，不能依赖 setState 更新器
  const imageAttachmentsRef = useRef<ComposerImageAttachment[]>([]);
  const [fileAttachments, setFileAttachments] = useState<ComposerFileAttachment[]>([]);
  const fileAttachmentsRef = useRef<ComposerFileAttachment[]>([]);
  const [pendingQuote, setPendingQuote] = useState<{ text: string; seq: number } | null>(null);
  const quoteSeqRef = useRef(0);
  const [pendingInsert, setPendingInsert] = useState<{ text: string; seq: number } | null>(null);
  const insertSeqRef = useRef(0);

  const setThinkingLevel = useCallback((level: ThinkingLevelId) => {
    // 发送链路在组件外读模块级镜像；状态更新是异步的，这里先落镜像
    currentThinkingLevel = level;
    setThinkingLevelState(level);
  }, []);

  const syncThinkingState = useCallback((level: ThinkingLevelId, available: ThinkingLevelId[]) => {
    currentThinkingLevel = level;
    setThinkingLevelState(level);
    if (available.length > 0) {
      setThinkingLevelsState((prev) => (sameLevels(prev, available) ? prev : available));
    }
  }, []);

  const addFileMention = useCallback((item: FileMention) => {
    setFileMentions((prev) => {
      if (prev.some((m) => m.path === item.path)) return prev;
      return [...prev, item];
    });
  }, []);

  const removeFileMention = useCallback((path: string) => {
    setFileMentions((prev) => prev.filter((m) => m.path !== path));
  }, []);

  const clearFileMentions = useCallback(() => setFileMentions([]), []);

  const commitImageAttachments = useCallback((next: ComposerImageAttachment[]) => {
    imageAttachmentsRef.current = next;
    setImageAttachments(next);
  }, []);

  const addImageAttachment = useCallback(
    (item: ComposerImageAttachment) => {
      if (imageAttachmentsRef.current.length >= MAX_ATTACH_IMAGES) return false;
      commitImageAttachments([...imageAttachmentsRef.current, item]);
      return true;
    },
    [commitImageAttachments],
  );

  const removeImageAttachment = useCallback(
    (id: string) => {
      commitImageAttachments(imageAttachmentsRef.current.filter((item) => item.id !== id));
    },
    [commitImageAttachments],
  );

  const clearImageAttachments = useCallback(
    () => commitImageAttachments([]),
    [commitImageAttachments],
  );

  const reorderImageAttachments = useCallback(
    (fromId: string, toId: string) => {
      commitImageAttachments(moveById(imageAttachmentsRef.current, fromId, toId));
    },
    [commitImageAttachments],
  );

  const commitFileAttachments = useCallback((next: ComposerFileAttachment[]) => {
    fileAttachmentsRef.current = next;
    setFileAttachments(next);
  }, []);

  const addFileAttachment = useCallback(
    (item: ComposerFileAttachment) => {
      const current = fileAttachmentsRef.current;
      if (current.length >= MAX_ATTACH_FILES) return false;
      if (current.some((entry) => entry.path === item.path)) return false;
      commitFileAttachments([...current, item]);
      return true;
    },
    [commitFileAttachments],
  );

  const removeFileAttachment = useCallback(
    (id: string) => {
      commitFileAttachments(fileAttachmentsRef.current.filter((item) => item.id !== id));
    },
    [commitFileAttachments],
  );

  const clearFileAttachments = useCallback(
    () => commitFileAttachments([]),
    [commitFileAttachments],
  );

  const reorderFileAttachments = useCallback(
    (fromId: string, toId: string) => {
      commitFileAttachments(moveById(fileAttachmentsRef.current, fromId, toId));
    },
    [commitFileAttachments],
  );

  const quoteComposer = useCallback((text: string) => {
    quoteSeqRef.current += 1;
    setPendingQuote({ text, seq: quoteSeqRef.current });
  }, []);

  const consumePendingQuote = useCallback(() => setPendingQuote(null), []);

  const appendToComposer = useCallback((text: string) => {
    if (!text.trim()) return;
    insertSeqRef.current += 1;
    setPendingInsert({ text, seq: insertSeqRef.current });
  }, []);

  const consumePendingInsert = useCallback(() => setPendingInsert(null), []);

  const value = useMemo<ComposerStoreValue>(
    () => ({
      thinkingLevel,
      thinkingLevels,
      setThinkingLevel,
      syncThinkingState,
      fileMentions,
      addFileMention,
      removeFileMention,
      clearFileMentions,
      imageAttachments,
      addImageAttachment,
      removeImageAttachment,
      clearImageAttachments,
      reorderImageAttachments,
      fileAttachments,
      addFileAttachment,
      removeFileAttachment,
      clearFileAttachments,
      reorderFileAttachments,
      pendingQuote,
      quoteComposer,
      consumePendingQuote,
      pendingInsert,
      appendToComposer,
      consumePendingInsert,
    }),
    [
      thinkingLevel,
      thinkingLevels,
      setThinkingLevel,
      syncThinkingState,
      fileMentions,
      addFileMention,
      removeFileMention,
      clearFileMentions,
      imageAttachments,
      addImageAttachment,
      removeImageAttachment,
      clearImageAttachments,
      reorderImageAttachments,
      fileAttachments,
      addFileAttachment,
      removeFileAttachment,
      clearFileAttachments,
      reorderFileAttachments,
      pendingQuote,
      quoteComposer,
      consumePendingQuote,
      pendingInsert,
      appendToComposer,
      consumePendingInsert,
    ],
  );

  return <ComposerStoreContext.Provider value={value}>{children}</ComposerStoreContext.Provider>;
}

export function useComposerStore(): ComposerStoreValue {
  const ctx = useContext(ComposerStoreContext);
  if (!ctx) throw new Error("useComposerStore 必须在 ComposerProvider 内使用");
  return ctx;
}

/** 思考档位展示文案 key（与 pi 七档一一对应）；组件经 useT 解析。 */
export const THINKING_LABEL_KEY: Record<ThinkingLevelId, string> = {
  off: "session.thinking.off",
  minimal: "session.thinking.minimal",
  low: "session.thinking.low",
  medium: "session.thinking.medium",
  high: "session.thinking.high",
  xhigh: "session.thinking.xhigh",
  max: "session.thinking.max",
};
