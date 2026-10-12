/**
 * 底部终端面板的窗格模型（纯逻辑，不碰 React / IPC）。
 * tabs 是实例清单（每个对应主进程一个 pty），panes 是当前显示的窗格——
 * 单窗格时长度 1，分屏时长度 2；索引即位置（0 在前/左/上）。
 */

export interface TerminalTab {
  id: string;
  title: string;
  cwd?: string;
  /** shell 进程已退出；Tab 保留以展示退出状态，由用户关闭或另起新终端。 */
  exited?: boolean;
  exitCode?: number;
}

/** 分屏方向：row = 左右并排；column = 上下堆叠。 */
export type TerminalSplitDirection = "row" | "column";

export interface TerminalPaneState {
  tabs: TerminalTab[];
  panes: string[];
  /** 焦点窗格在 panes 中的下标：工具条高亮、「结束进程」与键盘输入都跟着它。 */
  focusedPane: number;
  /** 分屏方向；非 null 时 panes 恒为 2 项（不变量由 reducer 维持）。 */
  split: TerminalSplitDirection | null;
}

export const MAX_PANES = 2;

export const INITIAL_PANE_STATE: TerminalPaneState = {
  tabs: [],
  panes: [],
  focusedPane: 0,
  split: null,
};

/**
 * 进入分屏时要复用的实例：最近的未显示实例，优先未退出的（tabs 是追加序，取最后一个）。
 * 没有可复用的返回 null，调用方新建一个。
 */
export function pickSplitPartner(tabs: TerminalTab[], panes: string[]): TerminalTab | null {
  const others = tabs.filter((tab) => !panes.includes(tab.id));
  return [...others].reverse().find((tab) => !tab.exited) ?? others[others.length - 1] ?? null;
}

export type TerminalPaneAction =
  /** install=true 时把新实例装入焦点窗格；false 只入列（进入分屏时由 splitEntered 落位）。 */
  | { type: "tabAdded"; tab: TerminalTab; install: boolean }
  | { type: "tabActivated"; id: string }
  | { type: "tabClosed"; id: string }
  | { type: "tabExited"; id: string; exitCode: number }
  | { type: "tabRenamed"; id: string; title: string }
  | { type: "paneFocused"; index: number }
  | { type: "splitEntered"; direction: TerminalSplitDirection; secondary: string }
  | { type: "splitDirectionChanged"; direction: TerminalSplitDirection }
  | { type: "splitExited" };

export function terminalPaneReducer(
  state: TerminalPaneState,
  action: TerminalPaneAction,
): TerminalPaneState {
  switch (action.type) {
    case "tabAdded": {
      if (state.tabs.some((tab) => tab.id === action.tab.id)) return state;
      const tabs = [...state.tabs, action.tab];
      if (!action.install) return { ...state, tabs };
      const panes = state.panes.slice();
      panes[state.focusedPane] = action.tab.id;
      return { ...state, tabs, panes };
    }

    case "tabActivated": {
      const paneIndex = state.panes.indexOf(action.id);
      if (paneIndex !== -1) {
        // 目标已在某个窗格中：只把焦点交给它，不改变窗格内容（避免两窗格显示同一实例）
        return paneIndex === state.focusedPane ? state : { ...state, focusedPane: paneIndex };
      }
      if (!state.tabs.some((tab) => tab.id === action.id)) return state;
      const panes = state.panes.slice();
      panes[state.focusedPane] = action.id;
      return { ...state, panes };
    }

    case "tabClosed": {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index === -1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      const paneIndex = state.panes.indexOf(action.id);
      if (paneIndex === -1) return { ...state, tabs };
      if (tabs.length === 0) {
        return { tabs, panes: [], focusedPane: 0, split: null };
      }
      const others = state.panes.filter((_, i) => i !== paneIndex);
      // 落点优先取原 Tab 顺序里的邻居；另一个窗格正显示的实例不参与，避免两窗格显示同一实例
      const candidates = [tabs[index]?.id, tabs[index - 1]?.id, ...tabs.map((tab) => tab.id)];
      const fallback = candidates.find((id) => id !== undefined && !others.includes(id));
      if (fallback === undefined) {
        // 候选只剩另一个窗格里的实例：收起分屏，焦点交给它
        return { tabs, panes: others.slice(0, 1), focusedPane: 0, split: null };
      }
      const panes = others.slice();
      panes.splice(Math.min(paneIndex, panes.length), 0, fallback);
      // 落点插回原位置、另一窗格位置不变，故焦点下标不需要动
      return { ...state, tabs, panes, split: panes.length > 1 ? state.split : null };
    }

    case "tabExited":
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.id ? { ...tab, exited: true, exitCode: action.exitCode } : tab,
        ),
      };

    case "tabRenamed":
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.id ? { ...tab, title: action.title } : tab,
        ),
      };

    case "paneFocused":
      if (
        action.index === state.focusedPane ||
        action.index < 0 ||
        action.index >= state.panes.length
      ) {
        return state;
      }
      return { ...state, focusedPane: action.index };

    case "splitEntered": {
      if (state.split !== null) return state;
      if (state.panes.length === 0 || state.panes.length >= MAX_PANES) return state;
      if (state.panes.includes(action.secondary)) return state;
      if (!state.tabs.some((tab) => tab.id === action.secondary)) return state;
      // 焦点交给新窗格，与「新建终端装入焦点窗格」的既有约定一致
      return {
        ...state,
        split: action.direction,
        panes: [...state.panes, action.secondary],
        focusedPane: 1,
      };
    }

    case "splitDirectionChanged":
      if (state.split === null || state.split === action.direction) return state;
      return { ...state, split: action.direction };

    case "splitExited": {
      if (state.split === null) return state;
      const keep = state.panes[state.focusedPane] ?? state.panes[0];
      return { ...state, split: null, panes: keep ? [keep] : [], focusedPane: 0 };
    }
  }
}
