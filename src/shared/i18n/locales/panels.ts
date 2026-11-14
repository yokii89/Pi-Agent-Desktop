import { defineMessages } from "../types";

/** 右栏、底部终端、标题栏等主界面 chrome 文案。 */
export const panelMessages = defineMessages({
  "panels.context.review": { "zh-CN": "审阅", "en-US": "Review" },
  "panels.context.files": { "zh-CN": "工作区文件", "en-US": "Workspace files" },
  "panels.context.browser": { "zh-CN": "浏览器", "en-US": "Browser" },
  "panels.context.terminal": { "zh-CN": "终端", "en-US": "Terminal" },
  "panels.context.extStarting": {
    "zh-CN": "正在启动会话并连接扩展…",
    "en-US": "Starting session and connecting extensions…",
  },
  "panels.context.extDisconnected": {
    "zh-CN": "扩展尚未连接。点击下方按钮启动会话并打开面板。",
    "en-US": "Extension not connected. Use the button below to start a session and open the panel.",
  },
  "panels.context.widenHint": {
    "zh-CN": "加宽侧栏以查看完整检查器",
    "en-US": "Widen the sidebar for the full inspector",
  },
  "panels.context.widen": { "zh-CN": "加宽侧栏", "en-US": "Widen sidebar" },

  /* 面板徽章（docs/06 R7）：语义必须进可访问名称，不能只靠颜色/圆点。 */
  "panels.context.badgeAttention": {
    "zh-CN": "{title}，{count} 项需要处理",
    "en-US": "{title}, {count} need attention",
  },
  "panels.context.badgeAttentionHint": {
    "zh-CN": "{title}，有需要处理的事项",
    "en-US": "{title}, needs attention",
  },
  "panels.context.badgeSuccess": {
    "zh-CN": "{title}，{count} 项已完成",
    "en-US": "{title}, {count} completed",
  },
  "panels.context.badgeSuccessHint": {
    "zh-CN": "{title}，有新完成的事项",
    "en-US": "{title}, has new completions",
  },
  "panels.context.badgeMuted": {
    "zh-CN": "{title}，{count} 项更新",
    "en-US": "{title}, {count} updates",
  },
  "panels.context.badgeMutedHint": {
    "zh-CN": "{title}，有更新",
    "en-US": "{title}, updated",
  },

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
  "panels.files.csvRows": { "zh-CN": "{count} 行", "en-US": "{count} rows" },
  "panels.files.csvEmpty": {
    "zh-CN": "没有可显示的表格数据",
    "en-US": "No tabular data to display",
  },
  "panels.files.notebook": {
    "zh-CN": "Notebook · {count} 个单元格",
    "en-US": "Notebook · {count} cells",
  },
  "panels.files.notebookInvalid": {
    "zh-CN": "Notebook 内容无法解析，显示原始 JSON",
    "en-US": "Notebook could not be parsed; showing raw JSON",
  },
  "panels.files.notebookCode": { "zh-CN": "代码", "en-US": "Code" },
  "panels.files.notebookMarkdown": { "zh-CN": "Markdown", "en-US": "Markdown" },
  "panels.files.notebookOutput": { "zh-CN": "输出", "en-US": "Output" },
  "panels.files.pdfPage": { "zh-CN": "第 {page} / {total} 页", "en-US": "Page {page} of {total}" },
  "panels.files.pdfLoadFailed": {
    "zh-CN": "PDF 无法读取或文件已损坏",
    "en-US": "PDF could not be loaded or is damaged",
  },
  "panels.files.pdfPassword": {
    "zh-CN": "此 PDF 受密码保护，暂不支持预览",
    "en-US": "Password-protected PDFs are not supported",
  },
  "panels.files.pdfPageFailed": { "zh-CN": "页面渲染失败", "en-US": "Page rendering failed" },
  "panels.files.openInBrowser": {
    "zh-CN": "在侧栏浏览器中打开",
    "en-US": "Open in sidebar browser",
  },
  "panels.files.copyPath": { "zh-CN": "复制路径", "en-US": "Copy path" },
  "panels.files.copyRelative": {
    "zh-CN": "复制相对路径",
    "en-US": "Copy relative path",
  },
  "panels.files.copyPageText": {
    "zh-CN": "复制本页文本",
    "en-US": "Copy page text",
  },
  "panels.files.findPlaceholder": {
    "zh-CN": "在文件中查找（Enter 下一个）",
    "en-US": "Find in file (Enter for next)",
  },
  "panels.files.findNoMatch": { "zh-CN": "无匹配", "en-US": "No matches" },
  "panels.files.findPrev": { "zh-CN": "上一个匹配", "en-US": "Previous match" },
  "panels.files.findNext": { "zh-CN": "下一个匹配", "en-US": "Next match" },
  "panels.files.copyContent": { "zh-CN": "复制全文", "en-US": "Copy all text" },
  "panels.files.copySelection": {
    "zh-CN": "复制选中内容",
    "en-US": "Copy selection",
  },
  "panels.files.selectAll": { "zh-CN": "全选预览内容", "en-US": "Select all preview text" },
  "panels.files.revealInExplorer": {
    "zh-CN": "在资源管理器中显示",
    "en-US": "Show in File Explorer",
  },
  "panels.files.quoteNoSession": {
    "zh-CN": "没有进行中的会话，无法添加到输入栏",
    "en-US": "No active session to add it to",
  },
  "panels.files.openFolder": {
    "zh-CN": "打开此文件夹",
    "en-US": "Open this folder",
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
