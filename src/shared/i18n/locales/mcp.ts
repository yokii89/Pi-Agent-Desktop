import { defineMessages } from "../types";

/** MCP 管理面板（docs/design/39）。 */
export const mcpMessages = defineMessages({
  "mcp.page.title": { "zh-CN": "MCP 服务器", "en-US": "MCP servers" },
  "mcp.page.subtitle": {
    "zh-CN":
      "管理 pi 内置 MCP 支持的服务器连接（~/.pi/agent/mcp.json）。修改后需重载活跃会话生效。",
    "en-US":
      "Manage servers connected by pi's built-in MCP support (~/.pi/agent/mcp.json). Reload live sessions after changes.",
  },
  "mcp.page.add": { "zh-CN": "添加服务器", "en-US": "Add server" },
  "mcp.page.browseMarket": { "zh-CN": "浏览市场", "en-US": "Browse marketplace" },

  "mcp.market.title": { "zh-CN": "MCP 市场", "en-US": "MCP marketplace" },
  "mcp.market.subtitle": {
    "zh-CN": "从精选清单或官方注册表发现 MCP 服务器，「添加」会预填配置表单，确认后写入 mcp.json。",
    "en-US":
      'Discover MCP servers from the featured list or the official registry. "Add" prefills the config form; it writes to mcp.json after you confirm.',
  },
  "mcp.market.searchPlaceholder": {
    "zh-CN": "搜索 MCP 服务器（如 filesystem、sentry…）",
    "en-US": "Search MCP servers (e.g. filesystem, sentry…)",
  },
  "mcp.market.featured": { "zh-CN": "精选", "en-US": "Featured" },
  "mcp.market.searchResults": { "zh-CN": "搜索结果", "en-US": "Search results" },
  "mcp.market.searching": { "zh-CN": "正在搜索…", "en-US": "Searching…" },
  "mcp.market.error": {
    "zh-CN": "搜索失败：{error}。可稍后重试，或直接从精选中添加。",
    "en-US": "Search failed: {error}. Retry later, or add from the featured list.",
  },
  "mcp.market.empty": { "zh-CN": "没有匹配的服务器", "en-US": "No matching servers" },
  "mcp.market.loadMore": { "zh-CN": "加载更多", "en-US": "Load more" },
  "mcp.market.loadingMore": { "zh-CN": "加载中…", "en-US": "Loading…" },
  "mcp.market.add": { "zh-CN": "添加", "en-US": "Add" },
  "mcp.market.added": { "zh-CN": "已添加", "en-US": "Added" },
  "mcp.market.detail": { "zh-CN": "详情", "en-US": "Details" },
  "mcp.market.kindStdio": { "zh-CN": "本地命令", "en-US": "Local command" },
  "mcp.market.kindHttp": { "zh-CN": "远程 HTTP", "en-US": "Remote HTTP" },
  "mcp.market.needsUv": { "zh-CN": "需要 uv", "en-US": "Requires uv" },
  "mcp.market.envVars": { "zh-CN": "环境变量", "en-US": "Environment variables" },
  "mcp.market.headers": { "zh-CN": "请求头", "en-US": "Headers" },
  "mcp.market.required": { "zh-CN": "必填", "en-US": "required" },
  "mcp.market.secret": { "zh-CN": "密钥", "en-US": "secret" },
  "mcp.page.refreshStatus": { "zh-CN": "刷新状态", "en-US": "Refresh status" },
  "mcp.page.probing": {
    "zh-CN": "正在连接所有服务器…（已等待 {seconds} 秒）",
    "en-US": "Connecting to all servers… ({seconds}s elapsed)",
  },
  "mcp.page.probedJustNow": { "zh-CN": "刚刚探测", "en-US": "Probed just now" },
  "mcp.page.probedMinutesAgo": {
    "zh-CN": "{count} 分钟前探测",
    "en-US": "Probed {count} min ago",
  },
  "mcp.page.probedHoursAgo": { "zh-CN": "{count} 小时前探测", "en-US": "Probed {count} h ago" },
  "mcp.page.probedDaysAgo": { "zh-CN": "{count} 天前探测", "en-US": "Probed {count} d ago" },
  "mcp.page.probeCwd": { "zh-CN": "探测目录：{dir}", "en-US": "Probe directory: {dir}" },
  "mcp.page.empty.title": {
    "zh-CN": "还没有配置 MCP 服务器",
    "en-US": "No MCP servers configured",
  },
  "mcp.page.empty.description": {
    "zh-CN":
      "添加 stdio 或 streamable HTTP 服务器后，其工具即可在会话中使用。配置保存在 pi 的用户级 mcp.json，与 pi CLI 共享。",
    "en-US":
      "Add a stdio or streamable HTTP server and its tools become available in sessions. The config lives in pi's user-level mcp.json, shared with the pi CLI.",
  },
  "mcp.page.probeNote": { "zh-CN": "提示：{note}", "en-US": "Note: {note}" },
  "mcp.page.probeError": { "zh-CN": "探测失败：{error}", "en-US": "Probe failed: {error}" },
  "mcp.page.configErrors": {
    "zh-CN": "pi 报告了 {count} 条配置问题：",
    "en-US": "pi reported {count} configuration issues:",
  },
  "mcp.page.reloadBanner.title": { "zh-CN": "配置已变更", "en-US": "Configuration changed" },
  "mcp.page.reloadBanner.description": {
    "zh-CN": "活跃会话需重载后才会应用新配置；对话历史会保留。",
    "en-US":
      "Live sessions must reload to pick up the new configuration; conversation history is preserved.",
  },
  "mcp.page.reloadBanner.applyAll": { "zh-CN": "重载全部会话", "en-US": "Reload all sessions" },
  "mcp.page.reloadBanner.applying": { "zh-CN": "重载中…", "en-US": "Reloading…" },
  "mcp.page.reloadBanner.dismiss": { "zh-CN": "忽略", "en-US": "Dismiss" },
  "mcp.page.noLiveSessions": {
    "zh-CN": "当前没有活跃会话；新配置将在下次启动会话时生效。",
    "en-US": "No live sessions; the new configuration applies when the next session starts.",
  },
  "mcp.degrade.title": {
    "zh-CN": "当前 pi（{version}）不支持 MCP",
    "en-US": "pi {version} does not support MCP",
  },
  "mcp.degrade.description": {
    "zh-CN":
      "MCP 服务器管理依赖 pi ≥ 0.99 的内置 MCP 扩展；升级 pi（例如运行 pi update self）后重开此页即可使用。",
    "en-US":
      "MCP server management requires the MCP extension built into pi ≥ 0.99. Upgrade pi (e.g. run `pi update self`) and reopen this page.",
  },

  "mcp.card.tools": { "zh-CN": "{count} 个工具", "en-US": "{count} tools" },
  "mcp.card.enabled": { "zh-CN": "启用", "en-US": "Enabled" },
  "mcp.card.resources": { "zh-CN": "{count} 个资源", "en-US": "{count} resources" },
  "mcp.card.toolChips.showAll": {
    "zh-CN": "展开全部 {count} 个",
    "en-US": "Show all {count}",
  },
  "mcp.card.toolChips.collapse": { "zh-CN": "收起", "en-US": "Collapse" },
  "mcp.card.noTools": { "zh-CN": "未提供工具", "en-US": "No tools provided" },
  "mcp.card.scope.project": { "zh-CN": "项目级", "en-US": "Project" },
  "mcp.card.overridden": {
    "zh-CN": "被项目级 .pi/mcp.json 覆盖",
    "en-US": "Overridden by project .pi/mcp.json",
  },
  "mcp.card.toolExposureHint": {
    "zh-CN": "包含 {count} 条单工具覆盖（PiDesk 暂不支持编辑）",
    "en-US": "{count} per-tool overrides (editing not yet supported)",
  },
  "mcp.card.exposureLabel": { "zh-CN": "暴露", "en-US": "Exposure" },
  "mcp.card.menu.edit": { "zh-CN": "编辑", "en-US": "Edit" },
  "mcp.card.menu.remove": { "zh-CN": "删除", "en-US": "Delete" },
  "mcp.card.menu.login": { "zh-CN": "登录…", "en-US": "Sign in…" },
  "mcp.card.menu.logout": { "zh-CN": "登出", "en-US": "Sign out" },
  "mcp.card.menu.reconnect": { "zh-CN": "重连", "en-US": "Reconnect" },
  "mcp.card.menu.copyLoginCommand": { "zh-CN": "复制登录命令", "en-US": "Copy login command" },
  "mcp.card.menu.needsLiveSession": { "zh-CN": "需要活跃会话", "en-US": "Requires a live session" },
  "mcp.card.menu.needsHttpServer": {
    "zh-CN": "仅 streamable HTTP 服务器",
    "en-US": "Streamable HTTP servers only",
  },
  "mcp.card.menu.authConfigured": {
    "zh-CN": "已配置 Authorization 请求头",
    "en-US": "Authorization header already configured",
  },
  "mcp.card.invalidEntry": {
    "zh-CN":
      "该条目不是有效的配置对象（mcp.json 被手动改坏？）。可删除后重新添加，或手动编辑文件修复。",
    "en-US":
      "This entry is not a valid config object (mcp.json edited by hand?). Delete and re-add it, or fix the file manually.",
  },

  "mcp.state.connected": { "zh-CN": "已连接", "en-US": "Connected" },
  "mcp.state.connecting": { "zh-CN": "连接中", "en-US": "Connecting" },
  "mcp.state.disconnected": { "zh-CN": "已断开", "en-US": "Disconnected" },
  "mcp.state.needs-auth": { "zh-CN": "需要登录", "en-US": "Sign-in required" },
  "mcp.state.failed": { "zh-CN": "连接失败", "en-US": "Failed" },
  "mcp.state.closed": { "zh-CN": "已关闭", "en-US": "Closed" },
  "mcp.state.disabled": { "zh-CN": "已停用", "en-US": "Disabled" },
  "mcp.state.notProbed": { "zh-CN": "未探测", "en-US": "Not probed" },
  "mcp.state.unknown": { "zh-CN": "未知", "en-US": "Unknown" },

  "mcp.exposure.codemode": { "zh-CN": "codemode", "en-US": "codemode" },
  "mcp.exposure.codemode.hint": {
    "zh-CN": "工具经 codemode 脚本调用，不直接声明给模型（默认）",
    "en-US": "Tools callable from codemode scripts, not declared to the model (default)",
  },
  "mcp.exposure.deferred": { "zh-CN": "deferred", "en-US": "deferred" },
  "mcp.exposure.deferred.hint": {
    "zh-CN": "经 tool_search 搜索加载后，模型可直接调用",
    "en-US": "Loaded via tool_search, then called directly by the model",
  },
  "mcp.exposure.direct": { "zh-CN": "direct", "en-US": "direct" },
  "mcp.exposure.direct.hint": {
    "zh-CN": "像内置工具一样直接声明给模型",
    "en-US": "Declared to the model like a built-in tool",
  },
  "mcp.exposure.hidden": { "zh-CN": "hidden", "en-US": "hidden" },
  "mcp.exposure.hidden.hint": {
    "zh-CN": "注册但不可用（配合单工具覆盖可只放开部分工具）",
    "en-US": "Registered but unreachable (combine with per-tool overrides to expose a few)",
  },

  "mcp.edit.advancedSection": { "zh-CN": "高级选项", "en-US": "Advanced" },
  "mcp.edit.switchTransport.title": { "zh-CN": "切换传输方式？", "en-US": "Switch transport?" },
  "mcp.edit.switchTransport.message": {
    "zh-CN": "保存时只保留当前传输方式的字段，已填写的 {fields} 将被清除。确定切换吗？",
    "en-US":
      "Saving keeps only the current transport's fields; {fields} will be dropped. Switch anyway?",
  },
  "mcp.edit.switchTransport.confirm": { "zh-CN": "仍要切换", "en-US": "Switch anyway" },
  "mcp.edit.addTitle": { "zh-CN": "添加 MCP 服务器", "en-US": "Add MCP server" },
  "mcp.edit.editTitle": { "zh-CN": "编辑 MCP 服务器", "en-US": "Edit MCP server" },
  "mcp.edit.name": { "zh-CN": "名称", "en-US": "Name" },
  "mcp.edit.namePlaceholder": {
    "zh-CN": "如 filesystem、sentry",
    "en-US": "e.g. filesystem, sentry",
  },
  "mcp.edit.nameInvalid": {
    "zh-CN": "只能用字母、数字、_ 和 -，且与现有服务器不重名（- 与 _ 视为同名）",
    "en-US":
      "Letters, digits, _ and - only; must not collide with an existing server (- and _ are equivalent)",
  },
  "mcp.edit.transport": { "zh-CN": "传输方式", "en-US": "Transport" },
  "mcp.edit.transport.stdio": { "zh-CN": "stdio（本地命令）", "en-US": "stdio (local command)" },
  "mcp.edit.transport.http": {
    "zh-CN": "streamable HTTP（远程）",
    "en-US": "streamable HTTP (remote)",
  },
  "mcp.edit.command": { "zh-CN": "命令", "en-US": "Command" },
  "mcp.edit.commandPlaceholder": { "zh-CN": "如 npx", "en-US": "e.g. npx" },
  "mcp.edit.args": { "zh-CN": "参数", "en-US": "Arguments" },
  "mcp.edit.argsHint": { "zh-CN": "一行一个参数", "en-US": "One argument per line" },
  "mcp.edit.env": { "zh-CN": "环境变量", "en-US": "Environment variables" },
  "mcp.edit.envHint": {
    "zh-CN": "一行一个，格式 KEY=VALUE；支持 $VAR 引用",
    "en-US": "One per line as KEY=VALUE; $VAR references supported",
  },
  "mcp.edit.cwd": { "zh-CN": "工作目录", "en-US": "Working directory" },
  "mcp.edit.cwdPlaceholder": {
    "zh-CN": "可选；相对路径基于会话目录解析",
    "en-US": "Optional; relative paths resolve against the session directory",
  },
  "mcp.edit.url": { "zh-CN": "服务器地址", "en-US": "Server URL" },
  "mcp.edit.urlPlaceholder": {
    "zh-CN": "https://example.com/mcp",
    "en-US": "https://example.com/mcp",
  },
  "mcp.edit.headers": { "zh-CN": "请求头", "en-US": "Headers" },
  "mcp.edit.headersHint": {
    "zh-CN": "一行一个，格式 KEY: VALUE 或 KEY=VALUE；支持 $VAR 引用",
    "en-US": "One per line as KEY: VALUE or KEY=VALUE; $VAR references supported",
  },
  "mcp.edit.oauthSection": { "zh-CN": "OAuth（可选）", "en-US": "OAuth (optional)" },
  "mcp.edit.oauth.clientId": { "zh-CN": "Client ID", "en-US": "Client ID" },
  "mcp.edit.oauth.clientSecret": { "zh-CN": "Client Secret", "en-US": "Client Secret" },
  "mcp.edit.oauth.callbackPort": { "zh-CN": "回调端口", "en-US": "Callback port" },
  "mcp.edit.oauth.scope": { "zh-CN": "Scope", "en-US": "Scope" },
  "mcp.edit.oauth.scopePlaceholder": { "zh-CN": "空格分隔", "en-US": "Space-separated" },
  "mcp.edit.oauth.clientName": { "zh-CN": "Client Name", "en-US": "Client name" },
  "mcp.edit.description": { "zh-CN": "描述", "en-US": "Description" },
  "mcp.edit.descriptionPlaceholder": {
    "zh-CN": "一句话说明该服务器提供什么，会写入系统提示",
    "en-US": "One sentence on what the server offers; goes into the system prompt",
  },
  "mcp.edit.exposure": { "zh-CN": "工具暴露", "en-US": "Tool exposure" },
  "mcp.edit.timeout": { "zh-CN": "超时（秒）", "en-US": "Timeout (seconds)" },
  "mcp.edit.enabled": { "zh-CN": "启用该服务器", "en-US": "Enable this server" },
  "mcp.edit.enabledHint": {
    "zh-CN": "停用后保留配置但不建立连接",
    "en-US": "Keep the entry without connecting",
  },
  "mcp.toast.saved": { "zh-CN": "MCP 配置已保存", "en-US": "MCP configuration saved" },
  "mcp.toast.reloadAction": { "zh-CN": "重载会话", "en-US": "Reload sessions" },
  "mcp.toast.removed": { "zh-CN": "已删除 {name}", "en-US": "Removed {name}" },
  "mcp.toast.loginRequested": {
    "zh-CN": "已发起登录：完成浏览器授权后，pi 会自动连接该服务器",
    "en-US": "Sign-in started: pi connects the server automatically after browser authorization",
  },
  "mcp.toast.logoutRequested": { "zh-CN": "已登出", "en-US": "Signed out" },
  "mcp.toast.reconnectRequested": { "zh-CN": "已请求重连", "en-US": "Reconnect requested" },
  "mcp.toast.reloaded": { "zh-CN": "已重载 {count} 个会话", "en-US": "Reloaded {count} sessions" },
  "mcp.toast.reloadFailed": {
    "zh-CN": "{count} 个会话重载失败：{error}",
    "en-US": "{count} sessions failed to reload: {error}",
  },
  "mcp.remove.confirm.title": { "zh-CN": "删除 MCP 服务器？", "en-US": "Delete MCP server?" },
  "mcp.remove.confirm.message": {
    "zh-CN":
      "将从 ~/.pi/agent/mcp.json 移除 {name}；活跃会话需重载后才断开。此操作不会删除 OAuth 凭证。",
    "en-US":
      "{name} will be removed from ~/.pi/agent/mcp.json; live sessions keep it until reloaded. Stored OAuth credentials are not deleted.",
  },
});
