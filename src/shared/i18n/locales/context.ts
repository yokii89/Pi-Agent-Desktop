import { defineMessages } from "../types";

/**
 * 右侧上下文侧栏（审查 / 文件 / 图谱）文案。
 * 已有 `panels.context.*` / `panels.files.*` / `panels.review.*` 优先复用（见 panels.ts）；
 * 本文件只补当前 UI 确有、panels.ts 尚无的 key，键名仍落在同域下。
 */
export const contextMessages = defineMessages({
  // —— ContextSidebar 壳 ——
  "panels.context.sidebarLabel": {
    "zh-CN": "上下文工具栏",
    "en-US": "Context tools",
  },
  "panels.context.resizeWidth": {
    "zh-CN": "拖拽调整宽度",
    "en-US": "Drag to resize width",
  },
  "panels.context.tabList": { "zh-CN": "工具面板", "en-US": "Tool panels" },
  "panels.context.extensionFallback": { "zh-CN": "扩展", "en-US": "Extension" },
  "panels.context.connecting": { "zh-CN": "连接中…", "en-US": "Connecting…" },
  "panels.context.openPanel": { "zh-CN": "打开面板", "en-US": "Open panel" },
  "panels.context.activateFailed": {
    "zh-CN": "激活失败，点击上方 Tab 重试",
    "en-US": "Activation failed. Click the tab above to retry.",
  },
  "panels.context.collapseSidebar": {
    "zh-CN": "收起侧栏",
    "en-US": "Collapse sidebar",
  },
  "context.back": { "zh-CN": "返回", "en-US": "Back" },

  // —— FilePanel ——
  "panels.files.backPrevious": {
    "zh-CN": "返回上一个文件",
    "en-US": "Back to previous file",
  },
  "panels.files.backToTree": {
    "zh-CN": "返回文件树",
    "en-US": "Back to file tree",
  },
  "panels.files.forwardNext": {
    "zh-CN": "前进到下一个文件",
    "en-US": "Forward to next file",
  },
  "panels.files.openInSystem": {
    "zh-CN": "用系统应用打开",
    "en-US": "Open with system app",
  },
  "panels.files.quickOpenPlaceholder": {
    "zh-CN": "快速打开文件（Enter 打开首个匹配）",
    "en-US": "Quick open (Enter opens first match)",
  },
  "panels.files.selectProject": {
    "zh-CN": "选择项目后浏览文件",
    "en-US": "Select a project to browse files",
  },
  "panels.files.loading": { "zh-CN": "读取中…", "en-US": "Loading…" },
  "panels.files.noMatch": {
    "zh-CN": "无匹配文件",
    "en-US": "No matching files",
  },
  "panels.files.cannotPreview": {
    "zh-CN": "无法在侧栏预览",
    "en-US": "Preview not available here",
  },
  "panels.files.binaryFile": { "zh-CN": "二进制文件", "en-US": "Binary file" },
  "panels.files.truncatedNote": {
    "zh-CN": "文件较大，仅显示前 1MB。",
    "en-US": "File is large; showing first 1MB only.",
  },
  "panels.files.notFound": {
    "zh-CN": "文件不存在：{path}",
    "en-US": "File not found: {path}",
  },
  "panels.files.openFailed": {
    "zh-CN": "无法打开：{path}",
    "en-US": "Cannot open: {path}",
  },
  "panels.files.systemOpenFailed": {
    "zh-CN": "系统打开失败",
    "en-US": "Failed to open with system app",
  },
  "panels.files.readFailed": {
    "zh-CN": "无法读取该文件",
    "en-US": "Cannot read this file",
  },
  "panels.files.lineCount": { "zh-CN": "{count} 行", "en-US": "{count} lines" },

  // —— FileTree ——
  "panels.files.dirTruncated": {
    "zh-CN": "…（目录项过多，已截断）",
    "en-US": "… (too many entries, truncated)",
  },
  "panels.files.readDirFailed": {
    "zh-CN": "无法读取目录",
    "en-US": "Cannot read folder",
  },
  "panels.files.emptyDir": { "zh-CN": "空文件夹", "en-US": "Empty folder" },

  // —— MarkdownPreview ——
  "panels.files.mdPreview": { "zh-CN": "预览", "en-US": "Preview" },
  "panels.files.mdSource": { "zh-CN": "源码", "en-US": "Source" },

  // —— ReviewWindow（代码审查浮窗；原侧栏 ReviewPanel）——
  "panels.review.windowTitle": { "zh-CN": "代码审查", "en-US": "Code Review" },
  "panels.review.closeWindow": { "zh-CN": "关闭", "en-US": "Close" },
  "panels.review.openAsFloat": { "zh-CN": "转为浮窗", "en-US": "Open as floating window" },
  "panels.review.dockToSidebar": { "zh-CN": "停靠侧栏", "en-US": "Dock to sidebar" },
  "panels.review.headerSummary": {
    "zh-CN": "{files} 个文件 · +{additions} −{deletions}",
    "en-US": "{files} files · +{additions} −{deletions}",
  },
  "panels.review.filterLabel": { "zh-CN": "变更筛选", "en-US": "Change filter" },
  "panels.review.layer.untracked": { "zh-CN": "未跟踪", "en-US": "Untracked" },
  "panels.review.layer.staged": { "zh-CN": "已暂存", "en-US": "Staged" },
  "panels.review.layer.unstaged": { "zh-CN": "未暂存", "en-US": "Unstaged" },
  "panels.review.detailEmpty": {
    "zh-CN": "选择左侧文件查看差异",
    "en-US": "Select a file to see its diff",
  },
  "panels.review.viewLabel": { "zh-CN": "审查视图", "en-US": "Review views" },
  "panels.review.viewChanges": { "zh-CN": "变更", "en-US": "Changes" },
  "panels.review.viewGraph": { "zh-CN": "图谱", "en-US": "Graph" },
  "panels.review.refresh": { "zh-CN": "刷新", "en-US": "Refresh" },
  "panels.review.filter.unstaged": { "zh-CN": "未暂存", "en-US": "Unstaged" },
  "panels.review.filter.staged": { "zh-CN": "已暂存", "en-US": "Staged" },
  "panels.review.filter.all": {
    "zh-CN": "全部分支更改",
    "en-US": "All branch changes",
  },
  "panels.review.filter.lastRound": {
    "zh-CN": "上一轮更改",
    "en-US": "Last turn changes",
  },
  "panels.review.emptyUnstaged": {
    "zh-CN": "没有未暂存的变更。",
    "en-US": "No unstaged changes.",
  },
  "panels.review.emptyStaged": {
    "zh-CN": "没有已暂存的变更。",
    "en-US": "No staged changes.",
  },
  "panels.review.emptyAll": {
    "zh-CN": "工作区是干净的。",
    "en-US": "Working tree is clean.",
  },
  "panels.review.emptyLastRound": {
    "zh-CN": "完成一轮 Agent 任务后，这里会显示该轮产生的变更。",
    "en-US": "After an agent turn, changes from that turn appear here.",
  },
  "panels.review.lastRoundCommitted": {
    "zh-CN": "本轮改动已提交，请在 Git 历史中处理。",
    "en-US": "This turn's changes are committed. Handle them in Git history.",
  },
  "panels.review.lastRoundNotRepo": {
    "zh-CN": "当前目录不是 Git 仓库，无法撤销文件改动。",
    "en-US": "Current folder is not a Git repo; file rollback unavailable.",
  },
  "panels.review.noChanges": { "zh-CN": "没有变更", "en-US": "No changes" },
  "panels.review.noProject": {
    "zh-CN": "未选择项目",
    "en-US": "No project selected",
  },
  "panels.review.noProjectHint": {
    "zh-CN": "选择项目或开始会话后，这里会显示 Git 变更。",
    "en-US": "Select a project or start a session to see Git changes.",
  },
  "panels.review.loading": {
    "zh-CN": "正在读取 Git 变更…",
    "en-US": "Reading Git changes…",
  },
  "panels.review.notRepo": {
    "zh-CN": "当前目录不是 Git 仓库",
    "en-US": "Not a Git repository",
  },
  "panels.review.error": {
    "zh-CN": "Git 仓库读取失败",
    "en-US": "Failed to read Git repository",
  },
  "panels.review.errorHint": {
    "zh-CN": "请点击刷新重试。",
    "en-US": "Click refresh to retry.",
  },
  "panels.review.rollbackPrompt": {
    "zh-CN": "不满意本轮改动？可还原到任务开始前",
    "en-US": "Not happy with this turn? Roll back to before the task.",
  },
  "panels.review.rollback": { "zh-CN": "撤销本轮", "en-US": "Roll back turn" },
  "panels.review.rollingBack": { "zh-CN": "撤销中…", "en-US": "Rolling back…" },

  // —— ReviewWindow：Git 写操作工具条（docs/design 30 §2.1）——
  "panels.review.commitPlaceholder": {
    "zh-CN": "提交信息（Ctrl+Enter 提交）",
    "en-US": "Commit message (Ctrl+Enter to commit)",
  },
  "panels.review.stageAll": { "zh-CN": "暂存全部", "en-US": "Stage all" },
  "panels.review.unstageAll": { "zh-CN": "取消暂存", "en-US": "Unstage all" },
  "panels.review.commit": { "zh-CN": "提交", "en-US": "Commit" },
  "panels.review.committing": { "zh-CN": "提交中…", "en-US": "Committing…" },
  "panels.review.push": { "zh-CN": "推送", "en-US": "Push" },
  "panels.review.stagedSummary": {
    "zh-CN": "已暂存 {count}",
    "en-US": "{count} staged",
  },
  "panels.review.stageFile": { "zh-CN": "暂存", "en-US": "Stage" },
  "panels.review.unstageFile": { "zh-CN": "取消暂存", "en-US": "Unstage" },
  "panels.review.discardFile": {
    "zh-CN": "丢弃改动",
    "en-US": "Discard changes",
  },
  "panels.review.discardConfirmTitle": {
    "zh-CN": "丢弃本地改动？",
    "en-US": "Discard local changes?",
  },
  "panels.review.discardConfirmMessage": {
    "zh-CN": "将永久丢弃 {count} 个文件的本地改动，未跟踪的新文件会被删除。此操作不可撤销。",
    "en-US":
      "This permanently discards local changes in {count} file(s); untracked new files will be deleted. This cannot be undone.",
  },
  "panels.review.discardConfirm": { "zh-CN": "丢弃", "en-US": "Discard" },
  "panels.review.discardedToast": {
    "zh-CN": "已丢弃：还原 {restored} 个、删除 {removed} 个",
    "en-US": "Discarded: restored {restored}, removed {removed}",
  },
  "panels.review.stagedToast": {
    "zh-CN": "已暂存 {count} 个文件",
    "en-US": "Staged {count} file(s)",
  },
  "panels.review.unstagedToast": {
    "zh-CN": "已取消暂存 {count} 个文件",
    "en-US": "Unstaged {count} file(s)",
  },
  "panels.review.committedToast": {
    "zh-CN": "已提交 {shortOid}",
    "en-US": "Committed {shortOid}",
  },
  "panels.review.commitNeedMessage": {
    "zh-CN": "请先填写提交信息",
    "en-US": "Enter a commit message first",
  },
  "panels.review.commitNeedStaged": {
    "zh-CN": "没有已暂存的改动，请先暂存",
    "en-US": "Nothing staged. Stage changes first.",
  },
  "panels.review.pushConfirmTitle": {
    "zh-CN": "推送到远程？",
    "en-US": "Push to remote?",
  },
  "panels.review.pushConfirmMessage": {
    "zh-CN": "将把 {branch} 推送到 {remote}/{remoteBranch}，共 {ahead} 个本地领先的提交。",
    "en-US": "This pushes {branch} to {remote}/{remoteBranch} — {ahead} local commit(s) ahead.",
  },
  "panels.review.pushSetUpstreamNote": {
    "zh-CN": "当前分支尚无 upstream，推送时会一并设置。",
    "en-US": "This branch has no upstream yet; it will be set during push.",
  },
  "panels.review.pushedToast": {
    "zh-CN": "已推送到 {remote}/{branch}",
    "en-US": "Pushed to {remote}/{branch}",
  },
  "panels.review.pushPlanFailed": {
    "zh-CN": "无法确定推送目标：{message}",
    "en-US": "Cannot resolve push target: {message}",
  },
  "panels.review.operationFailed": {
    "zh-CN": "操作失败：{message}",
    "en-US": "Operation failed: {message}",
  },

  // —— GitGraphPanel ——
  "context.graph.loading": {
    "zh-CN": "正在读取提交历史…",
    "en-US": "Reading commit history…",
  },
  "context.graph.readFailed": {
    "zh-CN": "读取提交历史失败",
    "en-US": "Failed to read commit history",
  },
  "context.graph.noProject": {
    "zh-CN": "选择项目或开始会话后，这里会显示提交图谱。",
    "en-US": "Select a project or start a session to see the commit graph.",
  },
  "context.graph.notRepo": {
    "zh-CN": "当前目录不是 Git 仓库",
    "en-US": "Not a Git repository",
  },
  "context.graph.empty": { "zh-CN": "暂无提交", "en-US": "No commits yet" },
  "context.graph.untitled": { "zh-CN": "(无标题)", "en-US": "(no subject)" },
  "context.graph.rootCommit": { "zh-CN": "根提交", "en-US": "Root commit" },
  "context.graph.parentCommits": {
    "zh-CN": "{count} 个父提交",
    "en-US": "{count} parent commits",
  },
  "context.graph.truncated": {
    "zh-CN": "仅显示最近 {count} 条提交",
    "en-US": "Showing only the latest {count} commits",
  },
});
