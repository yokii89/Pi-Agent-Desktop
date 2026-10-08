import { defineMessages } from "../types";

/** 定时任务（docs 30 §2.4）全部用户可见文案。 */
export const scheduledMessages = defineMessages({
  "sidenav.scheduled": { "zh-CN": "定时任务", "en-US": "Scheduled tasks" },

  "scheduled.title": { "zh-CN": "定时任务", "en-US": "Scheduled tasks" },
  "scheduled.subtitle": {
    "zh-CN": "到点自动向指定项目的会话发送提示词；PiDesk 运行期间才会触发。",
    "en-US":
      "Sends a prompt to a project's session on schedule; triggers fire only while PiDesk is running.",
  },
  "scheduled.newTask": { "zh-CN": "新建任务", "en-US": "New task" },
  "scheduled.count": { "zh-CN": "{n} 个任务", "en-US": "{n} tasks" },
  "scheduled.empty.title": { "zh-CN": "还没有定时任务", "en-US": "No scheduled tasks yet" },
  "scheduled.empty.description": {
    "zh-CN": "创建一个任务，让 Agent 定时巡检依赖、整理目录或执行巡检脚本。",
    "en-US":
      "Create a task to let the Agent check dependencies, tidy folders or run inspections on a schedule.",
  },

  "scheduled.row.disabled": { "zh-CN": "已停用", "en-US": "Paused" },
  "scheduled.row.nextRun": { "zh-CN": "下次 {time}", "en-US": "Next {time}" },
  "scheduled.row.nextRun.overdue": { "zh-CN": "等待补跑", "en-US": "Catch-up pending" },
  "scheduled.row.noNextRun": { "zh-CN": "无后续计划", "en-US": "No further runs" },
  "scheduled.row.lastRun": { "zh-CN": "上次运行 {time}", "en-US": "Last run {time}" },
  "scheduled.row.ran": { "zh-CN": "已运行 {n} 次", "en-US": "{n} runs" },
  "scheduled.row.skipped": { "zh-CN": "跳过 {n} 次", "en-US": "{n} skipped" },
  "scheduled.row.missedBadge": {
    "zh-CN": "错过 {n} 个触发点后补跑",
    "en-US": "Ran late after missing {n} triggers",
  },
  "scheduled.row.menu.runNow": { "zh-CN": "立即运行", "en-US": "Run now" },
  "scheduled.row.menu.history": { "zh-CN": "运行历史", "en-US": "Run history" },
  "scheduled.row.menu.edit": { "zh-CN": "编辑", "en-US": "Edit" },
  "scheduled.row.menu.delete": { "zh-CN": "删除", "en-US": "Delete" },

  "scheduled.rule.interval.minutes": { "zh-CN": "每 {n} 分钟", "en-US": "Every {n} min" },
  "scheduled.rule.interval.hours": { "zh-CN": "每 {n} 小时", "en-US": "Every {n} h" },
  "scheduled.rule.daily": { "zh-CN": "每天 {time}", "en-US": "Daily at {time}" },
  "scheduled.rule.weekdays": { "zh-CN": "{days} {time}", "en-US": "{days} at {time}" },
  "scheduled.rule.once": { "zh-CN": "{datetime} · 一次性", "en-US": "{datetime} · one-off" },
  "scheduled.weekday.0": { "zh-CN": "周日", "en-US": "Sun" },
  "scheduled.weekday.1": { "zh-CN": "周一", "en-US": "Mon" },
  "scheduled.weekday.2": { "zh-CN": "周二", "en-US": "Tue" },
  "scheduled.weekday.3": { "zh-CN": "周三", "en-US": "Wed" },
  "scheduled.weekday.4": { "zh-CN": "周四", "en-US": "Thu" },
  "scheduled.weekday.5": { "zh-CN": "周五", "en-US": "Fri" },
  "scheduled.weekday.6": { "zh-CN": "周六", "en-US": "Sat" },
  "scheduled.weekdays.workday": { "zh-CN": "工作日", "en-US": "Weekdays" },

  "scheduled.dialog.create.title": { "zh-CN": "新建定时任务", "en-US": "New scheduled task" },
  "scheduled.dialog.edit.title": { "zh-CN": "编辑定时任务", "en-US": "Edit scheduled task" },
  "scheduled.dialog.section.basic": { "zh-CN": "基本信息", "en-US": "Basics" },
  "scheduled.dialog.unit.minutes": { "zh-CN": "分钟", "en-US": "min" },
  "scheduled.dialog.preview.label": { "zh-CN": "下次运行", "en-US": "Next run" },
  "scheduled.dialog.name": { "zh-CN": "任务名称", "en-US": "Name" },
  "scheduled.dialog.name.placeholder": {
    "zh-CN": "例如：每天巡检依赖更新",
    "en-US": "e.g. Daily dependency check",
  },
  "scheduled.dialog.cwd": { "zh-CN": "工作目录", "en-US": "Working directory" },
  "scheduled.dialog.cwd.description": {
    "zh-CN": "触发时 pi 会话的启动目录。",
    "en-US": "Directory the pi session starts in when the task fires.",
  },
  "scheduled.dialog.cwd.browse": { "zh-CN": "浏览…", "en-US": "Browse…" },
  "scheduled.dialog.schedule": { "zh-CN": "触发计划", "en-US": "Schedule" },
  "scheduled.dialog.schedule.interval": { "zh-CN": "每 N 分钟", "en-US": "Every N minutes" },
  "scheduled.dialog.schedule.daily": { "zh-CN": "每天", "en-US": "Daily" },
  "scheduled.dialog.schedule.once": { "zh-CN": "一次性", "en-US": "One-off" },
  "scheduled.dialog.intervalMinutes": { "zh-CN": "间隔（分钟）", "en-US": "Interval (minutes)" },
  "scheduled.dialog.dailyTime": { "zh-CN": "触发时刻", "en-US": "Time of day" },
  "scheduled.dialog.weekdays": { "zh-CN": "重复于", "en-US": "Repeat on" },
  "scheduled.dialog.onceAt": { "zh-CN": "触发时间", "en-US": "Date & time" },
  "scheduled.dialog.target": { "zh-CN": "运行方式", "en-US": "Run mode" },
  "scheduled.dialog.target.new": { "zh-CN": "每次新建会话", "en-US": "New session each run" },
  "scheduled.dialog.target.new.description": {
    "zh-CN": "每轮独立上下文；上一轮的进程会在下一轮触发时结束（历史保留）。",
    "en-US":
      "Fresh context per run; the previous run's process ends when the next one fires (history kept).",
  },
  "scheduled.dialog.target.bound": { "zh-CN": "绑定既有会话", "en-US": "Bind to session" },
  "scheduled.dialog.target.bound.description": {
    "zh-CN": "触发时向同一会话续发提示词，上下文累积。",
    "en-US": "Continues the same conversation each run; context accumulates.",
  },
  "scheduled.dialog.target.bound.required": {
    "zh-CN": "请选择要绑定的会话，或改回「每次新建会话」。",
    "en-US": 'Pick a session to bind, or switch back to "new session each run".',
  },
  "scheduled.dialog.target.pick": { "zh-CN": "选择会话", "en-US": "Pick a session" },
  "scheduled.dialog.prompt": { "zh-CN": "提示词", "en-US": "Prompt" },
  "scheduled.dialog.prompt.placeholder": {
    "zh-CN": "到点后自动发送给 Agent 的指令……",
    "en-US": "Instruction sent to the Agent when the task fires…",
  },
  "scheduled.dialog.prompt.hint": {
    "zh-CN": "提示词按当前激活凭据与默认模型执行。",
    "en-US": "Runs with the active credential and default model.",
  },
  "scheduled.dialog.preview.none": {
    "zh-CN": "无后续触发点",
    "en-US": "No upcoming trigger",
  },
  "scheduled.dialog.next": { "zh-CN": "下一步", "en-US": "Next" },
  "scheduled.dialog.back": { "zh-CN": "上一步", "en-US": "Back" },
  "scheduled.dialog.submit.create": { "zh-CN": "确认创建", "en-US": "Create task" },
  "scheduled.dialog.submit.save": { "zh-CN": "确认保存", "en-US": "Save changes" },
  "scheduled.dialog.step.form": { "zh-CN": "填写", "en-US": "Details" },
  "scheduled.dialog.step.confirm": { "zh-CN": "确认", "en-US": "Confirm" },

  "scheduled.confirm.title": { "zh-CN": "确认任务影响范围", "en-US": "Confirm task impact" },
  "scheduled.confirm.impact": {
    "zh-CN": "该任务将无人值守地自动运行：",
    "en-US": "This task will run unattended:",
  },
  "scheduled.confirm.target.new": {
    "zh-CN": "每次触发新建会话并发送提示词",
    "en-US": "Each trigger starts a new session and sends the prompt",
  },
  "scheduled.confirm.target.bound": {
    "zh-CN": "每次触发向绑定会话续发提示词",
    "en-US": "Each trigger continues the bound session with the prompt",
  },
  "scheduled.confirm.warning": {
    "zh-CN":
      "Agent 将以当前激活凭据在上述目录内自主操作（可能读取文件、执行命令、写盘）并消耗 token；PiDesk 未运行期间错过的触发点，将在下次启动时补跑一次并标注。",
    "en-US":
      "The Agent will act autonomously in the directory above with the active credential (it may read files, run commands and write to disk) and consume tokens. Triggers missed while PiDesk is closed run once on next launch and are marked as missed.",
  },

  "scheduled.runs.title": { "zh-CN": "运行历史", "en-US": "Run history" },
  "scheduled.runs.empty": { "zh-CN": "还没有运行记录", "en-US": "No runs yet" },
  "scheduled.runs.col.scheduledAt": { "zh-CN": "计划时刻", "en-US": "Scheduled" },
  "scheduled.runs.col.trigger": { "zh-CN": "触发", "en-US": "Trigger" },
  "scheduled.runs.col.deviation": { "zh-CN": "偏差", "en-US": "Deviation" },
  "scheduled.runs.trigger.schedule": { "zh-CN": "定时", "en-US": "Scheduled" },
  "scheduled.runs.trigger.catchUp": { "zh-CN": "错过补跑", "en-US": "Catch-up" },
  "scheduled.runs.trigger.manual": { "zh-CN": "手动", "en-US": "Manual" },
  "scheduled.runs.status.dispatched": { "zh-CN": "已派发", "en-US": "Dispatched" },
  "scheduled.runs.status.skipped": { "zh-CN": "已跳过", "en-US": "Skipped" },
  "scheduled.runs.status.failed": { "zh-CN": "派发失败", "en-US": "Failed to dispatch" },
  "scheduled.runs.skip.conflict": { "zh-CN": "上一轮未结束", "en-US": "Previous run still active" },
  "scheduled.runs.skip.expired": {
    "zh-CN": "一次性任务已过期",
    "en-US": "One-off task expired",
  },
  "scheduled.runs.missed": { "zh-CN": "错过 {n} 个触发点", "en-US": "{n} triggers missed" },
  "scheduled.runs.finished": { "zh-CN": "已完成", "en-US": "Finished" },
  "scheduled.runs.openSession": { "zh-CN": "打开会话", "en-US": "Open session" },
  "scheduled.runs.error": { "zh-CN": "错误：{error}", "en-US": "Error: {error}" },

  "scheduled.toast.created": { "zh-CN": "定时任务已创建", "en-US": "Scheduled task created" },
  "scheduled.toast.saved": { "zh-CN": "定时任务已保存", "en-US": "Scheduled task saved" },
  "scheduled.toast.removed": { "zh-CN": "定时任务已删除", "en-US": "Scheduled task deleted" },
  "scheduled.toast.enabled": { "zh-CN": "任务已启用", "en-US": "Task enabled" },
  "scheduled.toast.disabled": { "zh-CN": "任务已停用", "en-US": "Task paused" },
  "scheduled.toast.runDispatched": { "zh-CN": "已派发一次运行", "en-US": "Run dispatched" },
  "scheduled.toast.runSkipped": {
    "zh-CN": "上一轮尚未结束，本次已跳过",
    "en-US": "Previous run still active; this run was skipped",
  },

  "scheduled.settings.open": { "zh-CN": "打开定时任务", "en-US": "Open scheduled tasks" },
  "scheduled.settings.summary.none": {
    "zh-CN": "尚未创建定时任务。",
    "en-US": "No scheduled tasks yet.",
  },
  "scheduled.settings.summary.next": {
    "zh-CN": "{n} 个任务，{m} 个启用中；下次触发 {time}。",
    "en-US": "{n} tasks, {m} enabled; next trigger at {time}.",
  },
  "scheduled.settings.summary.next.none": {
    "zh-CN": "{n} 个任务，{m} 个启用中；当前没有待触发的计划。",
    "en-US": "{n} tasks, {m} enabled; nothing scheduled right now.",
  },

  "scheduled.deleteConfirm.title": { "zh-CN": "删除定时任务？", "en-US": "Delete this task?" },
  "scheduled.deleteConfirm.message": {
    "zh-CN": "将删除「{name}」及其运行历史，绑定会话的聊天记录不受影响。",
    "en-US":
      'This removes "{name}" and its run history; the bound session\'s chat history is kept.',
  },
  "scheduled.deleteConfirm.confirm": { "zh-CN": "删除", "en-US": "Delete" },
});
