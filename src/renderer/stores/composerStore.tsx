import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import type { ThinkingLevelId } from "../../shared/ipc";
import { ComposerDraftStore } from "./composerDrafts";

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
  /** 首页与各会话独立的未发送正文、引用和附件。 */
  drafts: ComposerDraftStore;
  /** 将引用排入目标草稿；目标未显示时保留，返回后由输入框消费。 */
  quoteComposer: (text: string, key: string) => void;
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

/** 输入栏偏好与草稿放在 SessionArea 之上，切页和输入栏卸载不清除未发送内容。 */
export function ComposerProvider({ children }: { children: ReactNode }) {
  const [thinkingLevel, setThinkingLevelState] = useState<ThinkingLevelId>(DEFAULT_THINKING_LEVEL);
  const [thinkingLevels, setThinkingLevelsState] =
    useState<ThinkingLevelId[]>(THINKING_FALLBACK_LEVELS);
  currentThinkingLevel = thinkingLevel;
  const [drafts] = useState(() => new ComposerDraftStore());

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

  const quoteComposer = useCallback(
    (text: string, key: string) => {
      drafts.bind(key).enqueue({ kind: "quote", text });
    },
    [drafts],
  );

  const value = useMemo<ComposerStoreValue>(
    () => ({
      thinkingLevel,
      thinkingLevels,
      setThinkingLevel,
      syncThinkingState,
      drafts,
      quoteComposer,
    }),
    [thinkingLevel, thinkingLevels, setThinkingLevel, syncThinkingState, drafts, quoteComposer],
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
