/**
 * PiDesk desktop panel for the Telegram bridge — pure projection
 * Zones: telegram, desktop
 * Read-only projection of bridge state onto the right-hand ContextSidebar tab.
 *
 * Deliberately **SDK-type-only**: nothing here imports runtime code from
 * `@pidesk/view-sdk`. Only `desktop-panel-sdk.ts` may reach it, and only lazily,
 * so an SDK that cannot resolve degrades to "no desktop host" instead of killing
 * the whole bridge.
 * The resident lifecycle that actually opens the panel lives in the adapter
 * added by the entrypoint wiring.
 *
 * Projection is pure — it reads only state the TUI already holds, so the
 * panel can never disagree with `/telegram-status`. Budget accounting and frame
 * coalescing are not projected here: `measureViewTree` / `createViewFrameScheduler`
 * in the SDK own them.
 *
 * Layout is tuned for a 300px sidebar (299px panel body, 241px inside a card).
 * Text budgets there are the narrowest-safe values; a Host that advertises
 * `view-layout` reports the real content width and wider sidebars spend
 * proportionally more text (docs/06 R5). See
 * `Docs/05-Telegram侧栏界面重设计·设计稿.html` for the measured numbers behind
 * every width/label choice here.
 */

import type { ViewAction, ViewNode, ViewPanelBadge, ViewTableColumn } from "@pidesk/view-sdk";
import type * as Status from "./status.ts";
import type * as Threads from "./threads.ts";

// --- Identity & bounds ---

/** Stable panel slot id. Never derive this from a viewId — reconnect must replace in place. */
export const TELEGRAM_PANEL_ID = "telegram-bridge";

/** Panel title shown on the ContextSidebar tab. */
export const TELEGRAM_PANEL_TITLE = "Telegram";

/** Actions the panel sends back (declared as `kind: "event"` so the view stays open). */
export const TELEGRAM_PANEL_ACTIONS = {
	connect: "tg:connect",
	disconnect: "tg:disconnect",
	refresh: "tg:refresh",
} as const;

export type TelegramPanelAction = (typeof TELEGRAM_PANEL_ACTIONS)[keyof typeof TELEGRAM_PANEL_ACTIONS];

export function isTelegramPanelAction(value: string): value is TelegramPanelAction {
	return (
		value === TELEGRAM_PANEL_ACTIONS.connect ||
		value === TELEGRAM_PANEL_ACTIONS.disconnect ||
		value === TELEGRAM_PANEL_ACTIONS.refresh
	);
}

/** Max runtime events mirrored into the panel. */
export const PANEL_MAX_EVENTS = 20;

/** Max queue rows rendered (budget: ≤50). */
export const PANEL_MAX_QUEUE_ROWS = 50;

/** Max thread rows rendered (budget: ≤20). */
export const PANEL_MAX_THREAD_ROWS = 20;

/** Max "需要处理" conclusion lines before the remainder is counted, not listed. */
export const PANEL_MAX_ACTION_LINES = 4;

/** Summary width in the queue table at the 300px reference sidebar. */
export const PANEL_SUMMARY_CHARS = 40;

/** Base truncation budgets measured at the 300px reference sidebar. */
const PANEL_THREAD_DETAIL_CHARS = 80;
const PANEL_EVENT_MESSAGE_CHARS = 120;
const PANEL_ACTION_ERROR_CHARS = 34;

/** Sidebars wider than this can afford proportionally more text (docs/06 R5). */
const PANEL_REFERENCE_WIDTH = 300;

/**
 * Host capabilities the projection branches on, resolved once per open from the
 * SDK's `hello` advertisement. Every flag defaults to `false`: an older Host
 * must keep today's tree instead of receiving a field its sanitizer drops.
 */
