import { defineMessages } from "../types";

/**
 * 窗口 chrome 文案：标题栏与底部终端面板。
 * `titleBar.back/forward/minimize/maximize/restore/close` 与
 * `panels.terminal.*` 已在 panels.ts 声明，此处只补缺口。
 */
export const chromeMessages = defineMessages({
  "titleBar.toggleSidebar": {
    "zh-CN": "切换侧边栏 ({shortcut})",
    "en-US": "Toggle sidebar ({shortcut})",
  },
  "titleBar.showTerminal": {
    "zh-CN": "显示终端 ({shortcut})",
    "en-US": "Show terminal ({shortcut})",
  },
  "titleBar.hideTerminal": {
    "zh-CN": "隐藏终端 ({shortcut})",
    "en-US": "Hide terminal ({shortcut})",
  },
  "titleBar.collapseSidebar": { "zh-CN": "收起侧栏", "en-US": "Collapse sidebar" },
  "titleBar.expandSidebar": { "zh-CN": "展开侧栏", "en-US": "Expand sidebar" },

  "terminal.ariaPanel": { "zh-CN": "终端面板", "en-US": "Terminal panel" },
  "terminal.resizeHandle": { "zh-CN": "拖拽调整高度", "en-US": "Drag to resize" },
  "terminal.maxTabs": {
    "zh-CN": "最多 {count} 个终端实例",
    "en-US": "Up to {count} terminal instances",
  },
  "terminal.newInstance": { "zh-CN": "新建终端实例", "en-US": "New terminal instance" },
  "terminal.killCurrent": {
    "zh-CN": "结束当前终端进程",
    "en-US": "End current terminal process",
  },
  "terminal.noneRunning": { "zh-CN": "无运行中的终端", "en-US": "No running terminal" },
  "terminal.empty": { "zh-CN": "无终端实例", "en-US": "No terminal instances" },
  "terminal.instanceAria": { "zh-CN": "终端 {title}", "en-US": "Terminal {title}" },
  "terminal.renameAria": { "zh-CN": "重命名终端", "en-US": "Rename terminal" },
  "terminal.closeTabTitle": { "zh-CN": "关闭此终端", "en-US": "Close this terminal" },
  "terminal.closeTabAria": { "zh-CN": "关闭 {title}", "en-US": "Close {title}" },
});
