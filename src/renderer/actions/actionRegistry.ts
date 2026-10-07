import type { Icon } from "@phosphor-icons/react";
import {
  ArrowCircleDown,
  ArrowCircleUp,
  ArrowCounterClockwise,
  ChatCircle,
  Folder,
  FolderOpen,
  Gear,
  GitPullRequest,
  Globe,
  Moon,
  PlusCircle,
  PuzzlePiece,
  Sidebar,
  SidebarSimple,
  Sun,
  Terminal,
  Timer,
} from "@phosphor-icons/react";
import type { ShortcutsMap } from "../../shared/shortcuts";
import { isCanonicalCombo } from "../../shared/shortcuts";

/**
 * 统一动作注册表（docs 30 §2.6）：命令面板与键盘快捷键共用同一份清单，
 * 新增一个动作只改本文件（+ 文案表）。数组顺序即键位归一优先级——
 * 存量五键必须保持在最前，保证老用户自定义映射升级不丢。
 */

/** 动作分组：键位面板按此分组渲染；面板命令本身是平铺的，分组仅约束键位面板。 */
export type ActionSection = "navigation" | "panels" | "session" | "review";

/**
 * 动作处理上下文：由 useActionContext 从各 store 装配（命令面板与全局监听共用
 * 同一份装配，保证两条触发路径行为一致）。
 */
export interface ActionContext {
  t: (key: string, params?: Record<string, string | number>) => string;
  /** 当前键位映射（命令行的快捷键胶囊展示用）。 */
  shortcuts: ShortcutsMap;
  browserEnabled: boolean;
  commandPaletteOpen: boolean;
  /** 会话 / 主题 / 布局类。 */
  newTask: () => void;
  setTheme: (theme: "dark" | "light") => void;
  navigate: (page: "session" | "extensions" | "scheduled") => void;
  /** 面板类。 */
  openFilesPanel: () => void;
  openSidebarTab: (tab: "review" | "files" | "browser") => void;
  toggleTerminal: () => void;
  toggleNavCollapsed: () => void;
  toggleRightSidebar: () => void;
  openReview: () => void;
  openSettings: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  showToast: (message: string) => void;
  /** 会话导航（上 / 下一个会话）：侧栏展示顺序（项目组在前、任务在后）拍平。 */
  sessionNav: () => {
    items: Array<{ file: string; cwd: string | null }>;
    activeFile: string | null;
  };
  openSessionFile: (file: string, cwd?: string) => void;
  /**
   * 回滚上一轮：可回滚时打开确认弹窗并返回 true；
   * 不可回滚时 toast 阻断原因并返回 false。
   */
  requestRollbackLastRound: () => boolean;
}

/** 单条动作声明：面板命令与可绑定键位的唯一数据源。 */
export interface ActionDescriptor {
  id: string;
  /** 面板与键位面板共用标签键。 */
  labelKey: string;
  /** 键位面板的说明键（仅可绑定动作需要）。 */
  descKey?: string;
  icon: Icon;
  /** 中英并列关键词，喂给命令面板的模糊匹配（不展示）。 */
  keywords: string;
  section: ActionSection;
  /** 默认组合；null = 仅面板命令，不进键位面板与键位匹配。 */
  defaultCombo: string | null;
  /** 焦点在输入框 / contenteditable 时是否仍触发（导航与面板开关类为 true）。 */
  allowInEditable?: boolean;
  /** 条件显示（如浏览器面板启用）。 */
  when?: (ctx: ActionContext) => boolean;
  run: (ctx: ActionContext) => void;
}