export interface TelegramPanelCapabilities {
	/** `table` nodes render instead of the `row`/`text` composition. */
	table: boolean;
	/** `list.readonly` is kept and drawn as a non-selectable list. */
	readonlyList: boolean;
	/** `placementHint.panelBadge` reaches the sidebar tab / launcher. */
	panelBadge: boolean;
	/** `placementHint.panelHeader` renders above the scroll container. */
	panelHeader: boolean;
}

export const NO_TELEGRAM_PANEL_CAPABILITIES: TelegramPanelCapabilities = {
	table: false,
	readonlyList: false,
	panelBadge: false,
	panelHeader: false,
};

// --- Projection ---

/** Everything the projection reads. Callers supply live getters — nothing is cached here. */
export interface TelegramPanelSource {
	getStatusState: () => Status.TelegramBridgeStatusLineState;
	/** Thread records already filtered to the *active* profile. */
	listThreads: () => Threads.TelegramTopicTargetRecord[];
	/** Queued items with a human-readable summary and the stable enqueue order. */
	listQueuedItems: () => Array<{
		queueLane: Status.TelegramStatusQueueLane;
		/** Enqueue sequence; the stable half of the table row id when present. */
		queueOrder?: number;
		summary: string;
	}>;
}

export interface TelegramPanelProjectionOptions {
	nowMs?: number;
	capabilities?: TelegramPanelCapabilities;
	/**
	 * Host-reported content-box width (docs/06 R5). Absent on old Hosts and
	 * before the first `layout` event, so copy falls back to the narrowest-safe
	 * budgets.
	 */
	width?: number;
}

/**
 * The panel tree plus its action rows. No node count: the tree's budget weight is
 * the SDK's `measureViewTree` (Host accounting, not an approximation), and the
 * client pre-flights every outbound frame.
 */
export interface TelegramPanelProjection {
	root: ViewNode;
	actions: ViewAction[];
	/** Present only when the Host advertises `panel-tab-badge` and threads need attention. */
	badge?: ViewPanelBadge;
	/** Present only when the Host advertises `panel-header`; the status row then leaves `root`. */
	header?: ViewNode[];
}

interface PanelTextLimits {
	summary: number;
	thread: number;
	event: number;
	action: number;
}

/**
 * Wider sidebars can show more text, but the base budgets are the measured
 * narrowest-safe values — never shrink below them, and cap growth at 2× so a
 * maximized sidebar cannot push every long error into the frame payload.
 */
function textLimit(base: number, width: number | undefined): number {
	if (width === undefined || !Number.isFinite(width) || width <= PANEL_REFERENCE_WIDTH) return base;
	return Math.min(Math.round((base * width) / PANEL_REFERENCE_WIDTH), base * 2);
}

function panelTextLimits(width: number | undefined): PanelTextLimits {
	return {
		summary: textLimit(PANEL_SUMMARY_CHARS, width),
		thread: textLimit(PANEL_THREAD_DETAIL_CHARS, width),
		event: textLimit(PANEL_EVENT_MESSAGE_CHARS, width),
		action: textLimit(PANEL_ACTION_ERROR_CHARS, width),
	};
}

const LANE_ORDER: Status.TelegramStatusQueueLane[] = ["control", "priority", "default"];

const LANE_LABEL: Record<Status.TelegramStatusQueueLane, string> = {
	control: "控制",
	priority: "优先",
	default: "默认",
};

/**
 * Single glyph per lane inside the table. Two CJK glyphs advance 24px, and at the
 * minimum draggable sidebar width the lane column is only 22.4px wide — so a
 * two-char label is guaranteed to clip. The full words stay in the caption lines.
 */
const LANE_SHORT: Record<Status.TelegramStatusQueueLane, string> = {
	control: "控",
	priority: "优",
	default: "默",
};

/** Thread lifecycle and topic-sync enums are surfaced as operator-facing Chinese. */
const THREAD_STATUS_LABEL: Record<string, string> = {
	active: "活跃",
	offline: "离线",
	stale: "过期",
	pending: "待处理",
	starting: "启动中",
	"probe-required": "需探测",
	failed: "失败",
};

