import { defineMessages } from "../types";

export const notificationMessages = defineMessages({
  "notification.scenario.completed": { "zh-CN": "任务完成", "en-US": "Task completed" },
  "notification.scenario.failed": { "zh-CN": "出错", "en-US": "Failed" },
  "notification.scenario.needsAttention": { "zh-CN": "需要介入", "en-US": "Needs attention" },
  "notification.scenario.interrupted": { "zh-CN": "已中断", "en-US": "Interrupted" },
  "notification.scenario.terminalExit": { "zh-CN": "终端退出", "en-US": "Terminal exited" },
  "notification.scenario.custom": { "zh-CN": "扩展提示", "en-US": "Extension alert" },

  "notification.scenarioHint.completed": {
    "zh-CN": "LLM 本轮输出正常结束，可阅读结果或继续对话",
    "en-US": "The model finished this turn; read the result or continue chatting",
  },
  "notification.scenarioHint.failed": {
    "zh-CN": "模型调用、工具执行或自动重试最终失败",
    "en-US": "Model call, tool run, or auto-retry ultimately failed",
  },
  "notification.scenarioHint.needsAttention": {
    "zh-CN": "扩展要求确认，或运行中的会话异常退出",
    "en-US": "An extension needs confirmation, or a running session exited unexpectedly",
  },
  "notification.scenarioHint.interrupted": {
    "zh-CN": "你主动停止了本轮任务",
    "en-US": "You stopped this turn yourself",
  },
  "notification.scenarioHint.terminalExit": {
    "zh-CN": "底部终端面板中的进程结束",
    "en-US": "A process in the bottom terminal panel exited",
  },
  "notification.scenarioHint.custom": {
    "zh-CN": "扩展通过 SDK 请求的提示（业务语义由扩展决定）",
    "en-US": "Requested via the extension SDK (meaning is defined by the extension)",
  },

  "notification.focusPolicy.always": { "zh-CN": "始终播放", "en-US": "Always play" },
  "notification.focusPolicy.muteActiveFocused": {
    "zh-CN": "后台会话仍提示",
    "en-US": "Still alert for background sessions",
  },
  "notification.focusPolicy.muteWhenFocused": {
    "zh-CN": "聚焦时静音",
    "en-US": "Mute when focused",
  },
  "notification.focusPolicyHint.muteActiveFocused": {
    "zh-CN": "窗口聚焦且你正在看触发源会话时静音；并行后台任务完成仍会响（推荐）",
    "en-US":
      "Silent when focused on the source session; background completions still alert (recommended)",
  },
  "notification.focusPolicyHint.muteWhenFocused": {
    "zh-CN": "只要窗口有焦点就不播轻提示；关键场景可仍会响",
    "en-US": "Silent while the window is focused; critical alerts may still play",
  },
  "notification.focusPolicyHint.always": {
    "zh-CN": "场景开启即播放，不受焦点影响",
    "en-US": "Play whenever the scenario is on, regardless of focus",
  },

  "notification.panel.hint": {
    "zh-CN":
      "任务完成、出错或需要你介入时播放提示音；窗口不在前台时还会在屏幕右下角弹出系统通知，点击可回到对应会话。",
    "en-US":
      "Play a sound when a task finishes, fails, or needs you; while the window is in the background, also pop a system toast you can click to jump back.",
  },
  "notification.panel.group.toast": { "zh-CN": "桌面通知", "en-US": "System toast" },
  "notification.panel.systemToast": {
    "zh-CN": "窗口未聚焦时弹出系统通知",
    "en-US": "Show system toast while unfocused",
  },
  "notification.panel.systemToast.description": {
    "zh-CN": "任务收口时在屏幕右下角弹出；点击可回到对应会话",
    "en-US": "Pops up in the corner when a task finishes; click to jump back to that session",
  },
  "notification.toast.title": { "zh-CN": "PiDesk · {session}", "en-US": "PiDesk · {session}" },
  "notification.toast.titleFallback": { "zh-CN": "PiDesk", "en-US": "PiDesk" },
  "notification.panel.group.sound": { "zh-CN": "提示音", "en-US": "Sound" },
  "notification.panel.enable": {
    "zh-CN": "启用系统提示音",
    "en-US": "Enable notification sounds",
  },
  "notification.panel.enable.description": {
    "zh-CN": "总开关；关闭后所有场景与扩展触发均不播声音（桌面通知不受影响）",
    "en-US":
      "Master switch for sounds; off silences scenarios and extension triggers (system toast unaffected)",
  },
  "notification.panel.volume": { "zh-CN": "音量", "en-US": "Volume" },
  "notification.panel.volume.description": {
    "zh-CN": "播放增益（0–100%）",
    "en-US": "Playback gain (0–100%)",
  },
  "notification.panel.focusPolicy": { "zh-CN": "焦点策略", "en-US": "Focus policy" },
  "notification.panel.critical": {
    "zh-CN": "关键场景忽略焦点静音",
    "en-US": "Critical scenarios ignore focus mute",
  },
  "notification.panel.critical.description": {
    "zh-CN": "失败、需要介入与扩展提示不受焦点策略限制",
    "en-US": "Failed, needs attention, and extension alerts bypass focus muting",
  },
  "notification.panel.group.scenarios": { "zh-CN": "场景", "en-US": "Scenarios" },
  "notification.panel.scenarioEnable": { "zh-CN": "{name} 通知", "en-US": "{name} alerts" },
  "notification.panel.scenarioSound": { "zh-CN": "{name} 音色", "en-US": "{name} tone" },
  "notification.panel.scenarioNote": {
    "zh-CN": "同时控制该场景的提示音与桌面通知",
    "en-US": "Toggles both the sound and the system toast for this scenario",
  },
  "notification.panel.soundLabel": { "zh-CN": "音效 {id}", "en-US": "Sound {id}" },
  "notification.panel.preview": { "zh-CN": "试听", "en-US": "Preview" },
  "notification.panel.sdkNote": {
    "zh-CN": "仅可使用项目内置的 5 个提示音；扩展 SDK 不能指定任意音频路径",
    "en-US":
      "Only the 5 built-in sounds are available; the extension SDK cannot pick arbitrary audio paths",
  },
  "notification.panel.group.debounce": { "zh-CN": "节流", "en-US": "Debounce" },
  "notification.panel.debounce": { "zh-CN": "防抖间隔", "en-US": "Debounce interval" },
  "notification.panel.debounce.description": {
    "zh-CN": "同一目标在此间隔内的连续触发只展示一次（毫秒，声音与桌面通知共用）",
    "en-US":
      "Repeated triggers for the same target within this window show once (ms; shared by sound and toast)",
  },
  "notification.panel.reset": { "zh-CN": "恢复默认", "en-US": "Restore defaults" },
});
