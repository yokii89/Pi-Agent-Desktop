import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { terminalService } from "../services/terminalService";

export interface TerminalTab {
  id: string;
  title: string;
  cwd?: string;
  /** shell 进程已退出；Tab 保留以展示退出状态，由用户关闭或另起新终端。 */
  exited?: boolean;
  exitCode?: number;
}

interface TerminalStoreValue {
  tabs: TerminalTab[];
  activeTabId: string | null;
  activeTab: TerminalTab | null;
  /** 上限 MAX_TERMINAL_TABS 个实例；已满时返回 false。 */
  createTab: (cwd?: string) => Promise<boolean>;
  /** 结束指定实例的 pty 并移除 Tab（真正的进程销毁，区别于面板隐藏）。 */
  closeTab: (id: string) => void;
  /** 重命名指定 Tab 的显示标题；空标题忽略。 */
  renameTab: (id: string, title: string) => void;
  setActiveTab: (id: string) => void;
}

const TerminalStoreContext = createContext<TerminalStoreValue | null>(null);

export const MAX_TERMINAL_TABS = 4;

/** 底部终端 Tab 状态。每个 Tab 对应主进程一个 node-pty 实例（docs/design/03 §4）。 */
export function TerminalProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // 标题序号只增不减，避免关闭中间 Tab 后标题重复
  const titleSeqRef = useRef(0);
  const tabsRef = useRef<TerminalTab[]>([]);
  tabsRef.current = tabs;

  const createTab = useCallback(async (cwd?: string): Promise<boolean> => {
    if (tabsRef.current.length >= MAX_TERMINAL_TABS) return false;
    const id = await terminalService.create(cwd);
    if (!id) return false;
    const n = ++titleSeqRef.current;
    const tab: TerminalTab = {
      id,
      title: n === 1 ? "终端" : `终端 ${n}`,
      cwd,
    };
    // create 期间用户可能已关掉其它 Tab，基于最新列表追加
    setTabs((prev) => {
      if (prev.some((t) => t.id === id)) return prev;
      return [...prev, tab];
    });
    setActiveTabId(id);
    // shell 自然退出时仅标记状态（保留 Tab 展示退出码），进程由主进程回收
    terminalService.subscribeExit(id, (code) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, exited: true, exitCode: code } : t)),
      );
    });
    return true;
  }, []);

  const closeTab = useCallback((id: string) => {
    terminalService.dispose(id);
    setTabs((prev) => {
      const index = prev.findIndex((t) => t.id === id);
      if (index === -1) return prev;
      const remaining = prev.filter((t) => t.id !== id);
      setActiveTabId((current) =>
        current === id ? (remaining[index]?.id ?? remaining[index - 1]?.id ?? null) : current,
      );
      return remaining;
    });
  }, []);

  const renameTab = useCallback((id: string, title: string) => {
    const next = title.trim();
    if (!next) return;
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title: next } : t)));
  }, []);

  const value = useMemo<TerminalStoreValue>(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
    return {
      tabs,
      activeTabId,
      activeTab,
      createTab,
      closeTab,
      renameTab,
      setActiveTab: setActiveTabId,
    };
  }, [tabs, activeTabId, createTab, closeTab, renameTab]);

  return <TerminalStoreContext.Provider value={value}>{children}</TerminalStoreContext.Provider>;
}

export function useTerminalStore(): TerminalStoreValue {
  const ctx = useContext(TerminalStoreContext);
  if (!ctx) throw new Error("useTerminalStore 必须在 TerminalProvider 内使用");
  return ctx;
}
