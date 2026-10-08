import {
  createContext,
  type Dispatch,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import {
  type FontMonoPreset,
  type FontUiPreset,
  normalizeFontMonoPreset,
  normalizeFontUiPreset,
  resolveFontMonoStack,
  resolveFontUiStack,
} from "../../shared/fontPresets";
import {
  type LocaleId,
  type LocalePreference,
  normalizeLocalePreference,
  resolveLocale,
  setI18nLocale,
} from "../../shared/i18n";
import { clampSessionStreamFontPx, DEFAULT_SESSION_STREAM_FONT_PX } from "../../shared/ipc";
import { DEFAULT_RAIL_STYLE, normalizeRailStyle, type RailStyle } from "../../shared/railStyles";
import { normalizeShortcutsMap, type ShortcutsMap } from "../../shared/shortcuts";
import {
  BINDABLE_ACTION_IDS,
  type BindableActionId,
  DEFAULT_SHORTCUTS,
  SHORTCUT_BINDINGS,
} from "../actions/actionRegistry";
import { browserService } from "../services/browserService";
import { settingsService } from "../services/settingsService";

/** 页面级路由目标（渲染层内部路由）；设置已改为浮窗，不进路由栈。 */
export type PageId = "session" | "extensions" | "scheduled" | "mcp";

/** 右侧上下文侧栏的 Tab（终端已独立为中央工作区底部面板）。`ext:<panelId>` 为扩展 View panel；`cat:<panelId>` 为 Catalog 未连接占位。 */
export type RightSidebarTab = "review" | "files" | "browser" | `ext:${string}` | `cat:${string}`;

/** 代码审查的承载形态：停靠在右侧边栏（默认），或独立非模态浮窗。 */
export type ReviewSurfaceMode = "docked" | "float";

/**
 * 浏览器面板内的二级 Tab（docs/design/06 §3.2）。
 * 属**布局态**（决定哪块区域可见），与 `rightSidebarTab` 同层，因此放 uiStore
 * 而不是浏览器业务 store。
 */
export type BrowserPanelTab = "pick" | "styles" | "boxModel" | "dom";

/** 底部终端面板默认高度（px），可拖拽调整。 */
const TERMINAL_PANEL_DEFAULT_HEIGHT = 280;

/**
 * 浏览器面板检查器区默认高度（px）。
 * 与终端面板同一策略：拖拽中写局部 state、松手一次提交 store；不做持久化。
 */
const INSPECTOR_PANE_DEFAULT_HEIGHT = 220;

/** 检查器区在侧栏窄于该宽度时给出「加宽侧栏」提示（06 §3.2 R1）。 */
export const INSPECTOR_WIDEN_HINT_WIDTH = 320;
/** 侧栏窄于该宽度时检查器进入降级布局。 */
export const INSPECTOR_COMPACT_WIDTH = 300;
/** 「加宽侧栏」按钮的一次性目标宽度。 */
export const INSPECTOR_WIDEN_TARGET_WIDTH = 380;

/** 右侧上下文侧栏默认宽度（px），可拖拽调整；与 tokens.css 的 --context-sidebar-width 保持一致。 */
const RIGHT_SIDEBAR_DEFAULT_WIDTH = 300;

export type Theme = "dark" | "light";

/** 次级档相对正文的固定差值（tokens：md16 → sm14）。 */
const SESSION_STREAM_FONT_SM_DELTA = 2;

/** 把对话流字号写到根元素 CSS 变量；sm 与工具展开区由 md 推导。 */
function applySessionStreamFont(px: number): void {
  const root = document.documentElement;
  root.style.setProperty("--session-stream-font-md", `${px}px`);
  root.style.setProperty("--session-stream-font-sm", `${px - SESSION_STREAM_FONT_SM_DELTA}px`);
}

/** 把界面 / 等宽字体栈写到根元素；组件已统一引用 --font-family-*。 */
function applyFontFamilies(uiPreset: FontUiPreset, monoPreset: FontMonoPreset): void {
  const root = document.documentElement;
  root.style.setProperty("--font-family-ui", resolveFontUiStack(uiPreset));
  root.style.setProperty("--font-family-mono", resolveFontMonoStack(monoPreset));
}

/** Toast 的可选快捷动作（如「重载会话」）；点击后执行并立即收起提示。 */
export interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastState {
  id: number;
  message: string;
  action?: ToastAction;
}

interface UiState {
  page: PageId;
  backStack: PageId[];
  forwardStack: PageId[];
  navCollapsed: boolean;
  theme: Theme;
  /** 设置里的语言偏好（system / 固定语言）。 */
  localePreference: LocalePreference;
  /** 当前实际生效的界面语言。 */
  locale: LocaleId;
  /** 右侧上下文侧栏（审查/文件/浏览器）是否展开。 */
  rightSidebarOpen: boolean;
  /** 右侧上下文侧栏当前 Tab；收起时保留，重新展开回到原 Tab。 */
  rightSidebarTab: RightSidebarTab;
  /** 右侧上下文侧栏宽度（px），拖拽左缘把手调整；经 .app 根元素覆盖 --context-sidebar-width。 */
  rightSidebarWidth: number;
  /** 底部终端面板是否展开。仅控制可见性，终端进程生命周期独立（隐藏 ≠ kill）。 */
  terminalPanelVisible: boolean;
  /** 底部终端面板高度（px）。 */
  terminalPanelHeight: number;
  /** 浏览器面板检查器区的二级 Tab。 */
  browserPanelTab: BrowserPanelTab;
  /** 浏览器面板检查器区高度（px）。 */
  inspectorPaneHeight: number;
  /** 检查器区是否收起（只保留 tab 条）。 */
  inspectorPaneCollapsed: boolean;
  /** 检查器是否已浮出为系统级窗口（docs/design/38）；停靠区显示占位条。 */
  inspectorFloatOpen: boolean;
  /** 递增计数：Ctrl+P 时驱动文件搜索框聚焦。 */
  fileSearchTick: number;
  /**
   * 会话区 FileLink 等发起的「在文件面板打开」请求（命令信号，非预览态本身）。
   * path 为原文（可相对/带 :line），解析与预览由 FilePanel 消费。
   */
  fileOpenRequest: { path: string; tick: number } | null;
  /**
   * 「在文件树中定位」请求（命令信号）：文件面板目录命中 → 树内展开祖先链 + 滚动定位。
   * path 为绝对路径，由 FileTree 消费。
   */
  fileRevealRequest: { path: string; tick: number } | null;
  /** 设置浮窗是否打开（覆盖层，不占用中央路由）。 */
  settingsOpen: boolean;
  toast: ToastState | null;
  /** 设置是否已从磁盘恢复；恢复后主题/折叠态的变化才会回写。 */
  hydrated: boolean;
  /** 内置浏览器面板是否启用（设置「常规 → Browser 插件」）。 */
  browserEnabled: boolean;
  /** 欢迎界面是否显示最近会话（历史记录）入口（设置「常规 → 会话」）；默认关闭。 */
  welcomeRecentsEnabled: boolean;
  /** LLM 对话流正文字号（px），写入 `--session-stream-font-md`。 */
  sessionStreamFontPx: number;
  /** 界面字体预设，写入 `--font-family-ui`。 */
  fontUiPreset: FontUiPreset;
  /** 等宽字体预设，写入 `--font-family-mono`。 */
  fontMonoPreset: FontMonoPreset;
  /** 对话流问题导航分段栏的标记样式（设置 → 个性化）。 */
  questionRailStyle: RailStyle;
  /** 全局快捷键映射（设置 → 键盘快捷键）。 */
  shortcuts: ShortcutsMap;
  /** 命令面板浮层是否打开（Ctrl+Shift+P）。 */
  commandPaletteOpen: boolean;
  /** 代码审查浮窗是否打开（仅浮窗形态下有意义；停靠形态的可见性 = rightSidebarTab === "review"）。 */
  reviewWindowOpen: boolean;
  /** 代码审查的承载形态：停靠侧栏 / 浮窗。 */
  reviewMode: ReviewSurfaceMode;
}

type UiAction =
  | { type: "navigate"; page: PageId }
  | { type: "back" }
  | { type: "forward" }
  | { type: "toggleNavCollapsed" }
  | { type: "setTheme"; theme: Theme }
  | { type: "setLocalePreference"; preference: LocalePreference }
  | { type: "setRightSidebar"; open: boolean; tab?: RightSidebarTab }
  | { type: "setRightSidebarWidth"; width: number }
  | { type: "toggleRightSidebar" }
  | { type: "toggleTerminalPanel" }
  | { type: "setTerminalPanelHeight"; height: number }
  | { type: "setBrowserPanelTab"; tab: BrowserPanelTab }
  | { type: "setInspectorPaneHeight"; height: number }
  | { type: "toggleInspectorPaneCollapsed" }
  | { type: "setInspectorFloatOpen"; open: boolean }
  | { type: "openFilesPanel" }
  | { type: "openFileInPanel"; path: string }
  | { type: "revealInFilePanel"; path: string }
  | { type: "setSettingsOpen"; open: boolean }
  | { type: "showToast"; message: string; action?: ToastAction }
  | { type: "dismissToast"; id: number }
  | { type: "setBrowserEnabled"; enabled: boolean }
  | { type: "setWelcomeRecentsEnabled"; enabled: boolean }
  | { type: "setSessionStreamFont"; px: number }
  | { type: "setFontUiPreset"; preset: FontUiPreset }
  | { type: "setFontMonoPreset"; preset: FontMonoPreset }
  | { type: "setQuestionRailStyle"; style: RailStyle }
  | { type: "setShortcut"; id: BindableActionId; combo: string }
  | { type: "resetShortcuts" }
  | { type: "setCommandPaletteOpen"; open: boolean }
  | { type: "setReviewWindowOpen"; open: boolean }
  /** 按当前形态打开审查：停靠态切侧栏 tab，浮窗态开浮窗。 */
  | { type: "openReview" }
  /** 切换审查可见性（侧栏审查按钮用），行为随形态。 */
  | { type: "toggleReview" }
  /** 浮窗 ⇄ 停靠 互切，保持审查可见。 */
  | { type: "toggleReviewMode" }
  | {
      type: "hydrate";
      theme: Theme;
      navCollapsed: boolean;
      browserEnabled: boolean;
      welcomeRecentsEnabled: boolean;
      sessionStreamFontPx: number;
      fontUiPreset: FontUiPreset;
      fontMonoPreset: FontMonoPreset;
      questionRailStyle: RailStyle;
      localePreference: LocalePreference;
      shortcuts: ShortcutsMap;
    };

const initialState: UiState = {
  page: "session",
  backStack: [],
  forwardStack: [],
  navCollapsed: false,
  theme: "dark",
  localePreference: "system",
  locale: resolveLocale("system", navigator.language),
  rightSidebarOpen: true,
  rightSidebarTab: "files",
  rightSidebarWidth: RIGHT_SIDEBAR_DEFAULT_WIDTH,
  // 终端面板默认收起：首次进入不侵占 Agent 主工作区；展开时才创建 pty
  terminalPanelVisible: false,
  terminalPanelHeight: TERMINAL_PANEL_DEFAULT_HEIGHT,
  // 检查器默认停在「拾取」tab：页面区保持最大高度，深看按需切换
  browserPanelTab: "pick",
  inspectorPaneHeight: INSPECTOR_PANE_DEFAULT_HEIGHT,
  inspectorPaneCollapsed: false,
  inspectorFloatOpen: false,
  fileSearchTick: 0,
  fileOpenRequest: null,
  fileRevealRequest: null,
  settingsOpen: false,
  toast: null,
  hydrated: false,
  browserEnabled: true,
  welcomeRecentsEnabled: false,
  sessionStreamFontPx: DEFAULT_SESSION_STREAM_FONT_PX,
  fontUiPreset: "default",
  fontMonoPreset: "default",
  questionRailStyle: DEFAULT_RAIL_STYLE,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  commandPaletteOpen: false,
  reviewWindowOpen: false,
  reviewMode: "docked",
};

let toastSeq = 0;

function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "navigate": {
      if (state.page === action.page) return state;
      return {
        ...state,
        page: action.page,
        backStack: [...state.backStack, state.page],
        forwardStack: [],
      };
    }
    case "back": {
      const prev = state.backStack.at(-1);
      if (!prev) return state;
      return {
        ...state,
        page: prev,
        backStack: state.backStack.slice(0, -1),
        forwardStack: [state.page, ...state.forwardStack],
      };
    }
    case "forward": {
      const [next, ...rest] = state.forwardStack;
      if (!next) return state;
      return {
        ...state,
        page: next,
        backStack: [...state.backStack, state.page],
        forwardStack: rest,
      };
    }
    case "toggleNavCollapsed":
      return { ...state, navCollapsed: !state.navCollapsed };
    case "setTheme":
      return { ...state, theme: action.theme };
    case "setLocalePreference": {
      const preference = normalizeLocalePreference(action.preference);
      const locale = resolveLocale(preference, navigator.language);
      if (state.localePreference === preference && state.locale === locale) return state;
      return { ...state, localePreference: preference, locale };
    }
    case "setRightSidebar":
      return {
        ...state,
        rightSidebarOpen: action.open,
        rightSidebarTab: action.tab ?? state.rightSidebarTab,
      };
    case "setRightSidebarWidth":
      return { ...state, rightSidebarWidth: action.width };
    case "toggleRightSidebar":
      return { ...state, rightSidebarOpen: !state.rightSidebarOpen };
    // 底部终端面板开关：仅切换可见性，不动 terminalStore 里的 pty 会话
    case "toggleTerminalPanel":
      return { ...state, terminalPanelVisible: !state.terminalPanelVisible };
    case "setTerminalPanelHeight":
      return { ...state, terminalPanelHeight: action.height };
    case "setBrowserPanelTab":
      return { ...state, browserPanelTab: action.tab };
    case "setInspectorPaneHeight":
      return { ...state, inspectorPaneHeight: action.height };
    case "toggleInspectorPaneCollapsed":
      return {
        ...state,
        inspectorPaneCollapsed: !state.inspectorPaneCollapsed,
      };
    case "setInspectorFloatOpen":
      return { ...state, inspectorFloatOpen: action.open };
    case "openFilesPanel":
      return {
        ...state,
        rightSidebarOpen: true,
        rightSidebarTab: "files",
        fileSearchTick: state.fileSearchTick + 1,
      };
    // 展开文件 Tab 并投递打开请求；不触发 fileSearchTick，避免抢焦点到搜索框
    case "openFileInPanel":
      return {
        ...state,
        rightSidebarOpen: true,
        rightSidebarTab: "files",
        fileOpenRequest: {
          path: action.path,
          tick: (state.fileOpenRequest?.tick ?? 0) + 1,
        },
      };
    // 展开文件 Tab 并投递树定位请求（命令面板目录命中 → 展开祖先链 + 滚动）
    case "revealInFilePanel":
      return {
        ...state,
        rightSidebarOpen: true,
        rightSidebarTab: "files",
        fileRevealRequest: {
          path: action.path,
          tick: (state.fileRevealRequest?.tick ?? 0) + 1,
        },
      };
    case "setSettingsOpen":
      return state.settingsOpen === action.open ? state : { ...state, settingsOpen: action.open };
    case "showToast":
      return {
        ...state,
        toast: { id: ++toastSeq, message: action.message, action: action.action },
      };
    case "dismissToast":
      return state.toast?.id === action.id ? { ...state, toast: null } : state;
    case "setBrowserEnabled": {
      if (state.browserEnabled === action.enabled) return state;
      // 关闭插件时若正停在浏览器 Tab，切回文件，避免侧栏出现空面板
      return {
        ...state,
        browserEnabled: action.enabled,
        rightSidebarTab:
          !action.enabled && state.rightSidebarTab === "browser" ? "files" : state.rightSidebarTab,
      };
    }
    case "setWelcomeRecentsEnabled":
      if (state.welcomeRecentsEnabled === action.enabled) return state;
      return { ...state, welcomeRecentsEnabled: action.enabled };
    case "setSessionStreamFont": {
      const px = clampSessionStreamFontPx(action.px);
      if (state.sessionStreamFontPx === px) return state;
      return { ...state, sessionStreamFontPx: px };
    }
    case "setFontUiPreset": {
      const preset = normalizeFontUiPreset(action.preset);
      if (state.fontUiPreset === preset) return state;
      return { ...state, fontUiPreset: preset };
    }
    case "setFontMonoPreset": {
      const preset = normalizeFontMonoPreset(action.preset);
      if (state.fontMonoPreset === preset) return state;
      return { ...state, fontMonoPreset: preset };
    }
    case "setQuestionRailStyle": {
      const style = normalizeRailStyle(action.style);
      if (state.questionRailStyle === style) return state;
      return { ...state, questionRailStyle: style };
    }
    case "setShortcut": {
      const next = normalizeShortcutsMap(SHORTCUT_BINDINGS, DEFAULT_SHORTCUTS, {
        ...state.shortcuts,
        [action.id]: action.combo,
      });
      // 录入冲突在 UI 已拦；此处仍整表归一，避免写入重复组合
      if (next[action.id] !== action.combo) return state;
      if (BINDABLE_ACTION_IDS.every((k) => state.shortcuts[k] === next[k])) {
        return state;
      }
      return { ...state, shortcuts: next };
    }
    case "resetShortcuts": {
      if (BINDABLE_ACTION_IDS.every((k) => state.shortcuts[k] === DEFAULT_SHORTCUTS[k])) {
        return state;
      }
      return { ...state, shortcuts: { ...DEFAULT_SHORTCUTS } };
    }
    case "setCommandPaletteOpen":
      return state.commandPaletteOpen === action.open
        ? state
        : { ...state, commandPaletteOpen: action.open };
    case "setReviewWindowOpen":
      return state.reviewWindowOpen === action.open
        ? state
        : { ...state, reviewWindowOpen: action.open };
    case "openReview":
      if (state.reviewMode === "docked") {
        return { ...state, rightSidebarOpen: true, rightSidebarTab: "review" };
      }
      return state.reviewWindowOpen ? state : { ...state, reviewWindowOpen: true };
    case "toggleReview": {
      if (state.reviewMode === "docked") {
        const selected = state.rightSidebarOpen && state.rightSidebarTab === "review";
        return {
          ...state,
          rightSidebarOpen: true,
          rightSidebarTab: selected ? "files" : "review",
        };
      }
      return { ...state, reviewWindowOpen: !state.reviewWindowOpen };
    }
    case "toggleReviewMode": {
      if (state.reviewMode === "docked") {
        // 停靠 → 浮窗：浮窗接手显示；侧栏离开 review 面板，避免留下空 tab
        return {
          ...state,
          reviewMode: "float",
          reviewWindowOpen: true,
          rightSidebarTab: state.rightSidebarTab === "review" ? "files" : state.rightSidebarTab,
        };
      }
      // 浮窗 → 停靠：浮窗收起，侧栏展开并选中 review
      return {
        ...state,
        reviewMode: "docked",
        reviewWindowOpen: false,
        rightSidebarOpen: true,
        rightSidebarTab: "review",
      };
    }
    case "hydrate": {
      const localePreference = normalizeLocalePreference(action.localePreference);
      return {
        ...state,
        theme: action.theme,
        navCollapsed: action.navCollapsed,
        browserEnabled: action.browserEnabled,
        welcomeRecentsEnabled: action.welcomeRecentsEnabled,
        sessionStreamFontPx: clampSessionStreamFontPx(action.sessionStreamFontPx),
        fontUiPreset: normalizeFontUiPreset(action.fontUiPreset),
        fontMonoPreset: normalizeFontMonoPreset(action.fontMonoPreset),
        questionRailStyle: normalizeRailStyle(action.questionRailStyle),
        localePreference,
        locale: resolveLocale(localePreference, navigator.language),
        shortcuts: normalizeShortcutsMap(SHORTCUT_BINDINGS, DEFAULT_SHORTCUTS, action.shortcuts),
        hydrated: true,
      };
    }
    default:
      return state;
  }
}

