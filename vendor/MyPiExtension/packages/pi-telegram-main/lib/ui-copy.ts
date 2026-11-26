/**
 * Telegram operator UI copy (Simplified Chinese · Apple-inspired)
 * Zones: telegram ui
 * Owns durable Chinese labels, titles, toasts, and dialog copy for bridge-owned Telegram surfaces
 * Does not own callback prefixes, menu layout policy, domain behavior, or extension-authored copy
 *
 * Visual language (Telegram-safe Apple HIG adaptation):
 * - Navigation uses chevron back (‹), not heavy emoji chrome
 * - Selection uses checkmark (✓), not multicolored status dots
 * - Titles are short; settings rows read like iOS list cells: "标签  值"
 * - Copy is concise, calm, and operator-clear
 */

/** Shared selection / navigation marks */
export const UI_MARK = {
	selected: "✓ ",
	back: "‹ ",
} as const;

export function formatSelectedLabel(label: string, selected: boolean): string {
	return selected ? `${UI_MARK.selected}${label}` : label;
}

export const UI_NAV: { mainMenu: string; back: string } = {
	mainMenu: `${UI_MARK.back}主菜单`,
	back: `${UI_MARK.back}返回`,
};

export const UI_TOAST = {
	interactiveExpired: "此消息已失效。",
	queued: "已加入队列。",
	prioritized: "已设为优先。",
	normalPriority: "已设为普通。",
	deletedFromQueue: "已从队列移除。",
	itemNotFound: "未找到该项。",
	keptInQueue: "已保留在队列中。",
	thinkingDisabledVoice: "语音回复进行中，暂时无法调整思考级别。",
	thinkingUnavailable: "此模型不支持思考级别调整。",
	invalidThinkingLevel: "无效的思考级别。",
	unknownModelScope: "未知的模型范围。",
	scopedModels: "已切换为限定模型",
	allModels: "已切换为全部模型",
	scopedPersistenceUnavailable: "无法保存模型范围。",
	noAvailableModels: "没有可用模型。",
	settingsUnavailable: "设置暂不可用。",
	chooseInstanceRestore: "请选择要恢复的实例。",
	threadNotActive: "该话题尚未激活。",
	threadMenuExpired: "话题菜单已失效。",
	sectionUnavailable: "此功能已不可用。",
	followerRestoreUnavailable: "从属话题恢复暂不可用。",
	notAuthorized: "此 bot 未授权用于你的账户。",
};

export const UI_BUSY = {
	abortNextStop: "Pi 正忙。请先发送 /abort、/next 或 /stop。",
	abortOrStop: "Pi 正忙。请先发送 /abort 或 /stop。",
	cannotOpenStatus: "Pi 正忙时无法打开状态。请先发送 /abort、/next 或 /stop。",
	cannotSwitchModel: "Pi 正忙时无法切换模型。请先发送 /abort、/next 或 /stop。",
};

export const UI_STATUS = {
	cardTitle: "<b>会话</b>",
	rowStatus: "状态",
	rowUsage: "用量",
	rowCost: "费用",
	rowContext: "上下文",
	stateIdle: "空闲",
	stateActive: "运行中",
	statePending: "等待中",
	stateUnknown: "未知",
	contextUnknown: "未知",
	buttonModel: "模型",
	buttonThinking: "思考",
	buttonQueueEmpty: "队列",
	buttonQueueCount: (count: number) => `队列  ${count}`,
	buttonSettings: "设置",
	modelUnknown: "未知",
	costSubscriptionSuffix: "（订阅）",
};

export const UI_MODEL = {
	pageTitle: "<b>选择页码</b>",
	current: (id: string) => `模型  ${id}`,
	switchedTo: (id: string) => `已切换到 ${id}`,
	switchingContinue: (id: string) => `正在切换到 ${id} 并继续…`,
	switchingAfterTool: (id: string) => `已切换到 ${id}。当前工具结束后将重启…`,
	scopeCliControlled: "模型范围由 CLI --models 控制。",
	selectedUnavailable: "所选模型已不可用。",
	invalidSelection: "无效的模型选择。",
	invalidPage: "无效的页码。",
	noCliScopedModels: "没有与当前鉴权匹配的 CLI 限定模型，正在显示全部可用模型。",
	modelNotAvailable: "模型不可用。",
	addedToScoped: "已加入限定模型",
	removedFromScoped: "已移出限定模型",
	chooseTitle: "<b>模型</b>",
	detailTitle: "<b>模型</b>",
	scopeScopedOn: formatSelectedLabel("限定", true),
	scopeScopedOff: formatSelectedLabel("限定", false),
	scopeAllOn: formatSelectedLabel("全部", true),
	scopeAllOff: formatSelectedLabel("全部", false),
	active: formatSelectedLabel("当前", true),
	activate: "设为当前",
};

export const UI_THINKING = {
	chooseTitle: "<b>思考级别</b>",
};