export const ACTION_REGISTRY: ActionDescriptor[] = [
  // —— 存量五键：顺序即归一优先级，必须保持在最前 ——
  {
    id: "newTask",
    labelKey: "palette.cmd.newTask",
    descKey: "settings.shortcuts.newTask.description",
    icon: PlusCircle,
    keywords: "new task session 新建 任务 会话",
    section: "session",
    defaultCombo: "Ctrl+N",
    run: (ctx) => ctx.newTask(),
  },
  {
    id: "openFiles",
    labelKey: "palette.cmd.openFiles",
    descKey: "settings.shortcuts.openFiles.description",
    icon: FolderOpen,
    keywords: "open files search 打开 文件 搜索 快速",
    section: "panels",
    defaultCombo: "Ctrl+P",
    run: (ctx) => ctx.openFilesPanel(),
  },
  {
    id: "toggleTerminal",
    labelKey: "palette.cmd.toggleTerminal",
    descKey: "settings.shortcuts.toggleTerminal.description",
    icon: Terminal,
    keywords: "terminal toggle 终端 切换 底部",
    section: "panels",
    defaultCombo: "Ctrl+T",
    run: (ctx) => ctx.toggleTerminal(),
  },
  {
    id: "toggleSidebar",
    labelKey: "palette.cmd.toggleSidebar",
    descKey: "settings.shortcuts.toggleSidebar.description",
    icon: Sidebar,
    keywords: "sidebar nav collapse 侧边栏 导航 折叠 展开",
    section: "navigation",
    defaultCombo: "Ctrl+B",
    run: (ctx) => ctx.toggleNavCollapsed(),
  },
  {
    id: "openCommandPalette",
    labelKey: "settings.shortcuts.openCommandPalette",
    descKey: "settings.shortcuts.openCommandPalette.description",
    icon: Gear,
    keywords: "command palette 命令 面板",
    section: "panels",
    defaultCombo: "Ctrl+Shift+P",
    // 面板开着时焦点在面板输入框，再按同键 = 关闭（toggle，VS Code 语义）
    allowInEditable: true,
    run: (ctx) => ctx.setCommandPaletteOpen(!ctx.commandPaletteOpen),
  },

  // —— 面板 / 导航：存量命令提升为可绑定 ——
  {
    id: "openSettings",
    labelKey: "palette.cmd.openSettings",
    descKey: "settings.shortcuts.openSettings.description",
    icon: Gear,
    keywords: "settings preferences 设置 偏好",
    section: "panels",
    defaultCombo: "Ctrl+Alt+S",
    // 不设 allowInEditable：Ctrl+Alt+字母在 AltGr 布局（欧洲键盘）等于直接打字符，
    // 输入框内触发会吞键；打开设置在输入中低频，让位给输入
    run: (ctx) => ctx.openSettings(),
  },
  {
    id: "goSession",
    labelKey: "palette.cmd.goSession",
    descKey: "settings.shortcuts.goSession.description",
    icon: ChatCircle,
    keywords: "go session chat 前往 会话 对话",
    section: "navigation",
    defaultCombo: "Alt+1",
    allowInEditable: true,
    run: (ctx) => ctx.navigate("session"),
  },
  {
    id: "goExtensions",
    labelKey: "palette.cmd.goExtensions",
    descKey: "settings.shortcuts.goExtensions.description",
    icon: PuzzlePiece,
    keywords: "extensions plugins 扩展 插件",
    section: "navigation",
    defaultCombo: "Alt+2",
    allowInEditable: true,
    run: (ctx) => ctx.navigate("extensions"),
  },
  {
    id: "goScheduled",
    labelKey: "palette.cmd.goScheduled",
    descKey: "settings.shortcuts.goScheduled.description",
    icon: Timer,
    keywords: "scheduled tasks timer cron 定时 计划 任务 调度",
    section: "navigation",
    defaultCombo: "Alt+3",
    allowInEditable: true,
    run: (ctx) => ctx.navigate("scheduled"),
  },
  {
    id: "toggleRightSidebar",
    labelKey: "palette.cmd.toggleRightSidebar",
    descKey: "settings.shortcuts.toggleRightSidebar.description",
    icon: SidebarSimple,
    keywords: "right sidebar context toggle 右侧 工具栏 显示 隐藏",
    section: "panels",
    defaultCombo: "Ctrl+Alt+B",
    run: (ctx) => ctx.toggleRightSidebar(),
  },
  {
    id: "openReview",
    labelKey: "palette.cmd.openReview",
    descKey: "settings.shortcuts.openReview.description",
    icon: GitPullRequest,
    keywords: "review git changes diff 审查 变更 提交",
    section: "review",
    defaultCombo: "Ctrl+Alt+R",
    run: (ctx) => ctx.openReview(),
  },
  {
    id: "rollbackLastRound",
    labelKey: "palette.cmd.rollbackLastRound",
    descKey: "settings.shortcuts.rollbackLastRound.description",
    icon: ArrowCounterClockwise,
    keywords: "rollback undo last round 撤销 回滚 上一轮 改动",
    section: "review",
    // 不用 Ctrl+Shift+R：Electron 默认菜单的 forceReload 角色占用它（见 shared/shortcuts.ts 保留清单）
    defaultCombo: "Ctrl+Alt+Z",
    run: (ctx) => ctx.requestRollbackLastRound(),
  },

  // —— 会话导航：新动作（方向键主键）——
  {
    id: "nextSession",
    labelKey: "palette.cmd.nextSession",
    descKey: "settings.shortcuts.nextSession.description",
    icon: ArrowCircleDown,
    keywords: "next session 下一个 会话 切换",
    section: "navigation",
    defaultCombo: "Alt+ArrowDown",
    run: (ctx) => {
      const { items, activeFile } = ctx.sessionNav();
      if (items.length === 0) return;
      const index = activeFile ? items.findIndex((item) => item.file === activeFile) : -1;
      const next = items[(index + 1 + items.length) % items.length];
      if (next) ctx.openSessionFile(next.file, next.cwd ?? undefined);
    },
  },
  {
    id: "prevSession",
    labelKey: "palette.cmd.prevSession",
    descKey: "settings.shortcuts.prevSession.description",
    icon: ArrowCircleUp,
    keywords: "previous session 上一个 会话 切换",
    section: "navigation",
    defaultCombo: "Alt+ArrowUp",
    run: (ctx) => {
      const { items, activeFile } = ctx.sessionNav();
      if (items.length === 0) return;
      const index = activeFile ? items.findIndex((item) => item.file === activeFile) : -1;
      // 活跃会话不在侧栏（如刚外部新建）时 -1 - 1 = -2，取模后落到末尾再前一步，可接受
      const prev = items[(index - 1 + items.length) % items.length];
      if (prev) ctx.openSessionFile(prev.file, prev.cwd ?? undefined);
    },
  },

  // —— 仅面板命令（不设默认键）——
  {
    id: "openFilesTab",
    labelKey: "palette.cmd.openFilesTab",
    icon: Folder,
    keywords: "files panel tree 文件 面板 目录树",
    section: "panels",
    defaultCombo: null,
    run: (ctx) => ctx.openSidebarTab("files"),
  },
  {
    id: "openBrowser",
    labelKey: "palette.cmd.openBrowser",
    icon: Globe,
    keywords: "browser inspect 浏览器 面板 检查",
    section: "panels",
    defaultCombo: null,
    when: (ctx) => ctx.browserEnabled,
    run: (ctx) => ctx.openSidebarTab("browser"),
  },
  {
    id: "themeDark",
    labelKey: "palette.cmd.themeDark",
    icon: Moon,
    keywords: "theme dark 深色 暗色 主题",
    section: "panels",
    defaultCombo: null,
    run: (ctx) => ctx.setTheme("dark"),
  },
  {
    id: "themeLight",
    labelKey: "palette.cmd.themeLight",
    icon: Sun,
    keywords: "theme light 浅色 亮色 主题",
    section: "panels",
    defaultCombo: null,
    run: (ctx) => ctx.setTheme("light"),
  },
];