interface UiStoreValue extends UiState {
  dispatch: Dispatch<UiAction>;
  canBack: boolean;
  canForward: boolean;
  navigate: (page: PageId) => void;
  /** 展开右侧上下文侧栏并切换到指定 Tab（已展开时仅切 Tab）。 */
  openSidebarTab: (tab: RightSidebarTab) => void;
  toggleRightSidebar: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  showToast: (message: string, action?: ToastAction) => void;
  /** 打开命令面板浮层。 */
  openCommandPalette: () => void;
  /** 关闭命令面板浮层。 */
  closeCommandPalette: () => void;
  /** 打开代码审查（按当前形态：停靠切侧栏 tab，浮窗开浮窗）。 */
  openReview: () => void;
  /** 关闭代码审查浮窗（仅浮窗形态；停靠形态经 tab 切换收起）。 */
  closeReviewWindow: () => void;
  /** 切换代码审查可见性（侧栏审查按钮）。 */
  toggleReview: () => void;
  /** 浮窗 ⇄ 停靠互切（审查头部按钮）。 */
  toggleReviewMode: () => void;
}

const UiStoreContext = createContext<UiStoreValue | null>(null);

/** 全局 UI 状态：布局折叠、右侧上下文侧栏、路由历史、主题、Toast。 */
export function UiProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(uiReducer, initialState);

  // 启动时从 PiDesk 设置恢复主题与侧边栏折叠态（docs/design/03 §1）
  useEffect(() => {
    let cancelled = false;
    settingsService.get().then((settings) => {
      if (cancelled || !settings) return;
      dispatch({
        type: "hydrate",
        theme: settings.theme === "light" ? "light" : "dark",
        navCollapsed: settings.navCollapsed,
        browserEnabled: settings.browserEnabled,
        welcomeRecentsEnabled: settings.welcomeRecentsEnabled === true,
        sessionStreamFontPx: settings.sessionStreamFontPx ?? DEFAULT_SESSION_STREAM_FONT_PX,
        fontUiPreset: settings.fontUiPreset ?? "default",
        fontMonoPreset: settings.fontMonoPreset ?? "default",
        questionRailStyle: settings.questionRailStyle ?? DEFAULT_RAIL_STYLE,
        localePreference: settings.locale ?? "system",
        shortcuts: settings.shortcuts ?? { ...DEFAULT_SHORTCUTS },
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 恢复完成后，主题/折叠态/浏览器开关/对话流字号/字体预设变化回写设置
  useEffect(() => {
    if (!state.hydrated) return;
    settingsService.set({
      theme: state.theme,
      navCollapsed: state.navCollapsed,
      browserEnabled: state.browserEnabled,
      welcomeRecentsEnabled: state.welcomeRecentsEnabled,
      sessionStreamFontPx: state.sessionStreamFontPx,
      fontUiPreset: state.fontUiPreset,
      fontMonoPreset: state.fontMonoPreset,
      questionRailStyle: state.questionRailStyle,
      locale: state.localePreference,
      shortcuts: state.shortcuts,
    });
  }, [
    state.hydrated,
    state.theme,
    state.navCollapsed,
    state.browserEnabled,
    state.welcomeRecentsEnabled,
    state.sessionStreamFontPx,
    state.fontUiPreset,
    state.fontMonoPreset,
    state.questionRailStyle,
    state.localePreference,
    state.shortcuts,
  ]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  // 语言切换同步到模块级 t()，并更新 <html lang> 供字体/断行选择器使用
  useEffect(() => {
    setI18nLocale(state.locale);
    document.documentElement.lang = state.locale;
  }, [state.locale]);

  // 首帧与后续变更都走同一入口；默认值与 tokens.css 一致，水合前不闪档
  useEffect(() => {
    applySessionStreamFont(state.sessionStreamFontPx);
  }, [state.sessionStreamFontPx]);

  useEffect(() => {
    applyFontFamilies(state.fontUiPreset, state.fontMonoPreset);
  }, [state.fontUiPreset, state.fontMonoPreset]);

  const navigate = useCallback((page: PageId) => dispatch({ type: "navigate", page }), []);
  const openSidebarTab = useCallback(
    (tab: RightSidebarTab) => dispatch({ type: "setRightSidebar", open: true, tab }),
    [],
  );
  const toggleRightSidebar = useCallback(() => dispatch({ type: "toggleRightSidebar" }), []);
  // WebContentsView 盖在渲染层上方：必须在弹设置之前先藏视图，否则 Modal 会被盖住数秒
  // （等到 SettingsDialog 的 effect 再 IPC 已经晚了一帧以上）。
  const openSettings = useCallback(() => {
    void browserService.setOverlaySuppressed(true, "settings");
    dispatch({ type: "setSettingsOpen", open: true });
  }, []);
  const closeSettings = useCallback(() => {
    dispatch({ type: "setSettingsOpen", open: false });
    void browserService.setOverlaySuppressed(false, "settings");
  }, []);
  const showToast = useCallback(
    (message: string, action?: ToastAction) => dispatch({ type: "showToast", message, action }),
    [],
  );
  const openCommandPalette = useCallback(
    () => dispatch({ type: "setCommandPaletteOpen", open: true }),
    [],
  );
  const closeCommandPalette = useCallback(
    () => dispatch({ type: "setCommandPaletteOpen", open: false }),
    [],
  );
  const openReview = useCallback(() => dispatch({ type: "openReview" }), []);
  const closeReviewWindow = useCallback(
    () => dispatch({ type: "setReviewWindowOpen", open: false }),
    [],
  );
  const toggleReview = useCallback(() => dispatch({ type: "toggleReview" }), []);
  const toggleReviewMode = useCallback(() => dispatch({ type: "toggleReviewMode" }), []);

  const value = useMemo<UiStoreValue>(
    () => ({
      ...state,
      dispatch,
      canBack: state.backStack.length > 0,
      canForward: state.forwardStack.length > 0,
      navigate,
      openSidebarTab,
      toggleRightSidebar,
      openSettings,
      closeSettings,
      showToast,
      openCommandPalette,
      closeCommandPalette,
      openReview,
      closeReviewWindow,
      toggleReview,
      toggleReviewMode,
    }),
    [
      state,
      navigate,
      openSidebarTab,
      toggleRightSidebar,
      openSettings,
      closeSettings,
      showToast,
      openCommandPalette,
      closeCommandPalette,
      openReview,
      closeReviewWindow,
      toggleReview,
      toggleReviewMode,
    ],
  );

  return <UiStoreContext.Provider value={value}>{children}</UiStoreContext.Provider>;
}

export function useUiStore(): UiStoreValue {
  const ctx = useContext(UiStoreContext);
  if (!ctx) throw new Error("useUiStore 必须在 UiProvider 内使用");
  return ctx;
}
