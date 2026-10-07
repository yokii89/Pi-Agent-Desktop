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
});