export const UI_QUEUE = {
	title: "<b>队列</b>",
	empty: "<b>队列为空</b>",
	emptyRefreshTitles: ["<b>队列为空</b>", "<b>暂无排队任务</b>", "<b>这里还很安静</b>", "<b>没有待处理项</b>"],
	refresh: "刷新",
	priorityOn: formatSelectedLabel("优先", true),
	priorityOff: formatSelectedLabel("优先", false),
	normalOn: formatSelectedLabel("普通", true),
	normalOff: formatSelectedLabel("普通", false),
	delete: "删除",
	confirmDelete: "删除",
	confirmNo: "取消",
	deleteQuestion: "<b>删除此项？</b>",
	emptyCommand: "<b>队列为空</b>",
};

export const UI_SETTINGS = {
	menuTitle: "<b>设置</b>",
	proactiveTitle: "<b>主动推送</b>",
	draftTitle: "<b>草稿预览</b>",
	renderingTitle: "<b>回答渲染</b>",
	timeTitle: "<b>时间注入</b>",
	voiceTitle: "<b>语音回复</b>",
	on: "打开",
	off: "关闭",
	toggleOnActive: formatSelectedLabel("打开", true),
	toggleOnInactive: formatSelectedLabel("打开", false),
	toggleOffActive: formatSelectedLabel("关闭", true),
	toggleOffInactive: formatSelectedLabel("关闭", false),
	rowVoice: (value: string) => `语音回复  ${value}`,
	rowTime: (value: string) => `时间注入  ${value}`,
	rowDraft: (enabled: boolean) => `草稿预览  ${enabled ? "打开" : "关闭"}`,
	rowRendering: (mode: string) => `回答渲染  ${mode}`,
	rowProactive: (enabled: boolean) => `主动推送  ${enabled ? "打开" : "关闭"}`,
	modeHidden: "关闭",
	modeMirror: "镜像",
	modeAlways: "始终",
	modeInterval: "间隔",
	modeRich: "富文本",
	modeHtml: "HTML",
	toastVoice: (mode: string) => `语音回复：${mode}`,
	toastTime: (mode: string) => `时间注入：${mode}`,
	toastDraft: (enabled: boolean) => (enabled ? "草稿预览已打开" : "草稿预览已关闭"),
	toastRendering: (mode: string) => `回答渲染：${mode}`,
	toastProactive: (enabled: boolean) => (enabled ? "主动推送已打开" : "主动推送已关闭"),
	proactiveBody: [
		"控制本地或自主任务产生的助手输出，是否推送到 Telegram。",
		"",
		"<code>打开</code>（默认）",
		"已连接时，发送每个完成的公开内容块。",
		"",
		"<code>关闭</code>",
		"本地输出仅保留在 Pi；Telegram 发起的回复仍正常投递。",
	].join("\n"),
	draftBody: [
		"模型生成回答时，是否显示实时草稿。",
		"",
		"<code>关闭</code>（默认）",
		"仅显示活动状态，最终发送一条完整回答。",
		"",
		"<code>打开</code>",
		"在最终回答前流式推送安全的草稿帧。",
	].join("\n"),
	renderingBody: [
		"选择助手 Markdown 回答的投递方式。",
		"",
		"<code>富文本</code>（默认）",
		"使用 Telegram 原生 Rich Markdown。",
		"",
		"<code>HTML</code>",
		"使用 Markdown 转 HTML 的兼容渲染。",
	].join("\n"),
	voiceBody: [
		"控制助手文字回复何时转为 Telegram 语音消息。",
		"",
		"<code>关闭</code>（默认）",
		"不自动附加语音；显式 telegram_voice 仍可用。",
		"",
		"<code>镜像</code>",
		"语音输入时自动语音回复；文字输入按「关闭」处理。",
		"",
		"<code>始终</code>",
		"每条回复都自动以语音投递。",
	].join("\n"),
	timeBody: [
		"控制 Telegram 发起的提示是否注入简短墙钟 <code>[time]</code> 行。",
		"",
		"<code>关闭</code>（默认）",
		"不向提示上下文添加时间。",
		"",
		"<code>始终</code>",
		"每个 Telegram 回合都添加时间。",
		"",
		"<code>间隔</code>",
		"每个会话间隔最多添加一次（默认 1 小时）。",
	].join("\n"),
};

