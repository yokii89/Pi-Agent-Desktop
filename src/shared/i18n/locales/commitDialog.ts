import { defineMessages } from "../types";

export const commitDialogMessages = defineMessages({
  "commitDialog.title": { "zh-CN": "提交或推送", "en-US": "Commit or push" },
  "commitDialog.subtitle": {
    "zh-CN": "提交 {project} 中的变更。",
    "en-US": "Commit changes in {project}.",
  },
  "commitDialog.branch.detached": { "zh-CN": "游离 HEAD", "en-US": "Detached HEAD" },

  "commitDialog.message.label": { "zh-CN": "提交说明", "en-US": "Commit message" },
  "commitDialog.message.placeholder": {
    "zh-CN": "输入提交说明…",
    "en-US": "Enter a commit message…",
  },

  "commitDialog.includeUnstaged": {
    "zh-CN": "包含未暂存变更",
    "en-US": "Include unstaged changes",
  },
  "commitDialog.stats.title": {
    "zh-CN": "{files} 个文件，新增 {additions} 行，删除 {deletions} 行",
    "en-US": "{files} files, {additions} added, {deletions} removed",
  },
  "commitDialog.noChanges": { "zh-CN": "无改动", "en-US": "No changes" },
  "commitDialog.noStaged": { "zh-CN": "无已暂存改动", "en-US": "No staged changes" },

  "commitDialog.push": { "zh-CN": "推送", "en-US": "Push" },
  "commitDialog.commit": { "zh-CN": "提交", "en-US": "Commit" },
  "commitDialog.commitAndPush": { "zh-CN": "提交并推送", "en-US": "Commit & push" },
  "commitDialog.committing": { "zh-CN": "提交中…", "en-US": "Committing…" },
  "commitDialog.pushing": { "zh-CN": "推送中…", "en-US": "Pushing…" },
  "commitDialog.nothingToPush": { "zh-CN": "没有待推送的提交", "en-US": "Nothing to push" },
});
