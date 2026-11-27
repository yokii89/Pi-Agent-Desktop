import { defineMessages } from "../types";

export const agentWorkspaceMessages = defineMessages({
  "agentWorkspace.title": { "zh-CN": "Agent 工作区", "en-US": "Agent workspace" },
  "agentWorkspace.description": {
    "zh-CN": "沿着协作关系，查看每个 Agent 的执行过程。",
    "en-US": "Follow each agent from delegation to results.",
  },
  "agentWorkspace.graph": { "zh-CN": "协作关系", "en-US": "Agent graph" },
  "agentWorkspace.detail": { "zh-CN": "任务详情", "en-US": "Task details" },
  "agentWorkspace.stream": { "zh-CN": "会话信息流", "en-US": "Conversation stream" },
  "agentWorkspace.expand": { "zh-CN": "展开工作区", "en-US": "Expand workspace" },
  "agentWorkspace.collapse": { "zh-CN": "收回面板", "en-US": "Return to panel" },
  "agentWorkspace.hint": {
    "zh-CN": "点击节点查看信息流",
    "en-US": "Select an agent to view its stream",
  },
  "agentWorkspace.gestures": {
    "zh-CN": "拖动平移 · 滚轮缩放 · 方向键浏览节点",
    "en-US": "Drag to pan · Scroll to zoom · Arrow keys to navigate",
  },
  "agentWorkspace.zoomIn": { "zh-CN": "放大画布", "en-US": "Zoom in" },
  "agentWorkspace.zoomOut": { "zh-CN": "缩小画布", "en-US": "Zoom out" },
  "agentWorkspace.fit": { "zh-CN": "适应画布", "en-US": "Fit graph" },
  "agentWorkspace.ancestry": { "zh-CN": "当前 Agent 路径", "en-US": "Agent ancestry" },
  "agentWorkspace.empty": {
    "zh-CN": "当前会话暂无子 Agent",
    "en-US": "No child agents in this session",
  },
  "agentWorkspace.noSelection": {
    "zh-CN": "选择一个节点以查看任务详情。",
    "en-US": "Select an agent to view its details.",
  },
  "agentWorkspace.loading": {
    "zh-CN": "正在读取此 Agent 的会话…",
    "en-US": "Loading this agent’s conversation…",
  },
  "agentWorkspace.noMessages": {
    "zh-CN": "此 Agent 尚未产生会话记录。",
    "en-US": "This agent has no conversation entries yet.",
  },
  "agentWorkspace.earlier": { "zh-CN": "加载更早记录", "en-US": "Load earlier entries" },
  "agentWorkspace.follow": { "zh-CN": "跟随最新", "en-US": "Follow latest" },
  "agentWorkspace.latest": { "zh-CN": "回到最新", "en-US": "Jump to latest" },
  "agentWorkspace.retained": {
    "zh-CN": "仅展示当前 Agent 的会话",
    "en-US": "Conversation for the selected agent",
  },
  "agentWorkspace.user": { "zh-CN": "任务输入", "en-US": "Task input" },
  "agentWorkspace.assistant": { "zh-CN": "Agent 输出", "en-US": "Agent output" },
  "agentWorkspace.thinking": { "zh-CN": "思考过程", "en-US": "Thinking" },
  "agentWorkspace.tool": { "zh-CN": "工具调用", "en-US": "Tool call" },
  "agentWorkspace.notice": { "zh-CN": "执行记录", "en-US": "Execution event" },
  "agentWorkspace.error": { "zh-CN": "执行异常", "en-US": "Execution error" },
  "agentWorkspace.input": { "zh-CN": "输入参数", "en-US": "Arguments" },
  "agentWorkspace.output": { "zh-CN": "执行输出", "en-US": "Output" },
  "agentWorkspace.running": { "zh-CN": "运行中", "en-US": "Running" },
  "agentWorkspace.completed": { "zh-CN": "已完成", "en-US": "Completed" },
  "agentWorkspace.queued": { "zh-CN": "排队中", "en-US": "Queued" },
  "agentWorkspace.stopped": { "zh-CN": "已停止", "en-US": "Stopped" },
  "agentWorkspace.idle": { "zh-CN": "空闲", "en-US": "Idle" },
  "agentWorkspace.failed": { "zh-CN": "执行失败", "en-US": "Failed" },
});