const THREAD_SYNC_LABEL: Record<string, string> = {
	open: "正常",
	closed: "已关闭",
	deleted: "已删除",
	unknown: "未知",
};

function text(content: string, variant?: "body" | "caption" | "heading"): ViewNode {
	return variant === undefined ? { type: "text", content } : { type: "text", content, variant };
}

function row(...children: ViewNode[]): ViewNode {
	return { type: "row", gap: 6, children };
}

/** `—` when unset, so rows never collapse to an empty line. */
function orDash(value: string | number | undefined | null): string {
	if (value === undefined || value === null) return "—";
	const rendered = String(value);
	return rendered.length > 0 ? rendered : "—";
}

function truncate(value: string, max = 48): string {
	if (value.length <= max) return value;
	return `${value.slice(0, max - 1)}…`;
}

function label(map: Record<string, string>, value: string | undefined): string | undefined {
	return value === undefined ? undefined : (map[value] ?? value);
}

/**
 * A key/value pair list. `table` when the Host advertises `view-table`, otherwise
 * the equivalent `row` composition — an unsupported node would land as an
 * `unknown` placeholder, which is not an acceptable way to show diagnostics.
 */
function keyValueNode(id: string, pairs: Array<[string, string]>, tableCapable: boolean): ViewNode {
	if (!tableCapable) {
		return {
			type: "column",
			children: pairs.map(([key, value]) => row(text(key, "caption"), text(value))),
		};
	}
	const columns: ViewTableColumn[] = [
		{ key: "k", label: "键", width: 1 },
		{ key: "v", label: "值", width: 3 },
	];
	return {
		type: "table",
		id,
		columns,
		rows: pairs.map(([key, value], index) => ({ id: `${id}-${index}`, cells: { k: key, v: value } })),
	};
}

/**
 * `[hh:mm:ss] category` — events carry a category, never a severity, so the panel
 * must not dress the category up as a log level.
 */
export function formatRuntimeEvent(event: Status.TelegramRuntimeEvent, nowMs: number): string {
	const at = Number.isFinite(event.at) ? event.at : nowMs;
	const stamp = new Date(at).toISOString().slice(11, 19);
	return `${stamp} ${event.category || "event"}`;
}

/**
 * Panel actions. Exactly one transport action is offered, and it is the one that
 * matches live state: 断开 only while polling, 连接 only when a token exists.
 * The old disabled 「已连接」 button is gone — the status heading already says that,
 * and a button that repeats a label without being clickable is noise.
 */
export function buildPanelActions(state: Status.TelegramBridgeStatusLineState): ViewAction[] {
	const connected = state.pollingActive;
	const transport: ViewAction = connected
		? { id: TELEGRAM_PANEL_ACTIONS.disconnect, label: "断开", variant: "ghost", kind: "event" }
		: {
				id: TELEGRAM_PANEL_ACTIONS.connect,
				label: "连接",
				variant: "primary",
				kind: "event",
				disabled: !state.hasBotToken,
			};
	return [transport, { id: TELEGRAM_PANEL_ACTIONS.refresh, label: "刷新", variant: "ghost", kind: "event" }];
}

/** Two booleans, expanded: never "connected" because a tab is open (§2.5 of the design doc). */
function statusHeadline(state: Status.TelegramBridgeStatusLineState): string {
	if (!state.hasBotToken) return "⚪ 未配置凭据";
	return state.pollingActive ? "🟢 已连接" : "🟡 已停止";
}

function statusSubline(state: Status.TelegramBridgeStatusLineState): string {
	if (!state.hasBotToken) return "运行 /telegram-setup 配置 bot token";
	const bot = state.botUsername ? `@${state.botUsername}` : "未命名";
	const tail = state.pollingActive ? orDash(state.busRole) : "点「连接」开始收发";
	return `${bot} · ${orDash(state.activeProfileName)} · ${tail}`;
}

