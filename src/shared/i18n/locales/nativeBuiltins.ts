import { defineMessages } from "../types";
export const nativeMessages = defineMessages({
  "native.mode": { "zh-CN": "访问模式", "en-US": "Access mode" },
  "native.plan": { "zh-CN": "计划模式", "en-US": "Plan mode" },
  "native.plan.description": {
    "zh-CN": "只读探索，审核计划后执行",
    "en-US": "Read-only exploration; review the plan before execution",
  },
  "native.review": {
    "zh-CN": "计划已准备好，请选择下一步",
    "en-US": "The plan is ready. Choose the next step",
  },
  "native.plan.execute": { "zh-CN": "在本会话执行", "en-US": "Execute here" },
  "native.plan.new": { "zh-CN": "在新会话执行", "en-US": "Execute in new session" },
  "native.plan.explore": { "zh-CN": "继续探索", "en-US": "Keep exploring" },
  "native.plan.save": { "zh-CN": "仅保存计划", "en-US": "Save plan only" },
  "native.questionnaire": { "zh-CN": "需要你的决定", "en-US": "Your decision is needed" },
  "native.freeText": { "zh-CN": "自由输入或补充说明", "en-US": "Your answer or additional notes" },
  "native.clearSelection": { "zh-CN": "清除选择", "en-US": "Clear selection" },
  "native.submit": { "zh-CN": "提交回答", "en-US": "Submit answers" },
  "native.interaction.closed": {
    "zh-CN": "此请求已结束或过期，答复未生效",
    "en-US": "This request has ended or expired. The reply was not applied.",
  },
  "native.jobs.truncated": {
    "zh-CN": "这里只显示保留的部分输出",
    "en-US": "Only part of the retained output is shown here.",
  },
  "native.jobs": { "zh-CN": "后台作业", "en-US": "Background jobs" },
  "native.jobs.empty": {
    "zh-CN": "当前会话没有后台作业",
    "en-US": "This session has no background jobs",
  },
  "native.jobs.stop": { "zh-CN": "停止作业", "en-US": "Stop job" },
  "native.jobs.orphaned": {
    "zh-CN": "此作业来自上次运行，仅保留日志。进程身份无法重新确认，不能在此停止。",
    "en-US":
      "This job is from a previous runtime. Its logs are available, but its process identity cannot be confirmed for stopping.",
  },
  "native.job.running": { "zh-CN": "运行中", "en-US": "Running" },
  "native.job.exited": { "zh-CN": "已退出", "en-US": "Exited" },
  "native.job.stopped": { "zh-CN": "已停止", "en-US": "Stopped" },
  "native.job.timed-out": { "zh-CN": "已超时停止", "en-US": "Timed out" },
  "native.job.orphaned": { "zh-CN": "上次运行的作业", "en-US": "Previous runtime job" },
  "telegram.title": { "zh-CN": "Telegram", "en-US": "Telegram" },
  "telegram.description": {
    "zh-CN": "将你的 Telegram 私聊连接到指定的桌面会话。连接前填写允许的用户 ID 与私聊 ID。",
    "en-US":
      "Connect your Telegram private chat to a desktop session. Enter the allowed user ID and private chat ID before connecting.",
  },
  "telegram.token": { "zh-CN": "Bot Token", "en-US": "Bot token" },
  "telegram.user": { "zh-CN": "允许的用户 ID", "en-US": "Allowed user ID" },
  "telegram.chat": { "zh-CN": "私聊 ID", "en-US": "Private chat ID" },
  "telegram.target": { "zh-CN": "绑定会话", "en-US": "Target session" },
  "telegram.bind": { "zh-CN": "绑定当前会话", "en-US": "Bind current session" },
  "telegram.connect": { "zh-CN": "连接", "en-US": "Connect" },
  "telegram.disconnect": { "zh-CN": "断开", "en-US": "Disconnect" },
  "telegram.connected": { "zh-CN": "已连接", "en-US": "Connected" },
  "telegram.disconnected": { "zh-CN": "未连接", "en-US": "Disconnected" },
  "telegram.saved": {
    "zh-CN": "Token 已加密保存；留空保留",
    "en-US": "Token is encrypted; leave blank to keep it",
  },
  "telegram.project": {
    "zh-CN": "主动发送本地完成的回答",
    "en-US": "Send completed local answers",
  },
});
