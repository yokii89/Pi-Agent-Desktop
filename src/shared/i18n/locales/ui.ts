import { defineMessages } from "../types";

/** 通用 UI 壳层、扩展 View 宿主占位、审阅 Diff、本轮撤销确认框。 */
export const uiMessages = defineMessages({
  // Extension View 宿主占位与 chrome（扩展协议内容本身不翻译）
  "ui.view.selectPlaceholder": { "zh-CN": "请选择", "en-US": "Select…" },
  "ui.view.unsupportedNode": {
    "zh-CN": "未支持的视图节点类型，已降级为占位",
    "en-US": "Unsupported view node type; shown as a placeholder",
  },
  "ui.view.unsupportedNodeShort": {
    "zh-CN": "[不支持的节点]",
    "en-US": "[Unsupported node]",
  },
  "ui.view.tableEmpty": { "zh-CN": "暂无数据", "en-US": "No data" },
  "ui.view.tableTruncation": {
    "zh-CN": "显示 {shown} / 共 {total}",
    "en-US": "Showing {shown} of {total}",
  },
  "ui.view.tabAnswered": { "zh-CN": "{label}（已作答）", "en-US": "{label} (answered)" },
  "ui.view.tabAttention": { "zh-CN": "{label}（未完成）", "en-US": "{label} (incomplete)" },
  "ui.view.fallbackTitle": { "zh-CN": "扩展", "en-US": "Extension" },
  "ui.view.fallbackTitleView": { "zh-CN": "扩展视图", "en-US": "Extension view" },
  "ui.view.fallbackTitleSettings": { "zh-CN": "扩展设置", "en-US": "Extension settings" },
  "ui.view.closeTitled": { "zh-CN": "关闭 {title}", "en-US": "Close {title}" },
  "ui.view.closeExtension": { "zh-CN": "关闭扩展", "en-US": "Close extension" },
  "ui.view.closePanel": { "zh-CN": "关闭面板", "en-US": "Close panel" },
  "ui.view.removeSettings": {
    "zh-CN": "移除此扩展设置",
    "en-US": "Remove this extension settings card",
  },

  // 审阅 / Diff
  "ui.review.unmodifiedOne": { "zh-CN": "未改动 {count} 行", "en-US": "{count} unmodified line" },
  "ui.review.unmodifiedMany": {
    "zh-CN": "未改动 {count} 行",
    "en-US": "{count} unmodified lines",
  },
  "ui.review.loadingDiff": { "zh-CN": "读取差异…", "en-US": "Loading diff…" },
  "ui.review.diffFailed": { "zh-CN": "差异读取失败", "en-US": "Failed to load diff" },
  "ui.review.binaryChanged": { "zh-CN": "二进制文件已更改", "en-US": "Binary file changed" },
  "ui.review.hasConflicts": {
    "zh-CN": "存在未解决的合并冲突",
    "en-US": "Unresolved merge conflicts",
  },
  "ui.review.resolveInTerminal": {
    "zh-CN": "请在终端中解决后继续。",
    "en-US": "Resolve them in the terminal, then continue.",
  },
  "ui.review.truncated": {
    "zh-CN": "差异过大，仅显示前一部分。",
    "en-US": "Diff is large; only the first part is shown.",
  },
  "ui.review.noContentDiff": { "zh-CN": "没有内容差异", "en-US": "No content changes" },
  "ui.review.pathOnly": {
    "zh-CN": "仅路径变化（重命名/复制）。",
    "en-US": "Path only (rename/copy).",
  },
  "ui.review.noChangeInLayer": {
    "zh-CN": "该文件在此 diff 层没有内容变化。",
    "en-US": "No content changes for this file in this diff layer.",
  },

  // 撤销本轮文件改动
  "ui.rollback.title": {
    "zh-CN": "撤销本轮文件改动",
    "en-US": "Undo this turn's file changes",
  },
  "ui.rollback.block.ready": {
    "zh-CN": "撤销本轮文件改动",
    "en-US": "Undo this turn's file changes",
  },
  "ui.rollback.block.notRepo": {
    "zh-CN": "当前目录不是 Git 仓库，无法撤销文件改动",
    "en-US": "Current folder is not a Git repo; cannot undo file changes",
  },
  "ui.rollback.block.noSnapshot": {
    "zh-CN": "本轮开始前的工作区快照不可用（恢复会话或快照未完成）",
    "en-US":
      "Workspace snapshot from before this turn is unavailable (restored session or snapshot incomplete)",
  },
  "ui.rollback.block.committed": {
    "zh-CN": "本轮改动已提交，请在 Git 历史中处理",
    "en-US": "This turn's changes are committed; handle them in Git history",
  },
  "ui.rollback.block.empty": {
    "zh-CN": "本轮没有可撤销的工作区改动",
    "en-US": "No workspace changes to undo this turn",
  },
  "ui.rollback.block.rolling": { "zh-CN": "撤销中…", "en-US": "Undoing…" },
  "ui.rollback.block.noSession": {
    "zh-CN": "撤销仅对当前应用会话中、最近一轮 Agent 任务有效",
    "en-US": "Undo applies only to the latest Agent turn in the current app session",
  },
  "ui.rollback.successRestoreDelete": {
    "zh-CN": "已撤销：还原 {restored} 个文件，删除 {deleted} 个新建文件",
    "en-US": "Undone: restored {restored} files, deleted {deleted} new files",
  },
  "ui.rollback.successRestore": {
    "zh-CN": "已撤销：还原 {restored} 个文件",
    "en-US": "Undone: restored {restored} files",
  },
  "ui.rollback.failed": { "zh-CN": "撤销失败", "en-US": "Undo failed" },
  "ui.rollback.confirm": { "zh-CN": "撤销", "en-US": "Undo" },
  "ui.rollback.checking": { "zh-CN": "核对中…", "en-US": "Checking…" },
  "ui.rollback.undoing": { "zh-CN": "撤销中…", "en-US": "Undoing…" },
  "ui.rollback.checkingLead": {
    "zh-CN": "正在核对本轮改动…",
    "en-US": "Checking this turn's changes…",
  },
  "ui.rollback.lead": {
    "zh-CN": "确定撤销本轮对 {count} 个文件的改动？",
    "en-US": "Undo changes to {count} files from this turn?",
  },
  "ui.rollback.moreFiles": {
    "zh-CN": "另有 {count} 个文件",
    "en-US": "{count} more files",
  },
  "ui.rollback.bullet.restoreStart1": {
    "zh-CN": "将还原到本轮 Agent ",
    "en-US": "Restores files to the state ",
  },
  "ui.rollback.bullet.restoreStart2": { "zh-CN": "开始前", "en-US": "before" },
  "ui.rollback.bullet.restoreStart3": {
    "zh-CN": "的状态",
    "en-US": " this turn's Agent run",
  },
  "ui.rollback.bullet.keepEarlier": {
    "zh-CN": "既有文件只回退本轮编辑，更早回合与你的未提交改动会保留",
    "en-US":
      "Existing files only roll back this turn's edits; earlier turns and your uncommitted work stay",
  },
  "ui.rollback.bullet.deleteNewCount": {
    "zh-CN": "本轮新建的 {count} 个文件会被删除，且不可恢复",
    "en-US": "{count} files created this turn will be deleted and cannot be recovered",
  },
  "ui.rollback.bullet.deleteNew": {
    "zh-CN": "本轮新建的文件会被删除，且不可恢复",
    "en-US": "Files created this turn will be deleted and cannot be recovered",
  },
  "ui.rollback.bullet.restoreCount": {
    "zh-CN": "本轮修改/删除的 {count} 个文件会被还原或恢复",
    "en-US": "{count} files changed or deleted this turn will be restored",
  },
  "ui.rollback.bullet.noUndo1": {
    "zh-CN": "撤销执行后",
    "en-US": "This undo ",
  },
  "ui.rollback.bullet.noUndo2": {
    "zh-CN": "不可再次撤销",
    "en-US": "cannot be undone again",
  },
  "ui.rollback.bullet.noUndo3": { "zh-CN": "", "en-US": "." },
  "ui.rollback.conflictOverwrite": {
    "zh-CN": "以下文件在本轮结束后已被修改，撤销会覆盖这些改动：",
    "en-US": "These files were edited after the turn ended; undoing will overwrite those edits:",
  },
  "ui.rollback.conflictDelete": {
    "zh-CN": "以下本轮新建文件已被修改，撤销会将其删除：",
    "en-US": "These files were created this turn and later edited; undoing will delete them:",
  },
  "ui.rollback.risk": {
    "zh-CN":
      "若本轮结束后你手工改过其中文件，改动会被一并覆盖。已 git add 的暂存内容不会被还原，请自行处理暂存区。",
    "en-US":
      "If you edited these files after the turn ended, those edits will be overwritten. Staged (git add) content is not restored — handle the index yourself.",
  },
});