/**
 * The conclusion block: what the operator has to do, derived only from fields the
 * TUI already prints. Presentation, not new domain state.
 */
function buildActionLines(
	state: Status.TelegramBridgeStatusLineState,
	threads: Threads.TelegramTopicTargetRecord[],
	limits: PanelTextLimits,
): string[] {
	const lines: string[] = [];
	if (!state.hasBotToken) lines.push("缺 bot 凭据：运行 /telegram-setup");
	else if (!state.pollingActive) lines.push("未在轮询：点「连接」开始收发");

	for (const record of threads) {
		const name = threadTitle(record);
		if (record.status === "failed")
			lines.push(`线程「${name}」失败：${truncate(record.lastError ?? "无详情", limits.action)}`);
		else if (record.status === "probe-required") lines.push(`线程「${name}」需重新探测：点「刷新」`);
	}

	if (state.pollingActive) {
		const urgent = state.queuedItems.filter((item) => item.queueLane !== "default").length;
		if (urgent > 0) lines.push(`控制/优先车道有 ${urgent} 条待派发`);
	}
	if (state.compactionInProgress) lines.push("正在压缩会话，新消息会排队");
	else if (state.pendingDispatch) lines.push("有轮次待派发");
	else if (state.activeToolExecutions > 0) lines.push(`正在执行工具 ×${state.activeToolExecutions}`);
	return lines;
}

/** Thread name, or the target's own id — never a bare `undefined`. */
function threadTitle(record: Threads.TelegramTopicTargetRecord): string {
	return record.threadName ?? `thread ${record.target.threadId}`;
}

function laneCounts(items: Array<{ queueLane: Status.TelegramStatusQueueLane }>): string {
	return LANE_ORDER.map(
		(lane) => `${LANE_LABEL[lane]} ${items.filter((item) => item.queueLane === lane).length}`,
	).join(" / ");
}

function activeTurnLabel(state: Status.TelegramBridgeStatusLineState): string {
	if (state.pendingDispatch) return "派发中";
	if (state.compactionInProgress) return "压缩中";
	if (state.activeToolExecutions > 0) return `工具 ×${state.activeToolExecutions}`;
	return "空闲";
}

/** Dispatch order: control lane first, then priority, then default. */
function orderedByLane<T extends { queueLane: Status.TelegramStatusQueueLane }>(items: readonly T[]): T[] {
	return [...items].sort((a, b) => LANE_ORDER.indexOf(a.queueLane) - LANE_ORDER.indexOf(b.queueLane));
}

/**
 * 概览: conclusions first, then the two counts that decide whether to open another
 * tab, then the internals demoted out of the glance area.
 */
function buildOverviewChildren(
	state: Status.TelegramBridgeStatusLineState,
	threads: Threads.TelegramTopicTargetRecord[],
	capabilities: TelegramPanelCapabilities,
	limits: PanelTextLimits,
): ViewNode[] {
	const lines = buildActionLines(state, threads, limits);
	const shown = lines.slice(0, PANEL_MAX_ACTION_LINES);
	const broken = threads.filter((record) => record.status === "failed" || record.status === "probe-required").length;

	const children: ViewNode[] = [text("需要处理", "caption")];
	if (shown.length === 0) children.push(text("无待处理事项"));
	else children.push(...shown.map((line) => text(line)));
	if (lines.length > shown.length) children.push(text(`其余 ${lines.length - shown.length} 条见「事件」`, "caption"));

	children.push({ type: "divider" });
	children.push(text(`车道 · ${laneCounts(state.queuedItems)}（活动轮次：${activeTurnLabel(state)}）`, "caption"));
	children.push(text(`线程 · ${threads.length} 个，${broken} 个需处理`, "caption"));

	children.push({ type: "divider" });
	children.push(text("链路", "caption"));
	children.push(
		keyValueNode(
			"tg-link",
			[
				["实例槽", orDash(state.instanceSlot)],
				["桥接线程", orDash(state.instanceThreadName)],
				["锁", orDash(state.lockState)],
				["Bus", `${orDash(state.busRole)}${state.busLifecyclePhase ? ` · ${state.busLifecyclePhase}` : ""}`],
				["最近 update", state.lastUpdateId === undefined ? "—" : `#${state.lastUpdateId}`],
				["活动轮次", activeTurnLabel(state)],
			],
			capabilities.table,
		),
	);
	return children;
}

