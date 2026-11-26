import { defineMessages } from "../types";

export const newApiMessages = defineMessages({
  "settings.newapi.import": { "zh-CN": "从 Codex 导入", "en-US": "Import from Codex" },
  "settings.newapi.refresh": { "zh-CN": "刷新模型", "en-US": "Refresh models" },
  "settings.newapi.test": { "zh-CN": "测试连接", "en-US": "Test connection" },
  "settings.newapi.clear": { "zh-CN": "清除缓存", "en-US": "Clear cache" },
  "settings.newapi.preferred": { "zh-CN": "首选", "en-US": "Preferred" },
  "settings.newapi.loading": { "zh-CN": "正在读取模型…", "en-US": "Loading models…" },
  "settings.newapi.count": { "zh-CN": "可用模型：{count}", "en-US": "Available models: {count}" },
  "settings.newapi.cachedAt": { "zh-CN": "缓存于 {time}", "en-US": "Cached at {time}" },
  "settings.newapi.stale": { "zh-CN": "缓存待刷新", "en-US": "Cache needs refreshing" },
  "settings.newapi.fallback": {
    "zh-CN": "发现失败，保留已有模型与首选模型。",
    "en-US": "Discovery failed. Saved models and the preferred model are retained.",
  },
  "settings.newapi.filter": { "zh-CN": "筛选模型", "en-US": "Filter models" },
  "settings.newapi.discovered": { "zh-CN": "发现的模型", "en-US": "Discovered models" },
  "settings.newapi.choose": { "zh-CN": "选择首选模型", "en-US": "Choose a preferred model" },
  "settings.newapi.catalogHint": {
    "zh-CN": "选择后保存，作为新会话的首选模型。",
    "en-US": "Select and save a preferred model for new sessions.",
  },
  "settings.newapi.modelHint": {
    "zh-CN": "可填写列表中未公开的模型 ID；留空时自动发现并选择第一个模型。",
    "en-US":
      "You can enter an unlisted model ID. Leave blank to discover and select the first model.",
  },
  "settings.newapi.capabilities": { "zh-CN": "能力匹配", "en-US": "Capability matching" },
  "settings.newapi.capabilityHint": {
    "zh-CN": "自动模式按完整模型 ID 匹配内置目录。修改上下文或推理支持会切换到手动模式。",
    "en-US":
      "Automatic mode matches exact model IDs against the built-in catalog. Editing context or reasoning switches to manual mode.",
  },
  "settings.newapi.auto": { "zh-CN": "自动匹配", "en-US": "Automatic" },
  "settings.newapi.manual": { "zh-CN": "手动配置", "en-US": "Manual" },
  "settings.newapi.cleared": {
    "zh-CN": "模型缓存已清除，下次读取将重新发现。",
    "en-US": "Model cache cleared. The next catalog read will discover models again.",
  },
  "settings.newapi.tested": {
    "zh-CN": "连接成功：{count} 个模型，耗时 {latencyMs} ms",
    "en-US": "Connected: {count} models in {latencyMs} ms",
  },
  "settings.newapi.imported": {
    "zh-CN": "已导入 Codex 网关、首选模型和推理档位。",
    "en-US": "Imported the Codex gateway, preferred model and reasoning level.",
  },
});
