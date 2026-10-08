import { defineMessages } from "../types";

/**
 * 命令面板（Command Palette）文案（docs/design 30 §2.2）。
 * 键名统一落在 `palette.*` 域下；命令项标签在 `palette.cmd.*`。
 */
export const commandPaletteMessages = defineMessages({
  "palette.title": { "zh-CN": "命令面板", "en-US": "Command palette" },
  "palette.placeholder": {
    "zh-CN": "搜索命令、会话或文件…",
    "en-US": "Search commands, sessions or files…",
  },
  "palette.placeholder.all": {
    "zh-CN": "输入以搜索（> 命令 · # 会话 · @ 文件）",
    "en-US": "Type to search (> commands · # sessions · @ files)",
  },

  // —— 作用域 Tab ——
  "palette.scope.tabs": { "zh-CN": "搜索范围", "en-US": "Search scopes" },
  "palette.scope.all": { "zh-CN": "全部", "en-US": "All" },
  "palette.scope.commands": { "zh-CN": "命令", "en-US": "Commands" },
  "palette.scope.sessions": { "zh-CN": "会话", "en-US": "Sessions" },
  "palette.scope.files": { "zh-CN": "文件", "en-US": "Files" },

  // —— 分区标题 ——
  "palette.section.commands": { "zh-CN": "命令", "en-US": "Commands" },
  "palette.section.sessions": { "zh-CN": "会话", "en-US": "Sessions" },
  "palette.section.files": { "zh-CN": "文件", "en-US": "Files" },
  "palette.section.changes": { "zh-CN": "最近改动", "en-US": "Recent changes" },

  // —— 状态 / 交互 ——
  "palette.noResults": {
    "zh-CN": "没有匹配结果",
    "en-US": "No matching results",
  },
  "palette.filesLoading": {
    "zh-CN": "正在搜索文件…",
    "en-US": "Searching files…",
  },
  "palette.filesError": {
    "zh-CN": "无法访问工作目录，文件搜索不可用",
    "en-US": "Can't access the working directory; file search is unavailable",
  },
  "palette.commandFailed": {
    "zh-CN": "命令执行失败",
    "en-US": "Command failed",
  },
  "palette.showMore": {
    "zh-CN": "显示更多（还有 {count} 条）",
    "en-US": "Show more ({count} remaining)",
  },
  "palette.hint.navigate": { "zh-CN": "导航", "en-US": "Navigate" },
  "palette.hint.open": { "zh-CN": "打开", "en-US": "Open" },
  "palette.hint.close": { "zh-CN": "关闭", "en-US": "Close" },

  // —— 搜索历史 ——
  "palette.history": { "zh-CN": "搜索历史", "en-US": "Search history" },
  "palette.clearHistory": {
    "zh-CN": "清除搜索历史",
    "en-US": "Clear search history",
  },
  "palette.expandHistory": { "zh-CN": "展开全部", "en-US": "Show all" },
  "palette.collapseHistory": { "zh-CN": "收起", "en-US": "Collapse" },

  // —— git 变更状态（无行数统计时的退回标签） ——
  "palette.change.added": { "zh-CN": "新增", "en-US": "Added" },
  "palette.change.modified": { "zh-CN": "修改", "en-US": "Modified" },
  "palette.change.deleted": { "zh-CN": "删除", "en-US": "Deleted" },
  "palette.change.renamed": { "zh-CN": "重命名", "en-US": "Renamed" },
  "palette.change.copied": { "zh-CN": "复制", "en-US": "Copied" },
  "palette.change.conflicted": { "zh-CN": "冲突", "en-US": "Conflicted" },
  "palette.change.untracked": { "zh-CN": "未跟踪", "en-US": "Untracked" },

  // —— 会话条目 ——
  "palette.session.untitled": {
    "zh-CN": "（无标题会话）",
    "en-US": "(untitled session)",
  },

  // —— 命令项标签 ——
  "palette.cmd.newTask": { "zh-CN": "新建任务", "en-US": "New task" },
  "palette.cmd.openFiles": {
    "zh-CN": "打开文件面板并搜索",
    "en-US": "Open files panel & search",
  },
  "palette.cmd.toggleTerminal": {
    "zh-CN": "切换底部终端",
    "en-US": "Toggle terminal panel",
  },
  "palette.cmd.toggleSidebar": {
    "zh-CN": "折叠 / 展开侧边栏",
    "en-US": "Collapse / expand sidebar",
  },
  "palette.cmd.openReview": {
    "zh-CN": "打开审查面板",
    "en-US": "Open review panel",
  },
  "palette.cmd.openFilesTab": {
    "zh-CN": "打开文件面板",
    "en-US": "Open files panel",
  },
  "palette.cmd.openBrowser": {
    "zh-CN": "打开浏览器面板",
    "en-US": "Open browser panel",
  },
  "palette.cmd.toggleRightSidebar": {
    "zh-CN": "显示 / 隐藏右侧工具栏",
    "en-US": "Show / hide right sidebar",
  },
  "palette.cmd.openSettings": { "zh-CN": "打开设置", "en-US": "Open settings" },
  "palette.cmd.themeDark": {
    "zh-CN": "切换到深色主题",
    "en-US": "Switch to dark theme",
  },
  "palette.cmd.themeLight": {
    "zh-CN": "切换到浅色主题",
    "en-US": "Switch to light theme",
  },
  "palette.cmd.goSession": { "zh-CN": "前往会话", "en-US": "Go to session" },
  "palette.cmd.goExtensions": {
    "zh-CN": "前往扩展",
    "en-US": "Go to extensions",
  },
  "palette.cmd.goScheduled": {
    "zh-CN": "前往定时任务",
    "en-US": "Go to scheduled tasks",
  },
  "palette.cmd.nextSession": {
    "zh-CN": "下一个会话",
    "en-US": "Next session",
  },
  "palette.cmd.prevSession": {
    "zh-CN": "上一个会话",
    "en-US": "Previous session",
  },
  "palette.cmd.rollbackLastRound": {
    "zh-CN": "撤销上一轮改动…",
    "en-US": "Undo last round…",
  },
});