function buildQueueChildren(
	items: Array<{ queueLane: Status.TelegramStatusQueueLane; queueOrder?: number; summary: string }>,
	capabilities: TelegramPanelCapabilities,
	limits: PanelTextLimits,
): ViewNode[] {
	const shown = orderedByLane(items).slice(0, PANEL_MAX_QUEUE_ROWS);
	const next = shown[0];
	const children: ViewNode[] = [
		text(`共 ${items.length} 条 · 下一条：${next ? LANE_LABEL[next.queueLane] : "—"}`, "caption"),
	];

	if (shown.length === 0) {
		children.push(text("队列为空", "caption"));
		return children;
	}

	if (capabilities.table) {
		// 扩展侧切片而不是把整队塞给宿主：协议另有 maxTableRows 硬上限，
		// 超出的行会被静默丢掉，面板就会假装队列更短。截断必须自己报数。
		const columns: ViewTableColumn[] = [
			{ key: "lane", label: "车道", width: 1 },
			{ key: "summary", label: "摘要", width: 3 },
		];
		children.push({
			type: "table",
			id: "tg-queue",
			columns,
			rows: shown.map((item, index) => ({
				// 行身份必须是「车道 + 入队序号」：Host 用 row.id 做 React key，
				// 出队一次就整体下标位移的话，剩下的行会被当成换了一批。
				id: `queue-${item.queueLane}-${item.queueOrder ?? index}`,
				cells: { lane: LANE_SHORT[item.queueLane], summary: truncate(item.summary, limits.summary) },
			})),
		});
	} else {
		children.push({
			type: "column",
			children: shown.map((item, index) =>
				text(`${index + 1}. ${LANE_SHORT[item.queueLane]} · ${truncate(item.summary, limits.summary)}`),
			),
		});
	}
	if (items.length > shown.length) {
		children.push(text(`显示 ${shown.length} / 共 ${items.length}`, "caption"));
	}
	return children;
}

/**
 * Threads as `list` rows: the description wraps instead of ellipsizing, which is
 * the only way a long `lastError` stays readable in 300px. `list` items are
 * options, not nodes, so they do not draw down `maxNodes`.
 *
 * `readonly` is only sent to Hosts that advertise `view-readonly-list`: the rows
 * are diagnostics, not answers, and clicking one must not write `values` (R1).
 */
function buildThreadChildren(
	threads: Threads.TelegramTopicTargetRecord[],
	limits: PanelTextLimits,
	readonlyList: boolean,
): ViewNode[] {
	const shown = threads.slice(0, PANEL_MAX_THREAD_ROWS);
	const children: ViewNode[] = [text(`共 ${threads.length} 个`, "caption")];
	if (shown.length === 0) {
		children.push(text("尚未创建线程", "caption"));
		return children;
	}
	children.push({
		type: "list",
		id: "tg-threads",
		...(readonlyList ? { readonly: true } : {}),
		items: shown.map((record) => {
			const bits = [
				label(THREAD_STATUS_LABEL, record.status) ?? "—",
				`同步 ${label(THREAD_SYNC_LABEL, record.syncStatus) ?? "未知"}`,
			];
			if (record.slot) bits.push(`槽位 ${record.slot}`);
			const detail = record.lastError ?? record.lastSyncError;
			if (detail) bits.push(truncate(detail, limits.thread));
			return {
				value: String(record.target.threadId ?? record.target.chatId),
				label: threadTitle(record),
				description: bits.join(" · "),
			};
		}),
	});
	if (threads.length > shown.length) children.push(text(`显示 ${shown.length} / 共 ${threads.length}`, "caption"));
	return children;
}

