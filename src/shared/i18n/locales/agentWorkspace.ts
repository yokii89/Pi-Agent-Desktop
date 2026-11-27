import { defineMessages } from "../types";

export const agentWorkspaceMessages = defineMessages({
  "agentWorkspace.title": { "zh-CN": "Agent 工作区", "en-US": "Agent workspace" },
  "agentWorkspace.description": {
    "zh-CN": "沿着协作关系，查看每个 Agent 的执行过程。",
    "en-US": "Follow each agent from delegation to results.",
  },
  "agentWorkspace.graph": { "zh-CN": "协作关系", "en-US": "Agent graph" },
  "agentWorkspace.detail": { "zh-CN": "任务详情", "en-US": "Task details" },
  "agentWorkspace.resize": {
    "zh-CN": "调整协作关系与任务详情的比例",
    "en-US": "Resize agent graph and task details",
  },
  "agentWorkspace.resizeHint": {
    "zh-CN": "拖动调整比例，双击恢复默认；聚焦后可用方向键调整",
    "en-US": "Drag to resize, double-click to reset; use arrow keys when focused",
  },
  "agentWorkspace.splitValue": {
    "zh-CN": "协作关系 {graph}% · 任务详情 {detail}%",
    "en-US": "Agent graph {graph}% · Task details {detail}%",
  },
  "agentWorkspace.stream": { "zh-CN": "会话信息流", "en-US": "Conversation stream" },
  "agentWorkspace.expand": {
    "zh-CN": "在独立窗口中打开",
    "en-US": "Open in floating window",
  },
  "agentWorkspace.collapse": { "zh-CN": "返回侧栏", "en-US": "Dock to sidebar" },
  "agentWorkspace.floatingHint": {
    "zh-CN": "Agent 工作区已在独立窗口中打开。",
    "en-US": "Agent workspace is open in a floating window.",
  },
  "agentWorkspace.hint": {
    "zh-CN": "点击节点查看信息流",
    "en-US": "Select an agent to view its stream",
  },
  "agentWorkspace.gestures": {
    "zh-CN": "滚动浏览 · 拖动平移 · Ctrl + 滚轮缩放 · 方向键切换节点",
    "en-US": "Scroll to browse · Drag to pan · Ctrl + scroll to zoom · Arrow keys to navigate",
  },
  "agentWorkspace.zoomIn": { "zh-CN": "放大画布", "en-US": "Zoom in" },
  "agentWorkspace.zoomOut": { "zh-CN": "缩小画布", "en-US": "Zoom out" },
  "agentWorkspace.fit": { "zh-CN": "查看全图", "en-US": "Show entire graph" },
  "agentWorkspace.reset": {
    "zh-CN": "恢复 100% 并回到顶部",
    "en-US": "Reset to 100% and return to top",
  },
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