/** 可绑定动作 id（显式清单，注册表单测保证与 defaultCombo 集合一致）。 */
export const BINDABLE_ACTION_IDS = [
  "newTask",
  "openFiles",
  "toggleTerminal",
  "toggleSidebar",
  "openCommandPalette",
  "openSettings",
  "goSession",
  "goExtensions",
  "goScheduled",
  "toggleRightSidebar",
  "openReview",
  "rollbackLastRound",
  "nextSession",
  "prevSession",
] as const;

export type BindableActionId = (typeof BINDABLE_ACTION_IDS)[number];

function actionById(id: string): ActionDescriptor | undefined {
  return ACTION_REGISTRY.find((action) => action.id === id);
}

/** 默认键位映射（从注册表派生）。 */
export const DEFAULT_SHORTCUTS: Record<BindableActionId, string> = Object.fromEntries(
  BINDABLE_ACTION_IDS.map((id) => {
    const action = actionById(id);
    if (!action || action.defaultCombo === null) {
      throw new Error(`[actionRegistry] ${id} 必须是可绑定动作且有默认键`);
    }
    return [id, action.defaultCombo];
  }),
) as Record<BindableActionId, string>;

/** 键位机制层的绑定清单投影（冲突检测 / 读盘归一的输入）。 */
export const SHORTCUT_BINDINGS = BINDABLE_ACTION_IDS.map((id) => ({
  id,
  defaultCombo: actionById(id)?.defaultCombo ?? null,
}));

/** 按组合查动作（全局监听的匹配路径）；未命中返回 null。 */
export function findActionByCombo(shortcuts: ShortcutsMap, combo: string): ActionDescriptor | null {
  if (!isCanonicalCombo(combo)) return null;
  for (const action of ACTION_REGISTRY) {
    if (action.defaultCombo !== null && shortcuts[action.id] === combo) return action;
  }
  return null;
}