/** Events newest first. No tab status dot: there is no severity field to derive one from. */
function buildEventChildren(
	state: Status.TelegramBridgeStatusLineState,
	nowMs: number,
	limits: PanelTextLimits,
	readonlyList: boolean,
): ViewNode[] {
	const events = state.recentRuntimeEvents.slice(-PANEL_MAX_EVENTS).reverse();
	const children: ViewNode[] = [text(`最近 ${events.length} 条`, "caption")];
	if (events.length === 0) {
		children.push(text("暂无 runtime event", "caption"));
		return children;
	}
	children.push({
		type: "list",
		id: "tg-events",
		...(readonlyList ? { readonly: true } : {}),
		items: events.map((event, index) => ({
			value: `${event.at}-${index}`,
			label: formatRuntimeEvent(event, nowMs),
			description: truncate(event.message, limits.event),
		})),
	});
	return children;
}

/**
 * Build the whole panel tree.
 *
 * Capabilities come from the Host `hello` advertisement, resolved once per open:
 * without `view-table` the queue and link lists fall back to `row`/`text`
 * composition, which reads worse but never lands as an `unknown` placeholder.
 *
 * The `tabs` node deliberately carries **no `activeTab`**: the Host only treats a
 * *changed* explicit value as extension takeover (`reconcileActiveTab`), so an
 * omitted key keeps the tab the user picked, while echoing one every poll frame
 * would yank them back to 概览 once a second.
 */
export function projectTelegramPanel(
	source: TelegramPanelSource,
	options: TelegramPanelProjectionOptions = {},
): TelegramPanelProjection {
	const capabilities = options.capabilities ?? NO_TELEGRAM_PANEL_CAPABILITIES;
	const limits = panelTextLimits(options.width);
	const nowMs = options.nowMs ?? Date.now();
	const state = source.getStatusState();
	const threads = source.listThreads();
	const items = source.listQueuedItems();
	const lines = buildActionLines(state, threads, limits);
	const broken = threads.filter((record) => record.status === "failed" || record.status === "probe-required").length;
	const urgentQueued = state.queuedItems.some((item) => item.queueLane !== "default");

	const statusRow = row(text(statusHeadline(state), "heading"), text(statusSubline(state), "caption"));
	const tabs: ViewNode = {
		type: "tabs",
		id: "tg-tabs",
		tabs: [
			{
				id: "overview",
				label: "概览",
				status: lines.length > 0 ? "attention" : "answered",
				children: buildOverviewChildren(state, threads, capabilities, limits),
			},
			{
				id: "queue",
				label: "队列",
				status: urgentQueued ? "attention" : "answered",
				children: buildQueueChildren(items, capabilities, limits),
			},
			{
				id: "threads",
				label: "线程",
				status: broken > 0 ? "attention" : "answered",
				children: buildThreadChildren(threads, limits, capabilities.readonlyList),
			},
			{
				id: "events",
				label: "事件",
				// 信息流不是待回答的题：不画状态点；旧 Host 丢 "none" 会退回空心点是可接受退化
				status: "none",
				children: buildEventChildren(state, nowMs, limits, capabilities.readonlyList),
			},
		],
	};

	const projection: TelegramPanelProjection = {
		// 状态行在支持固定头部槽时移出滚动区，避免长页签把它滚走（docs/06 R9）
		root: { type: "column", children: capabilities.panelHeader ? [tabs] : [statusRow, tabs] },
		actions: buildPanelActions(state),
	};
	if (capabilities.panelHeader) projection.header = [statusRow];
	if (capabilities.panelBadge && broken > 0) {
		projection.badge = { tone: "attention", count: broken, label: "需要处理" };
	}
	return projection;
}
