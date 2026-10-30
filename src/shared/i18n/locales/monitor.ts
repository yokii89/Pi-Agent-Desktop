import { defineMessages } from "../types";

export const monitorMessages = defineMessages({
  "monitor.aria": { "zh-CN": "会话监控", "en-US": "Session monitor" },
  "monitor.title": { "zh-CN": "会话监控", "en-US": "Session monitor" },
  "monitor.updatedAt": { "zh-CN": "更新于 {time}", "en-US": "Updated {time}" },
  /** 并列短语之间的分隔（技能名、来源标签）。 */
  "monitor.listSeparator": { "zh-CN": "、", "en-US": ", " },

  "monitor.section.env": { "zh-CN": "环境信息", "en-US": "Environment" },
  "monitor.section.procs": { "zh-CN": "后台进程", "en-US": "Background" },
  "monitor.section.capabilities": { "zh-CN": "技能与 MCP", "en-US": "Skills & MCP" },
  "monitor.section.outputs": { "zh-CN": "产出", "en-US": "Outputs" },
  "monitor.section.sources": { "zh-CN": "来源", "en-US": "Sources" },

  "monitor.env.changes.none": { "zh-CN": "无改动", "en-US": "No changes" },
  "monitor.env.changes.title": {
    "zh-CN": "{files} 个文件，新增 {additions} 行，删除 {deletions} 行",
    "en-US": "{files} files, {additions} added, {deletions} removed",
  },
  "monitor.env.changes.files": {
    "zh-CN": "{count} 个文件",
    "en-US": "{count} files",
  },
  /** 「改动」行作为按钮的可访问名称（点击进入右侧栏审阅）。 */
  "monitor.env.changes.openReview": {
    "zh-CN": "在审阅面板中查看全部 {count} 个文件的改动",
    "en-US": "Open all {count} changed files in Review",
  },
  "monitor.env.push.ahead": {
    "zh-CN": "{count} 个待推送",
    "en-US": "{count} to push",
  },
  "monitor.env.push.synced": { "zh-CN": "已同步", "en-US": "Up to date" },
  "monitor.env.push.noUpstream": { "zh-CN": "无上游分支", "en-US": "No upstream" },
  /** 「提交或推送」入口行：右缘仍显示推送状态（待推送 / 已同步 / 无上游）。 */
  "monitor.env.commit.action": { "zh-CN": "提交或推送", "en-US": "Commit or push" },
  "monitor.env.commit.open": {
    "zh-CN": "打开提交或推送浮窗",
    "en-US": "Open commit or push",
  },
  /** 「工作目录」行：点击在资源管理器中打开。 */
  "monitor.env.dir.open": {
    "zh-CN": "在资源管理器中打开 {name}",
    "en-US": "Open {name} in File Explorer",
  },

  "monitor.procs.running": { "zh-CN": "运行中", "en-US": "Running" },

  "monitor.capabilities.skillCount": {
    "zh-CN": "{count} 个技能",
    "en-US": "{count} skills",
  },
  "monitor.capabilities.mcp": { "zh-CN": "MCP", "en-US": "MCP" },
  "monitor.capabilities.mcpCount": {
    "zh-CN": "{count} 个已启用",
    "en-US": "{count} enabled",
  },
  "monitor.capabilities.dirty": { "zh-CN": "需重载", "en-US": "Reload needed" },
});