export const UI_COMMANDS = {
	start: "打开菜单或完成配对",
	compact: "压缩当前会话",
	spawn: "新开本机 Pi 实例与 Telegram 话题",
	next: "强制执行下一任务",
	continue: "排队继续提示",
	abort: "中止当前任务",
	stop: "中止任务并清空队列",
	setup: "配置 Telegram bot token。使用 /telegram-setup <name> 指定命名配置。",
	status: "显示 Telegram 桥接状态",
	connect: "启动 Telegram 桥接。使用 /telegram-connect <name> 指定命名配置。",
	disconnect: "停止 Telegram；在话题模式下，删除本实例当前话题",
	nextEmpty: "<b>队列为空</b>",
	nextAbortedDispatch: "已中止当前回合，正在调度下一排队任务。",
	nextDispatching: "正在调度下一排队任务。",
	compactQuestion: "<b>压缩会话？</b>",
	compactYes: "压缩",
	compactNo: "取消",
	compactionCancelled: "已取消压缩。",
	compactionStarted: "压缩已开始。",
	compactionCompleted: "压缩完成。",
	compactionFailed: (detail: string) => `压缩失败：${detail}`,
	spawnQuestion:
		"<b>新开本机 Pi 实例？</b>\n\n会在本机打开可见终端，自动连接 Telegram，并创建新话题。当前话题与上下文保留。",
	spawnYes: "🆕 新开",
	spawnNo: "取消",
	spawnCancelled: "已取消新开实例。",
	spawnRunning: "正在本机启动新 Pi 实例…",
	spawnStarted: "已启动本机新 Pi 实例。请切换到新 Telegram 话题继续；当前话题上下文仍保留。",
	spawnFailed: (detail: string) => `新开实例失败：${detail}`,
	spawnRequiresThreadedMode: "需要 Telegram 话题模式（Threaded Mode）才能新开实例。",
	spawnRateLimited: (waitSec: number) => `操作过于频繁，请 ${waitSec} 秒后再试。`,
	noActiveTurn: "当前没有进行中的回合。",
	abortedCurrent: "已中止当前回合。",
	clearedTurns: (countLabel: string) => `已清除 ${countLabel}。`,
	noActiveTurnWithClear: (suffix: string) => `当前没有进行中的回合。${suffix}`,
	abortedCurrentWithClear: (suffix: string) => `已中止当前回合。${suffix}`,
	helpStart: "/start — 打开菜单或完成配对",
	helpCompact: "/compact — 压缩当前会话",
	helpSpawn: "/spawn — 新开本机 Pi 实例与 Telegram 话题",
	helpNext: "/next — 强制执行下一任务",
	helpContinue: "/continue — 排队继续提示",
	helpAbort: "/abort — 中止当前任务",
	helpStop: "/stop — 中止任务并清空队列",
};

export const UI_THREAD = {
	chooseTargetTitle: "<b>选择目标话题</b>",
	allTabBody: (command: string) =>
		["<b>选择目标话题</b>", "", `你在「全部」中使用了 <code>/${command}</code>。`, "请选择应处理它的 Pi 话题："].join(
			"\n",
		),
	replaceRestoreButton: "替换或恢复话题…",
	replaceRestoreTitle: "<b>替换或恢复话题</b>",
	replaceRestoreBody: "选择要迁移到此新话题的 Pi 实例：",
	newThreadNotInstance: "<b>新话题还不是 Pi 实例</b>",
	createBoundGuidance: [
		"要创建绑定的 Telegram 标签页：",
		"<code>1.</code> 在终端再启动一个 Pi 实例。",
		"<code>2.</code> 在该实例中运行 <code>/telegram-connect</code>。",
		"<code>3.</code> 桥接会为其创建并绑定一个新标签页。",
	].join("\n"),
	rerouteBody: ["<b>选择目标话题</b>", "", "你的消息仍保留在此话题中。", "请选择应处理它的 Pi 话题："].join("\n"),
	instanceConnected: (label: string) => `实例 <b>${label}</b> 已连接。`,
	instanceState: (label: string, state: string) => `实例 <b>${label}</b> ${state}。`,
	unboundThread: "此话题尚未绑定 Pi 实例。请打开已激活的 Pi 话题，或在 Pi 会话中运行 /telegram-connect 完成绑定。",
	threadedModePromptHint: "此 bot 处于话题多实例模式。请在已绑定的 Pi 话题标签页中发送提示，以便路由到正确实例。",
	instanceStarting: (label: string) => `实例 ${label} 正在启动，请稍候…`,
};

export function formatVoiceModeLabel(mode: "hidden" | "mirror" | "always"): string {
	if (mode === "mirror") return UI_SETTINGS.modeMirror;
	if (mode === "always") return UI_SETTINGS.modeAlways;
	return UI_SETTINGS.modeHidden;
}

export function formatTimeModeLabel(mode: "hidden" | "always" | "interval"): string {
	if (mode === "always") return UI_SETTINGS.modeAlways;
	if (mode === "interval") return UI_SETTINGS.modeInterval;
	return UI_SETTINGS.modeHidden;
}

export function formatRenderingModeLabel(mode: "rich" | "html"): string {
	return mode === "html" ? UI_SETTINGS.modeHtml : UI_SETTINGS.modeRich;
}

export function formatOnOffLabel(enabled: boolean): string {
	return enabled ? UI_SETTINGS.on : UI_SETTINGS.off;
}

export function formatStatusStateLabel(state: "idle" | "active" | "pending" | "unknown"): string {
	if (state === "idle") return UI_STATUS.stateIdle;
	if (state === "active") return UI_STATUS.stateActive;
	if (state === "pending") return UI_STATUS.statePending;
	return UI_STATUS.stateUnknown;
}
