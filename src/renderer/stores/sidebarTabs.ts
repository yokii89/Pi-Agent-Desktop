/**
 * 右侧栏页签状态机的纯逻辑（无 React / 无 DOM），供 uiStore reducer 与单测共用。
 *
 * 页签身份统一为 `ext:<panelId>`；关闭扩展页签只隐藏 live View，不发送 dismiss。
 */
export type RightSidebarTab = "review" | "files" | "browser" | `ext:${string}`;

export interface SidebarTabsState {
  rightSidebarOpen: boolean;
  rightSidebarTabs: RightSidebarTab[];
  /** null = 启动页（一级界面）。 */
  rightSidebarTab: RightSidebarTab | null;
  /** 用户手动关闭过的扩展 panelId：阻止 live 重注册时自动抢回页签。 */
  hiddenSidebarPanelIds: string[];
}

export function extensionPanelIdOf(tab: RightSidebarTab): string | null {
  return tab.startsWith("ext:") ? tab.slice("ext:".length) : null;
}

/**
 * 打开页签：已存在则只聚焦；扩展页签同时解除「用户手动关闭」的抑制。
 * 无变化时返回原对象，调用方可用引用相等跳过提交。
 */
export function openSidebarTab(state: SidebarTabsState, tab: RightSidebarTab): SidebarTabsState {
  const panelId = extensionPanelIdOf(tab);
  const wasHidden = panelId !== null && state.hiddenSidebarPanelIds.includes(panelId);
  const tabs = state.rightSidebarTabs.includes(tab)
    ? state.rightSidebarTabs
    : [...state.rightSidebarTabs, tab];
  const hidden = wasHidden
    ? state.hiddenSidebarPanelIds.filter((id) => id !== panelId)
    : state.hiddenSidebarPanelIds;
  if (
    tabs === state.rightSidebarTabs &&
    state.rightSidebarTab === tab &&
    state.rightSidebarOpen &&
    !wasHidden
  ) {
    return state;
  }
  return {
    ...state,
    rightSidebarOpen: true,
    rightSidebarTabs: tabs,
    rightSidebarTab: tab,
    hiddenSidebarPanelIds: hidden,
  };
}

/**
 * 关闭页签：右侧相邻页签接管焦点，没有则左侧；全部关完回启动页（active=null）。
 * 扩展页签关闭只把 panelId 记入抑制列表，live View 由调用方继续保留。
 */
export function closeSidebarTab(state: SidebarTabsState, tab: RightSidebarTab): SidebarTabsState {
  const index = state.rightSidebarTabs.indexOf(tab);
  if (index < 0) return state;
  const tabs = state.rightSidebarTabs.filter((item) => item !== tab);
  const active =
    state.rightSidebarTab === tab
      ? (tabs[index] ?? tabs[index - 1] ?? null)
      : state.rightSidebarTab;
  const panelId = extensionPanelIdOf(tab);
  const hidden =
    panelId === null || state.hiddenSidebarPanelIds.includes(panelId)
      ? state.hiddenSidebarPanelIds
      : [...state.hiddenSidebarPanelIds, panelId];
  return {
    ...state,
    rightSidebarTabs: tabs,
    rightSidebarTab: active,
    hiddenSidebarPanelIds: hidden,
  };
}
