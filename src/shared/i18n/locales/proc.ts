import { defineMessages } from "../types";

export const procMessages = defineMessages({
  "proc.card.title": { "zh-CN": "终端", "en-US": "Terminal" },
  "proc.card.count": {
    "zh-CN": "{count} 个后台运行",
    "en-US": "{count} running in background",
  },
  "proc.card.stop": { "zh-CN": "停止", "en-US": "Stop" },
  "proc.card.stopLabel": {
    "zh-CN": "停止：{name}",
    "en-US": "Stop: {name}",
  },
  "proc.card.ignore": { "zh-CN": "忽略", "en-US": "Ignore" },
  "proc.card.ignoreLabel": {
    "zh-CN": "忽略：{name}",
    "en-US": "Ignore: {name}",
  },
  "proc.card.stopping": { "zh-CN": "停止中…", "en-US": "Stopping…" },
  "proc.card.exited": { "zh-CN": "已退出", "en-US": "Exited" },
  "proc.card.stopFailed": {
    "zh-CN": "未能结束进程",
    "en-US": "Failed to stop process",
  },
  "proc.card.pidReused": {
    "zh-CN": "进程已变化，未终止",
    "en-US": "Process changed; not terminated",
  },
  "proc.elapsed.prefix": { "zh-CN": "已运行 ", "en-US": "Running for " },

  "proc.quit.title": { "zh-CN": "后台进程", "en-US": "Background processes" },
  "proc.quit.message": {
    "zh-CN": "仍有 {count} 个后台进程在运行。",
    "en-US": "{count} background processes are still running.",
  },
  "proc.quit.kill": {
    "zh-CN": "一并结束并退出",
    "en-US": "End them and quit",
  },
  "proc.quit.keep": { "zh-CN": "保留并退出", "en-US": "Keep them and quit" },
  "proc.quit.cancel": { "zh-CN": "取消", "en-US": "Cancel" },
  "proc.quit.more": {
    "zh-CN": "… 共 {count} 个",
    "en-US": "… {count} total",
  },

  "proc.endConfirm.withBackground": {
    "zh-CN": "另有 {count} 个后台进程将一并结束。",
    "en-US": "{count} background processes will also be ended.",
  },
  "proc.endConfirm.keepBackground": {
    "zh-CN": "保留后台进程",
    "en-US": "Keep background processes",
  },
  "proc.endConfirm.endTogether": {
    "zh-CN": "一并结束",
    "en-US": "End all together",
  },

  "proc.residual.warning": {
    "zh-CN": "可能存在残留服务进程，请自行检查",
    "en-US": "Residual service processes may remain; please check manually",
  },
  "proc.card.sessionEndedHint": {
    "zh-CN": "会话已结束，可手动停止后台进程",
    "en-US": "Session ended — stop background processes manually",
  },
  "proc.card.header": {
    "zh-CN": "终端 · {count} 个后台运行",
    "en-US": "Terminal · {count} running in background",
  },
  "proc.card.viewAll": {
    "zh-CN": "查看全部 {count} 个",
    "en-US": "View all {count}",
  },

  /** 右侧栏「后台进程」详情页签。 */
  "proc.panel.listTitle": {
    "zh-CN": "{count} 个进程",
    "en-US": "{count} processes",
  },
  "proc.panel.empty": {
    "zh-CN": "当前会话没有后台进程",
    "en-US": "No background processes in this session",
  },
  "proc.panel.emptyHint": {
    "zh-CN": "agent 用 bash 在后台启动的服务会出现在这里",
    "en-US": "Services started in the background by agent bash calls appear here",
  },
  "proc.panel.openLabel": {
    "zh-CN": "查看进程详情：{name}",
    "en-US": "View process details: {name}",
  },
  "proc.panel.overview": { "zh-CN": "概览", "en-US": "Overview" },
  "proc.panel.command": { "zh-CN": "命令行", "en-US": "Command" },
  "proc.panel.pid": { "zh-CN": "PID", "en-US": "PID" },
  "proc.panel.ppid": { "zh-CN": "PPID", "en-US": "PPID" },
  "proc.panel.image": { "zh-CN": "进程", "en-US": "Image" },
  "proc.panel.startedAt": { "zh-CN": "启动时间", "en-US": "Started" },
  "proc.panel.elapsed": { "zh-CN": "运行时长", "en-US": "Uptime" },
  "proc.panel.statusLabel": { "zh-CN": "状态", "en-US": "Status" },
  "proc.panel.refresh": { "zh-CN": "刷新", "en-US": "Refresh" },
  "proc.panel.source": { "zh-CN": "来源 bash 调用", "en-US": "Source bash call" },
  "proc.panel.source.missing": {
    "zh-CN": "未找到来源调用（可能来自历史会话）",
    "en-US": "Source call not found (possibly from an earlier session)",
  },
  "proc.panel.source.empty": {
    "zh-CN": "这次调用没有捕获到输出",
    "en-US": "No output was captured for this call",
  },
  "proc.panel.source.note": {
    "zh-CN": "这里只是启动阶段捕获的输出；进程后续 stdout 无法读取。",
    "en-US": "Only output captured during startup; later stdout can't be read.",
  },
  "proc.panel.source.capped": {
    "zh-CN": "输出过长，仅显示前 {chars} 个字符；完整内容见会话流。",
    "en-US":
      "Output is long; showing the first {chars} characters. See the conversation for the full text.",
  },
  "proc.panel.exitCode": { "zh-CN": "退出码 {code}", "en-US": "Exit {code}" },
  "proc.panel.timeout": {
    "zh-CN": "超时上限 {seconds}s",
    "en-US": "Timeout {seconds}s",
  },
  "proc.panel.exitRunning": { "zh-CN": "运行中", "en-US": "Running" },
  "proc.panel.runtime": { "zh-CN": "系统信息", "en-US": "System" },
  "proc.panel.runtime.reading": { "zh-CN": "读取中…", "en-US": "Reading…" },
  "proc.panel.runtime.failed": {
    "zh-CN": "读取失败：{message}",
    "en-US": "Couldn't read: {message}",
  },
  "proc.panel.runtime.retry": { "zh-CN": "重试", "en-US": "Retry" },
  "proc.panel.runtime.processCount": {
    "zh-CN": "{count} 个进程",
    "en-US": "{count} processes",
  },
  "proc.panel.runtime.memory": { "zh-CN": "内存 {size}", "en-US": "Memory {size}" },
  "proc.panel.runtime.ports": { "zh-CN": "TCP 端点", "en-US": "TCP endpoints" },
  "proc.panel.runtime.noPorts": {
    "zh-CN": "没有 TCP 端点",
    "en-US": "No TCP endpoints",
  },
  "proc.panel.runtime.portsFailed": {
    "zh-CN": "端口信息读取失败",
    "en-US": "Couldn't read ports",
  },
  "proc.panel.runtime.children": {
    "zh-CN": "子进程",
    "en-US": "Child processes",
  },
  "proc.panel.runtime.noChildren": {
    "zh-CN": "没有子进程",
    "en-US": "No child processes",
  },
  "proc.panel.runtime.exited": {
    "zh-CN": "进程已退出，端口与子进程不再更新",
    "en-US": "Process exited; ports and children are no longer updated",
  },
  "proc.panel.status.alive": { "zh-CN": "运行中", "en-US": "Running" },
  "proc.panel.status.exited": { "zh-CN": "已退出", "en-US": "Exited" },
  "proc.panel.status.killed": { "zh-CN": "已停止", "en-US": "Stopped" },
  "proc.panel.status.ignored": { "zh-CN": "已忽略", "en-US": "Ignored" },
  "proc.panel.exitedBanner": {
    "zh-CN": "该进程已退出",
    "en-US": "This process has exited",
  },
});
