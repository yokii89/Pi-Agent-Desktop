import { defineMessages } from "../types";

export const windowMessages = defineMessages({
  "window.close.title": { "zh-CN": "要关闭 PiDesk 吗？", "en-US": "Close PiDesk?" },
  "window.close.lead": { "zh-CN": "还有 {detail} 在运行。", "en-US": "Still running: {detail}." },
  "window.close.separator": { "zh-CN": "、", "en-US": ", " },
  "window.close.lead.session": { "zh-CN": "{count} 个会话", "en-US": "{count} session" },
  "window.close.lead.sessions": { "zh-CN": "{count} 个会话", "en-US": "{count} sessions" },
  "window.close.lead.terminal": { "zh-CN": "{count} 个终端", "en-US": "{count} terminal" },
  "window.close.lead.terminals": { "zh-CN": "{count} 个终端", "en-US": "{count} terminals" },
  "window.close.lead.proc": {
    "zh-CN": "{count} 个后台进程",
    "en-US": "{count} background process",
  },
  "window.close.lead.procs": {
    "zh-CN": "{count} 个后台进程",
    "en-US": "{count} background processes",
  },
  "window.close.hide": { "zh-CN": "隐藏到托盘", "en-US": "Hide to tray" },
  "window.close.hide.hint": {
    "zh-CN": "进程全部继续运行，随时从托盘图标回到 PiDesk",
    "en-US": "All processes keep running — return any time from the tray icon",
  },
  "window.close.hide.hintIdle": {
    "zh-CN": "在托盘保留 PiDesk，点图标即可回来",
    "en-US": "Keep PiDesk in the tray — click the icon to return",
  },
  "window.close.hide.blocked": {
    "zh-CN": "系统托盘不可用，无法隐藏",
    "en-US": "System tray is unavailable",
  },
  "window.close.quit": { "zh-CN": "退出 PiDesk", "en-US": "Quit PiDesk" },
  "window.close.quit.hint": {
    "zh-CN": "结束这些进程；会话记录与设置都已落盘，下次打开还在",
    "en-US": "End these processes; saved sessions and settings stay available next time",
  },
  "window.close.quit.hintIdle": {
    "zh-CN": "关闭窗口并结束应用",
    "en-US": "Close the window and end the app",
  },
  "window.close.remember": { "zh-CN": "记住我的选择，下次直接这样", "en-US": "Remember my choice" },
  "window.close.cancel": { "zh-CN": "取消", "en-US": "Cancel" },
});
