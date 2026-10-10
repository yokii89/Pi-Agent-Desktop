import { defineMessages } from "../types";

export const sidenavMessages = defineMessages({
  "sidenav.aria.main": { "zh-CN": "主导航", "en-US": "Main navigation" },
  "sidenav.newTask": { "zh-CN": "新建任务", "en-US": "New task" },
  "sidenav.newTask.title": {
    "zh-CN": "新建任务 ({shortcut})",
    "en-US": "New task ({shortcut})",
  },
  "sidenav.extensions": { "zh-CN": "扩展", "en-US": "Extensions" },
  "sidenav.mcp": { "zh-CN": "MCP 服务器", "en-US": "MCP servers" },
  "sidenav.projects": { "zh-CN": "项目", "en-US": "Projects" },
  "sidenav.tasks": { "zh-CN": "任务", "en-US": "Tasks" },
  "sidenav.settings": { "zh-CN": "设置", "en-US": "Settings" },
  "sidenav.projects.empty": {
    "zh-CN": "还没有项目。添加本地目录后可按项目归类会话。",
    "en-US": "No projects yet. Add a local folder to group sessions by project.",
  },
  "sidenav.projects.add": { "zh-CN": "添加项目", "en-US": "Add project" },
  "sidenav.projects.emptyTitle": { "zh-CN": "暂无项目", "en-US": "No projects" },
  "sidenav.tasks.empty": {
    "zh-CN": "暂无独立任务会话",
    "en-US": "No standalone task sessions",
  },
  "sidenav.session.untitled": { "zh-CN": "未命名会话", "en-US": "Untitled session" },
  "sidenav.pinned": { "zh-CN": "置顶", "en-US": "Pinned" },
  "sidenav.pinned.empty": { "zh-CN": "暂无置顶会话", "en-US": "No pinned sessions" },
  "sidenav.session.rename": { "zh-CN": "重命名", "en-US": "Rename" },
  "sidenav.session.pinGlobal": { "zh-CN": "全局置顶", "en-US": "Pin globally" },
  "sidenav.session.unpinGlobal": { "zh-CN": "取消全局置顶", "en-US": "Unpin globally" },
  "sidenav.session.pinWorkspace": { "zh-CN": "在工作区内置顶", "en-US": "Pin in workspace" },
  "sidenav.session.unpinWorkspace": { "zh-CN": "取消工作区置顶", "en-US": "Unpin in workspace" },
  "sidenav.session.copyTaskId": { "zh-CN": "复制任务 ID", "en-US": "Copy task ID" },
  "sidenav.session.idCopied": { "zh-CN": "已复制任务 ID", "en-US": "Task ID copied" },
  "sidenav.session.markUnread": { "zh-CN": "标记为未读", "en-US": "Mark as unread" },
  "sidenav.session.markUnreadCurrent": { "zh-CN": "当前会话", "en-US": "Current session" },
  "sidenav.session.export": { "zh-CN": "导出记录", "en-US": "Export record" },
  "sidenav.session.exportFailed": { "zh-CN": "导出失败", "en-US": "Export failed" },
  "sidenav.session.archive": {
    "zh-CN": "归档",
    "en-US": "Archive",
  },
  "sidenav.session.endProcess": { "zh-CN": "结束进程", "en-US": "End process" },
  "sidenav.session.copyPath": { "zh-CN": "复制路径", "en-US": "Copy path" },
  "sidenav.session.openFolder": { "zh-CN": "打开所在文件夹", "en-US": "Open containing folder" },
  "sidenav.session.delete": { "zh-CN": "删除会话", "en-US": "Delete session" },
  "sidenav.session.deleteConfirm.title": {
    "zh-CN": "删除会话？",
    "en-US": "Delete this session?",
  },
  "sidenav.session.deleteConfirm.message": {
    "zh-CN": "将删除会话历史文件，操作不可撤销。",
    "en-US": "This removes the session history file and cannot be undone.",
  },
  "sidenav.session.deleteConfirm.confirm": { "zh-CN": "删除", "en-US": "Delete" },
  "sidenav.session.running": { "zh-CN": "运行中", "en-US": "Running" },
  "sidenav.session.idle": { "zh-CN": "空闲", "en-US": "Idle" },
  "sidenav.session.cold": { "zh-CN": "未启动", "en-US": "Not started" },
  "sidenav.reloadNotice.title": {
    "zh-CN": "扩展已更新",
    "en-US": "Extensions updated",
  },
  "sidenav.reloadNotice.description": {
    "zh-CN": "重新加载扩展以使用最新版本。",
    "en-US": "Reload extensions to pick up the latest versions.",
  },
  "sidenav.reloadNotice.reload": { "zh-CN": "重新加载", "en-US": "Reload" },
  "sidenav.reloadNotice.dismiss": { "zh-CN": "忽略", "en-US": "Dismiss" },
  "sidenav.reloadNotice.staleHint": {
    "zh-CN": "扩展配置待重载；任务结束后可从行菜单结束进程，下次使用时生效",
    "en-US":
      "Extension config pending reload; end the process from the row menu after the task to apply it next time.",
  },
  "sidenav.reloadNotice.stale": {
    "zh-CN": "扩展配置待重载",
    "en-US": "Extension config pending reload",
  },

  "sidenav.projects.expandSessions": {
    "zh-CN": "展开 {name} 的历史会话",
    "en-US": "Show sessions in {name}",
  },
  "sidenav.projects.collapseSessions": {
    "zh-CN": "收起 {name} 的历史会话",
    "en-US": "Hide sessions in {name}",
  },
  "sidenav.projects.delete": { "zh-CN": "删除项目", "en-US": "Remove project" },
  "sidenav.projects.newSession": { "zh-CN": "新建会话", "en-US": "New session" },
  "sidenav.projects.newSessionIn": {
    "zh-CN": "在 {name} 中新建会话",
    "en-US": "New session in {name}",
  },
  "sidenav.projects.noHistory": { "zh-CN": "暂无历史会话", "en-US": "No session history" },

  "sidenav.row.moreActions": { "zh-CN": "更多操作", "en-US": "More actions" },
  "sidenav.row.moreActionsFor": {
    "zh-CN": "更多操作：{name}",
    "en-US": "More actions: {name}",
  },
  "sidenav.row.openFolderFailed": {
    "zh-CN": "打开文件夹失败",
    "en-US": "Could not open folder",
  },

  "sidenav.session.renameLabel": {
    "zh-CN": "重命名会话：{title}",
    "en-US": "Rename session: {title}",
  },
  "sidenav.session.deleteTask": { "zh-CN": "删除任务", "en-US": "Delete task" },
  "sidenav.session.opening": { "zh-CN": "正在打开", "en-US": "Opening" },
  "sidenav.session.aiResponding": { "zh-CN": "AI 正在输出", "en-US": "AI is responding" },
  "sidenav.session.aiDone": { "zh-CN": "AI 输出完成", "en-US": "AI finished responding" },
  "sidenav.session.pinned": { "zh-CN": "已置顶", "en-US": "Pinned" },
  "sidenav.session.endConfirm.running": {
    "zh-CN": "AI 仍在输出，结束后将中断当前任务。历史记录会保留。",
    "en-US": "AI is still responding. Ending will interrupt the current task. History is kept.",
  },
  "sidenav.session.endConfirm.idle": {
    "zh-CN": "结束该会话的 pi 进程？历史记录会保留。",
    "en-US": "End the pi process for this session? History is kept.",
  },

  "sidenav.hover.localTask": { "zh-CN": "本地任务", "en-US": "Local task" },
  "sidenav.hover.space": { "zh-CN": "所属空间：{name}", "en-US": "Space: {name}" },
  "sidenav.hover.noSpace": { "zh-CN": "未关联空间", "en-US": "No space" },
  "sidenav.hover.updatedAt": { "zh-CN": "更新于 {time}", "en-US": "Updated {time}" },
});
