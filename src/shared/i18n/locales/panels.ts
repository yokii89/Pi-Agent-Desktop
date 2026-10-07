import { defineMessages } from "../types";

/** 右栏、底部终端、标题栏等主界面 chrome 文案。 */
export const panelMessages = defineMessages({
  "panels.context.review": { "zh-CN": "审查", "en-US": "Review" },
  "panels.context.files": { "zh-CN": "文件", "en-US": "Files" },
  "panels.context.browser": { "zh-CN": "浏览器", "en-US": "Browser" },
  "panels.context.terminal": { "zh-CN": "终端", "en-US": "Terminal" },
  "panels.context.extStarting": {
    "zh-CN": "正在启动会话并连接扩展…",
    "en-US": "Starting session and connecting extensions…",
  },
  "panels.context.extDisconnected": {
    "zh-CN": "扩展尚未连接。点击上方 Tab 启动会话并打开面板。",
    "en-US": "Extension not connected. Click the tab above to start a session and open the panel.",
  },
  "panels.context.widenHint": {
    "zh-CN": "加宽侧栏以查看完整检查器",
    "en-US": "Widen the sidebar for the full inspector",
  },
  "panels.context.widen": { "zh-CN": "加宽侧栏", "en-US": "Widen sidebar" },

  "panels.files.searchPlaceholder": {
    "zh-CN": "搜索文件…",
    "en-US": "Search files…",
  },
  "panels.files.empty": {
    "zh-CN": "在文件树中选择文件进行预览",
    "en-US": "Select a file in the tree to preview",
  },
  "panels.files.emptyTree": { "zh-CN": "目录为空", "en-US": "Folder is empty" },
  "panels.files.binary": {
    "zh-CN": "二进制文件，暂不支持预览",
    "en-US": "Binary file; preview not available",
  },
  "panels.files.tooLarge": {
    "zh-CN": "文件过大，已截断预览",
    "en-US": "File is large; preview truncated",
  },
  "panels.files.openInBrowser": {
    "zh-CN": "在侧栏浏览器中打开",
    "en-US": "Open in sidebar browser",
  },
  "panels.files.copyPath": { "zh-CN": "复制路径", "en-US": "Copy path" },
  "panels.files.copyRelative": {
    "zh-CN": "复制相对路径",
    "en-US": "Copy relative path",
  },

  "panels.terminal.title": { "zh-CN": "终端", "en-US": "Terminal" },
  "panels.terminal.newTab": { "zh-CN": "新建终端", "en-US": "New terminal" },
  "panels.terminal.closeTab": { "zh-CN": "关闭终端", "en-US": "Close terminal" },
  "panels.terminal.clear": { "zh-CN": "清屏", "en-US": "Clear" },
  "panels.terminal.kill": { "zh-CN": "结束进程", "en-US": "End process" },
  "panels.terminal.exited": {
    "zh-CN": "进程已退出（代码 {code}）",
    "en-US": "Process exited (code {code})",
  },
  "panels.terminal.restart": { "zh-CN": "重启终端", "en-US": "Restart terminal" },

  "panels.review.empty": {
    "zh-CN": "暂无待审查的修改",
    "en-US": "No changes to review yet",
  },
  "panels.review.accept": { "zh-CN": "接受", "en-US": "Accept" },
  "panels.review.reject": { "zh-CN": "拒绝", "en-US": "Reject" },
  "panels.review.diff": { "zh-CN": "差异", "en-US": "Diff" },
  "panels.review.filesChanged": {
    "zh-CN": "{count} 个文件有变更",
    "en-US": "{count} files changed",
  },
  "panels.review.added": { "zh-CN": "新增", "en-US": "Added" },
  "panels.review.removed": { "zh-CN": "删除", "en-US": "Removed" },

  "titleBar.back": { "zh-CN": "后退", "en-US": "Back" },
  "titleBar.forward": { "zh-CN": "前进", "en-US": "Forward" },
  "titleBar.minimize": { "zh-CN": "最小化", "en-US": "Minimize" },
  "titleBar.maximize": { "zh-CN": "最大化", "en-US": "Maximize" },
  "titleBar.restore": { "zh-CN": "还原", "en-US": "Restore" },
  "titleBar.close": { "zh-CN": "关闭", "en-US": "Close" },
  "titleBar.sessionBranch": { "zh-CN": "分支 {name}", "en-US": "Branch {name}" },
  "titleBar.workspace": { "zh-CN": "工作区", "en-US": "Workspace" },

  "toast.copyFailed": { "zh-CN": "复制失败", "en-US": "Copy failed" },
  "toast.copied": { "zh-CN": "已复制到剪贴板", "en-US": "Copied to clipboard" },
});
