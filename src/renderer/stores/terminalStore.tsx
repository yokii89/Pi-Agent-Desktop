import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { terminalService } from "../services/terminalService";
import {
  INITIAL_PANE_STATE,
  pickSplitPartner,
  type TerminalSplitDirection,
  type TerminalTab,
  terminalPaneReducer,
} from "./terminalPanes";

interface TerminalStoreValue {
  tabs: TerminalTab[];
  activeTabId: string | null;
  activeTab: TerminalTab | null;
  /** 窗格中的终端 id，索引即位置（0 在前/左/上）；长度 1 = 单窗格，2 = 分屏。 */
  panes: string[];
  /** 焦点窗格在 panes 中的下标。 */
  focusedPane: number;
  /** 分屏方向；null = 单窗格。 */
  split: TerminalSplitDirection | null;
  /** 上限 MAX_TERMINAL_TABS 个实例；已满时返回 false。 */
  createTab: (cwd?: string) => Promise<boolean>;
  /** 结束指定实例的 pty 并移除 Tab（真正的进程销毁，区别于面板隐藏）。 */
  closeTab: (id: string) => void;
  /** 重命名指定 Tab 的显示标题；空标题忽略。 */
  renameTab: (id: string, title: string) => void;
  /** 工具条点击：目标已在某个窗格则把焦点交给它，否则装入焦点窗格。 */
  setActiveTab: (id: string) => void;
  /** 分屏开关：同方向再点收起、另一方向则换向、未分屏则进入（无可复用实例时先新建）。 */
  toggleSplit: (direction: TerminalSplitDirection, cwd?: string) => Promise<void>;
  /** 点击窗格：把焦点交给它。 */
  focusPane: (index: number) => void;
}

const TerminalStoreContext = createContext<TerminalStoreValue | null>(null);

export const MAX_TERMINAL_TABS = 4;

/** 底部终端 Tab 状态。每个 Tab 对应主进程一个 node-pty 实例（docs/design/03 §4）。 */
export function TerminalProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(terminalPaneReducer, INITIAL_PANE_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  // 标题序号只增不减，避免关闭中间 Tab 后标题重复
  const titleSeqRef = useRef(0);

  /** 新建 pty 并登记 Tab；install=false 时只入列，落位交给后续的 splitEntered。 */
  const addTab = useCallback(
    async (cwd: string | undefined, install: boolean): Promise<TerminalTab | null> => {
      if (stateRef.current.tabs.length >= MAX_TERMINAL_TABS) return null;
      const id = await terminalService.create(cwd);
      if (!id) return null;
      const n = ++titleSeqRef.current;
      const tab: TerminalTab = {
        id,
        title: n === 1 ? "终端" : `终端 ${n}`,
        cwd,
      };
      // create 期间用户可能已关掉其它 Tab，reducer 基于最新列表追加
      dispatch({ type: "tabAdded", tab, install });
      // shell 自然退出时仅标记状态（保留 Tab 展示退出码），进程由主进程回收
      terminalService.subscribeExit(id, (exitCode) =>
        dispatch({ type: "tabExited", id, exitCode }),
      );
      return tab;
    },
    [],
  );

  const createTab = useCallback(
    async (cwd?: string): Promise<boolean> => (await addTab(cwd, true)) !== null,
    [addTab],
  );

  const closeTab = useCallback((id: string) => {
    terminalService.dispose(id);
    dispatch({ type: "tabClosed", id });
  }, []);

  const renameTab = useCallback((id: string, title: string) => {
    const next = title.trim();
    if (!next) return;
    dispatch({ type: "tabRenamed", id, title: next });
  }, []);

  const setActiveTab = useCallback((id: string) => {
    dispatch({ type: "tabActivated", id });
  }, []);

  const focusPane = useCallback((index: number) => {
    dispatch({ type: "paneFocused", index });
  }, []);

  const toggleSplit = useCallback(
    async (direction: TerminalSplitDirection, cwd?: string): Promise<void> => {
      const current = stateRef.current;
      if (current.split === direction) {
        dispatch({ type: "splitExited" });
        return;
      }
      if (current.split !== null) {
        dispatch({ type: "splitDirectionChanged", direction });
        return;
      }
      if (current.panes.length === 0) return;
      // 复用最近的未显示实例（优先未退出的）；没有可复用的才新建一个
      const candidate = pickSplitPartner(current.tabs, current.panes);
      if (candidate) {
        dispatch({ type: "splitEntered", direction, secondary: candidate.id });
        return;
      }
      const tab = await addTab(cwd, false);
      if (tab) dispatch({ type: "splitEntered", direction, secondary: tab.id });
    },
    [addTab],
  );

  const value = useMemo<TerminalStoreValue>(() => {
    const activeTabId = state.panes[state.focusedPane] ?? null;
    return {
      tabs: state.tabs,
      activeTabId,
      activeTab: state.tabs.find((tab) => tab.id === activeTabId) ?? null,
      panes: state.panes,
      focusedPane: state.focusedPane,
      split: state.split,
      createTab,
      closeTab,
      renameTab,
      setActiveTab,
      toggleSplit,
      focusPane,
    };
  }, [state, createTab, closeTab, renameTab, setActiveTab, toggleSplit, focusPane]);

  return <TerminalStoreContext.Provider value={value}>{children}</TerminalStoreContext.Provider>;
}

export function useTerminalStore(): TerminalStoreValue {
  const ctx = useContext(TerminalStoreContext);
  if (!ctx) throw new Error("useTerminalStore 必须在 TerminalProvider 内使用");
  return ctx;
}
