/**
 * Regression tests for the Telegram desktop panel
 * Covers projection (node budget, empty states, lane grouping, event bounds),
 * the frame budget as driven by the SDK scheduler, and the resident lifecycle.
 *
 * The scheduler itself is not unit-tested here: `createViewFrameScheduler` moved
 * into `@pidesk/view-sdk` and its merge/backpressure/stop
 * semantics are pinned by that package's 13 tests. What this suite owns is the
 * wiring — the panel gets one frame per window, flushes at action boundaries, and
 * never resurrects a stopped scheduler.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createViewFrameScheduler, measureViewTree, VIEW_LIMITS } from "@pidesk/view-sdk";
import { createTelegramPanelRuntime, type TelegramPanelSdk, type TelegramPanelSession } from "../lib/desktop-panel.ts";
import { readTelegramPanelCapabilities, type TelegramPanelCapabilitySurface } from "../lib/desktop-panel-sdk.ts";
import {
	formatRuntimeEvent,
	isTelegramPanelAction,
	NO_TELEGRAM_PANEL_CAPABILITIES,
	PANEL_MAX_ACTION_LINES,
	PANEL_MAX_EVENTS,
	PANEL_MAX_QUEUE_ROWS,
	PANEL_MAX_THREAD_ROWS,
	PANEL_SUMMARY_CHARS,
	projectTelegramPanel,
	TELEGRAM_PANEL_ACTIONS,
	TELEGRAM_PANEL_ID,
	type TelegramPanelCapabilities,
	type TelegramPanelProjection,
	type TelegramPanelSource,
} from "../lib/desktop-view.ts";
import type { TelegramBridgeStatusLineState } from "../lib/status.ts";
import type { TelegramTopicTargetRecord } from "../lib/threads.ts";

// --- helpers ---

/** Structural view of a ViewNode for assertions. */
type AnyNode = {
	type: string;
	id?: string;
	children?: AnyNode[];
	title?: string;
	content?: string;
	variant?: string;
	tabs?: Array<{ id?: string; label?: string; status?: string; children: AnyNode[] }>;
	columns?: Array<{ key: string; label: string; width?: number; align?: string }>;
	rows?: Array<{ id: string; cells: Record<string, unknown> }>;
	items?: Array<{ value: string; label: string; description?: string }>;
	multiple?: boolean;
	readonly?: boolean;
	activeTab?: string;
	emptyText?: string;
	maxRows?: number;
};

type AnyPlacementHint = {
	panelId?: string;
	panelBadge?: { tone?: string; count?: number; label?: string };
	panelHeader?: AnyNode[];
};

type AnyFrame = { root: AnyNode; actions: unknown; placementHint?: AnyPlacementHint };

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until `check()` holds, so assertions don't race the scheduler. */
async function until(check: () => boolean, timeoutMs = 1000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (check()) return;
		await delay(5);
	}
	throw new Error("condition not reached before timeout");
}

function baseState(overrides: Partial<TelegramBridgeStatusLineState> = {}): TelegramBridgeStatusLineState {
	return {
		hasBotToken: true,
		botUsername: "yoki_bot",
		activeProfileName: "default",
		pollingActive: true,
		pendingDispatch: false,
		compactionInProgress: false,
		activeToolExecutions: 0,
		pendingModelSwitch: false,
		queuedItems: [],
		recentRuntimeEvents: [],
		...overrides,
	};
}

function source(
	state: TelegramBridgeStatusLineState,
	threads: TelegramTopicTargetRecord[] = [],
	queue: Array<{ queueLane: "control" | "priority" | "default"; queueOrder?: number; summary: string }> = [],
): TelegramPanelSource {
	return {
		getStatusState: () => state,
		listThreads: () => threads,
		listQueuedItems: () => queue,
	};
}

function allText(node: AnyNode): string[] {
	const out: string[] = [];
	if (typeof node.content === "string") out.push(node.content);
	for (const child of node.children ?? []) out.push(...allText(child));
	for (const tab of node.tabs ?? []) {
		for (const child of tab.children) out.push(...allText(child));
	}
	return out;
}

/** `capabilities` keeps the old boolean shorthand for the many table-only cases. */
function project(
	state: TelegramBridgeStatusLineState,
	threads: TelegramTopicTargetRecord[] = [],
	queue: Array<{ queueLane: "control" | "priority" | "default"; queueOrder?: number; summary: string }> = [],
	capabilities: boolean | Partial<TelegramPanelCapabilities> = false,
): TelegramPanelProjection {
	const resolved =
		typeof capabilities === "boolean"
			? { ...NO_TELEGRAM_PANEL_CAPABILITIES, table: capabilities }
			: { ...NO_TELEGRAM_PANEL_CAPABILITIES, ...capabilities };
	return projectTelegramPanel(source(state, threads, queue), { nowMs: 1_700_000_000_000, capabilities: resolved });
}

/** First table anywhere below these nodes — tab bodies mix tables, lists and captions. */
function firstTable(nodes: AnyNode[]): AnyNode | undefined {
	for (const node of nodes) {
		if (node.type === "table") return node;
		const found = node.children ? firstTable(node.children) : undefined;
		if (found) return found;
	}
	return undefined;
}

/** First `list` node below these nodes. */
function firstList(nodes: AnyNode[]): AnyNode | undefined {
	for (const node of nodes) {
		if (node.type === "list") return node;
		const found = node.children ? firstList(node.children) : undefined;
		if (found) return found;
	}
	return undefined;
}

/** Any table anywhere in the tree — used to assert the Host never receives one. */
function findTable(node: AnyNode): AnyNode | undefined {
	if (node.type === "table") return node;
	for (const child of node.children ?? []) {
		const found = findTable(child);
		if (found) return found;
	}
	for (const tab of node.tabs ?? []) {
		for (const child of tab.children) {
			const found = findTable(child);
			if (found) return found;
		}
	}
	return undefined;
}

// --- projection: structure & budget ---

/** The panel's single `tabs` container. */
function tabsNode(root: AnyNode): AnyNode {
	const tabs = (root.children ?? []).find((child) => child.type === "tabs");
	assert.ok(tabs, "tabs node missing");
	return tabs;
}

function tabById(root: AnyNode, id: string): { id?: string; label?: string; status?: string; children: AnyNode[] } {
	const tab = tabsNode(root).tabs?.find((entry) => entry.id === id);
	assert.ok(tab, `tab "${id}" missing`);
	return tab;
}

function tabText(root: AnyNode, id: string): string[] {
	return allText({ type: "column", children: tabById(root, id).children });
}

test("Panel renders a status row over four tabs and stays well inside maxNodes=512", () => {
	const projection = project(baseState());
	const root = projection.root as unknown as AnyNode;
	assert.equal(root.type, "column");
	assert.equal(root.children?.length, 2);
	assert.equal(root.children?.[0].type, "row");
	assert.equal(tabsNode(root).id, "tg-tabs");
	assert.deepEqual(
		tabsNode(root).tabs?.map((tab) => tab.label),
		["概览", "队列", "线程", "事件"],
	);
	// 预算口径来自 SDK（与 Host `sanitizeTree` 锁步），不是扩展自己的计数
	const budget = measureViewTree(projection.root, VIEW_LIMITS);
	assert.ok(budget.nodes < 100, `expected a light tree, got ${budget.nodes}`);
});

test("Tabs never carry activeTab: a poll frame must not yank the user's tab choice", () => {
	// Host 的 reconcileActiveTab 只在「显式值与上次不同」时接管。投影每 1s 重算一次，
	// 一旦带上 activeTab，用户点开的页签会被拽回第一页——这是本地切换权的回归，不是风格问题。
	for (const tableCapable of [false, true]) {
		const root = project(baseState({ pollingActive: false }), [], [], tableCapable).root as unknown as AnyNode;
		assert.equal(
			"activeTab" in tabsNode(root),
			false,
			`activeTab leaked into the ${tableCapable ? "table" : "row"} projection`,
		);
	}
});

test("Tab dots report where the trouble is, and only where the data supports it", () => {
	const calm = tabsNode(project(baseState()).root as unknown as AnyNode).tabs ?? [];
	assert.deepEqual(
		calm.map((tab) => [tab.id, tab.status]),
		[
			["overview", "answered"],
			["queue", "answered"],
			["threads", "answered"],
			["events", "none"],
		],
		"事件 never gets a dot: a runtime event carries a category, never a severity",
	);

	const noisy =
		tabsNode(
			project(baseState({ queuedItems: [{ queueLane: "priority" }] }), [
				{ ...threadRecord(0), status: "failed" } as unknown as TelegramTopicTargetRecord,
			]).root as unknown as AnyNode,
		).tabs ?? [];
	assert.deepEqual(
		noisy.map((tab) => [tab.id, tab.status]),
		[
			["overview", "attention"],
			["queue", "attention"],
			["threads", "attention"],
			["events", "none"],
		],
	);
});

test("Worst-case tree stays inside the node and depth budgets", () => {
	// 预算上限：50 队列行 + 20 threads + 20 events
	const queue = Array.from({ length: 50 }, (_, index) => ({
		queueLane: "default" as const,
		summary: `job-${index}`,
	}));
	const threads = Array.from({ length: 20 }, (_, index) => ({
		profileKey: "default",
		target: { chatId: 1, threadId: index },
		status: "active",
		createdAtMs: 0,
		updatedAtMs: 0,
		threadName: `T${index}`,
		slot: `S${index}`,
		syncStatus: "open",
	})) as unknown as TelegramTopicTargetRecord[];
	const events = Array.from({ length: 20 }, (_, index) => ({
		at: 1_700_000_000_000 + index * 1000,
		category: "poll",
		message: `e-${index}`,
	}));

	const state = baseState({
		queuedItems: queue.map((item) => ({ queueLane: item.queueLane })),
		recentRuntimeEvents: events,
		busRole: "leader",
		busLifecyclePhase: "electing",
		instanceSlot: "A",
		instanceThreadName: "Axial",
		lockState: "active-here",
	});
	const projection = project(state, threads, queue, true);

	// 实测上界：79 节点，远低于 VIEW_LIMITS.maxNodes = 512。
	// 深度只有 3：column → tabs → 页内节点，table 的行计入节点但不计入嵌套。
	// 对照：改版前同一夹具是 127 节点（pidesk/docs/design/19 §9.2 发表值）。
	const budget = measureViewTree(projection.root, VIEW_LIMITS);
	assert.equal(budget.nodes, 79);
	assert.ok(budget.nodes < 512, `node budget exceeded: ${budget.nodes}`);
	assert.equal(budget.depth, 3);
	assert.equal(budget.hitNodeBudget, false, "no child was dropped by the node budget");

	// 老宿主的 row 组合深两层（column → row → text），仍远低于 maxDepth = 32
	const fallback = measureViewTree(project(state, threads, queue, false).root, VIEW_LIMITS);
	assert.equal(fallback.depth, 5);
	assert.equal(fallback.hitNodeBudget, false);
});

// --- projection: status row ---

test("Status row surfaces identity, profile and bus role as one glanceable line", () => {
	const root = project(
		baseState({
			busRole: "leader",
			busLifecyclePhase: "electing",
			instanceSlot: "A",
			instanceThreadName: "Axial",
			lockState: "active-here",
		}),
	).root as unknown as AnyNode;
	const [statusRow] = root.children ?? [];
	const headline = statusRow?.children?.[0];
	const subline = statusRow?.children?.[1];
	assert.equal(headline?.type, "text");
	assert.equal(headline?.variant, "heading");
	assert.equal(headline?.content, "🟢 已连接");
	assert.equal(subline?.variant, "caption");
	assert.match(subline?.content ?? "", /@yoki_bot/);
	assert.match(subline?.content ?? "", /default/);
	assert.match(subline?.content ?? "", /leader$/);
});

test("Status row expands the hasBotToken × pollingActive truth table, never the tab state", () => {
	const head = (state: TelegramBridgeStatusLineState) =>
		((project(state).root as unknown as AnyNode).children?.[0].children?.[0]?.content ?? "").toString();
	assert.equal(head(baseState({ pollingActive: true })), "🟢 已连接");
	assert.equal(head(baseState({ pollingActive: false })), "🟡 已停止");
	assert.equal(head(baseState({ pollingActive: false, hasBotToken: false })), "⚪ 未配置凭据");
	// 有 token 但没在轮询 ≠ 没配 token：两种后果不同，副文案必须分开
	assert.match(
		(
			(project(baseState({ pollingActive: false })).root as unknown as AnyNode).children?.[0].children?.[1]
				?.content ?? ""
		).toString(),
		/点「连接」开始收发/,
	);
	assert.match(
		(
			(project(baseState({ hasBotToken: false, pollingActive: false })).root as unknown as AnyNode).children?.[0]
				.children?.[1]?.content ?? ""
		).toString(),
		/telegram-setup/,
	);
});

// --- projection: overview conclusions ---

test("Overview leads with conclusions derived from live fields", () => {
	const lines = tabText(project(baseState({ pendingDispatch: true })).root as unknown as AnyNode, "overview");
	assert.ok(lines.includes("需要处理"), "conclusion block needs a label");
	assert.ok(lines.includes("有轮次待派发"), lines.join(" | "));

	const busy = tabText(
		project(baseState({ pendingDispatch: false, activeToolExecutions: 2 })).root as unknown as AnyNode,
		"overview",
	);
	assert.ok(busy.includes("正在执行工具 ×2"), busy.join(" | "));

	const compacting = tabText(
		project(baseState({ compactionInProgress: true })).root as unknown as AnyNode,
		"overview",
	);
	assert.ok(compacting.includes("正在压缩会话，新消息会排队"), compacting.join(" | "));

	const calm = tabText(project(baseState()).root as unknown as AnyNode, "overview");
	assert.ok(calm.includes("无待处理事项"), calm.join(" | "));
});

test("Overview names the broken thread and how to act on it", () => {
	const lines = tabText(
		project(baseState(), [
			{
				...threadRecord(0),
				status: "failed",
				lastError: "BOT_INLINE: conflict",
			} as unknown as TelegramTopicTargetRecord,
			{ ...threadRecord(1), status: "probe-required" } as unknown as TelegramTopicTargetRecord,
		]).root as unknown as AnyNode,
		"overview",
	);
	assert.ok(
		lines.some((line) => line.includes("线程「Axial0」失败：") && line.includes("BOT_INLINE")),
		lines.join(" | "),
	);
	assert.ok(
		lines.some((line) => line.includes("线程「Axial1」需重新探测：点「刷新」")),
		lines.join(" | "),
	);
});

test("Conclusion lines are bounded and the remainder is counted, not hidden", () => {
	const threads = Array.from({ length: 6 }, (_, index) => ({
		...threadRecord(index),
		status: "failed",
	})) as unknown as TelegramTopicTargetRecord[];
	const lines = tabText(project(baseState(), threads).root as unknown as AnyNode, "overview");
	const listed = lines.filter((line) => line.includes("线程「"));
	assert.equal(listed.length, PANEL_MAX_ACTION_LINES, "PANEL_MAX_ACTION_LINES listings");
	assert.ok(lines.includes(`其余 ${6 - PANEL_MAX_ACTION_LINES} 条见「事件」`), lines.join(" | "));
});

test("Internals are demoted into the 链路 block but never dropped", () => {
	const lines = tabText(
		project(
			baseState({
				busRole: "leader",
				busLifecyclePhase: "electing",
				instanceSlot: "A",
				instanceThreadName: "Axial",
				lockState: "active-here",
				lastUpdateId: 48213,
			}),
		).root as unknown as AnyNode,
		"overview",
	);
	assert.ok(lines.includes("链路"), "the diagnostics block needs its own label");
	assert.ok(lines.includes("A"));
	assert.ok(lines.includes("Axial"));
	assert.ok(lines.includes("active-here"));
	assert.ok(lines.includes("leader · electing"));
	assert.ok(lines.includes("#48213"));
});

// --- projection: queue tab ---

test("Queue tab lists items in dispatch order and names the next one", () => {
	const queue = [
		{ queueLane: "default" as const, summary: "low" },
		{ queueLane: "control" as const, summary: "stop" },
		{ queueLane: "priority" as const, summary: "ask" },
	];
	const root = project(
		baseState({ queuedItems: [{ queueLane: "control" }, { queueLane: "priority" }, { queueLane: "default" }] }),
		[],
		queue,
		true,
	).root as unknown as AnyNode;
	const table = firstTable(tabById(root, "queue").children) ?? ({} as AnyNode);
	// 控制车道必须先出现（调度顺序对用户可见）
	assert.deepEqual(
		table.rows?.map((row) => row.cells.summary),
		["stop", "ask", "low"],
	);
	const lines = tabText(root, "queue");
	assert.ok(lines.includes("共 3 条 · 下一条：控制"), lines.join(" | "));
	const overview = tabText(root, "overview");
	assert.ok(
		overview.some((line) => line.includes("控制 1 / 优先 1 / 默认 1")),
		`lane counts belong to the overview line, got ${overview.join(" | ")}`,
	);
});

test("Queue tab reports the active turn and an empty state", () => {
	const lines = tabText(project(baseState({ pendingDispatch: true })).root as unknown as AnyNode, "queue");
	assert.ok(lines.includes("队列为空"), lines.join(" | "));
	// 活动轮次不再在队列卡里重复一遍，它归概览的结论行与链路表
	assert.ok(
		tabText(project(baseState({ pendingDispatch: true })).root as unknown as AnyNode, "overview").includes("派发中"),
	);
});

test("Queue tab truncates long queues and reports the overflow count", () => {
	const queue = Array.from({ length: 60 }, (_, index) => ({
		queueLane: "default" as const,
		summary: `item-${index}`,
	}));
	const lines = tabText(
		project(baseState({ queuedItems: queue.map((item) => ({ queueLane: item.queueLane })) }), [], queue, true)
			.root as unknown as AnyNode,
		"queue",
	);
	assert.ok(lines.includes("显示 50 / 共 60"), lines.join(" | "));
});

test("Queue row ids survive a dequeue: identity is lane + enqueue order, not the array index", () => {
	const queue = [
		{ queueLane: "default" as const, queueOrder: 7, summary: "first" },
		{ queueLane: "priority" as const, queueOrder: 8, summary: "second" },
		{ queueLane: "default" as const, queueOrder: 9, summary: "third" },
	];
	const before = firstTable(
		tabById(project(baseState(), [], queue, true).root as unknown as AnyNode, "queue").children,
	);
	const after = firstTable(
		tabById(project(baseState(), [], queue.slice(1), true).root as unknown as AnyNode, "queue").children,
	);
	assert.ok(before && after, "expected both projections to carry a queue table");
	const idsBySummary = new Map(before?.rows?.map((row): [unknown, string] => [row.cells.summary, row.id]));
	for (const row of after?.rows ?? []) {
		assert.equal(row.id, idsBySummary.get(row.cells.summary), `row id drifted for "${String(row.cells.summary)}"`);
	}
});

// --- projection: threads tab ---

test("Threads tab renders records as wrapping list rows, not clipped table cells", () => {
	const emptyRoot = project(baseState()).root as unknown as AnyNode;
	const emptyLines = tabText(emptyRoot, "threads");
	assert.ok(emptyLines.includes("共 0 个"), emptyLines.join(" | "));
	assert.ok(emptyLines.includes("尚未创建线程"), emptyLines.join(" | "));
	assert.equal(
		firstList(tabById(emptyRoot, "threads").children),
		undefined,
		"no list node when there is nothing to list",
	);

	const record = {
		profileKey: "default",
		target: { chatId: 1, threadId: 42 },
		status: "active",
		createdAtMs: 0,
		updatedAtMs: 0,
		threadName: "Axial",
		slot: "A",
		syncStatus: "open",
		lastError: "boom",
	} as unknown as TelegramTopicTargetRecord;
	const list = firstList(tabById(project(baseState(), [record]).root as unknown as AnyNode, "threads").children);
	assert.ok(list, "expected a list node");
	assert.equal(list.id, "tg-threads");
	// 单选型 list 不画勾选框；multiple 一旦为真就会长出复选框，把只读列表伪装成表单
	assert.equal(list.multiple, undefined);
	assert.deepEqual(list.items, [{ value: "42", label: "Axial", description: "活跃 · 同步 正常 · 槽位 A · boom" }]);
});

test("Threads tab labels enums in the operator's language", () => {
	const record = {
		...threadRecord(3),
		status: "probe-required",
		syncStatus: "deleted",
	} as unknown as TelegramTopicTargetRecord;
	const list = firstList(tabById(project(baseState(), [record]).root as unknown as AnyNode, "threads").children);
	const description = list?.items?.[0]?.description ?? "";
	assert.ok(description.includes("需探测"), description);
	assert.ok(description.includes("同步 已删除"), description);
	assert.ok(!description.includes("probe-required"), "raw enum must not reach the panel");
});

// --- projection: events tab ---

test("Events tab is bounded, newest first", () => {
	const events = Array.from({ length: 30 }, (_, index) => ({
		at: 1_700_000_000_000 + index * 1000,
		category: "poll",
		message: `event-${index}`,
	}));
	const root = projectTelegramPanel(source(baseState({ recentRuntimeEvents: events })), { nowMs: 1_700_000_030_000 })
		.root as unknown as AnyNode;
	const list = firstList(tabById(root, "events").children);
	assert.ok(list, "expected a list node");
	assert.equal(list.items?.length, PANEL_MAX_EVENTS);
	assert.ok(list.items?.[0]?.description?.includes("event-29"), `newest first, got ${list.items?.[0]?.description}`);
	assert.ok(list.items?.[PANEL_MAX_EVENTS - 1]?.description?.includes("event-10"));
});

test("Events tab shows an empty state without events", () => {
	const lines = tabText(project(baseState()).root as unknown as AnyNode, "events");
	assert.ok(lines.includes("最近 0 条"), lines.join(" | "));
	assert.ok(lines.includes("暂无 runtime event"), lines.join(" | "));
});

test("Runtime event label stamps time and category — never a fabricated level", () => {
	const label = formatRuntimeEvent({ at: Date.UTC(2024, 0, 2, 3, 4, 5), category: "delivery", message: "x" }, 0);
	assert.equal(label, "03:04:05 delivery");
	// 事件只有 category，没有严重度字段；把它写成 [LEVEL] 是在造一个不存在的维度
	assert.ok(!label.includes("["), label);
	assert.ok(!label.includes("DELIVERY"), "category is not upper-cased into a pseudo level");
});

// --- projection: actions & redaction ---

test("Actions offer exactly one transport verb, matching live state", () => {
	const connected = project(baseState({ pollingActive: true })).actions;
	assert.deepEqual(
		connected.map((action) => [action.id, action.disabled]),
		[
			[TELEGRAM_PANEL_ACTIONS.disconnect, undefined],
			[TELEGRAM_PANEL_ACTIONS.refresh, undefined],
		],
		"已连接 must not come back as a disabled button — the heading already says it",
	);
	// 非 submit：动面板不应关闭面板
	assert.ok(connected.every((action) => action.kind === "event"));

	const stopped = project(baseState({ pollingActive: false })).actions;
	assert.deepEqual(
		stopped.map((action) => [action.id, action.disabled, action.variant]),
		[
			[TELEGRAM_PANEL_ACTIONS.connect, false, "primary"],
			[TELEGRAM_PANEL_ACTIONS.refresh, undefined, "ghost"],
		],
	);
});

test("Connect is disabled without a bot token even when stopped", () => {
	const actions = project(baseState({ pollingActive: false, hasBotToken: false })).actions;
	assert.equal(actions.find((a) => a.id === TELEGRAM_PANEL_ACTIONS.connect)?.disabled, true);
});

test("Projection never leaks diagnostics paths or a token", () => {
	const serialized = JSON.stringify(
		project(
			baseState({
				allowedUserId: 12345,
				diagnosticPaths: { state: "C:/secret/state.json", logs: "C:/secret/logs" },
			}),
		).root,
	);
	assert.ok(!serialized.includes("secret"), "diagnostic paths must not reach the renderer");
	assert.ok(!serialized.toLowerCase().includes("token"));
});

test("Panel action ids are recognized and the slot id is stable", () => {
	assert.equal(TELEGRAM_PANEL_ID, "telegram-bridge");
	assert.ok(isTelegramPanelAction(TELEGRAM_PANEL_ACTIONS.connect));
	assert.ok(isTelegramPanelAction(TELEGRAM_PANEL_ACTIONS.disconnect));
	assert.ok(isTelegramPanelAction(TELEGRAM_PANEL_ACTIONS.refresh));
	assert.equal(isTelegramPanelAction("tg:nope"), false);
});

// --- projection: table mode ---

function threadRecord(index: number): TelegramTopicTargetRecord {
	return {
		profileKey: "default",
		target: { chatId: 1, threadId: 40 + index },
		status: "active",
		createdAtMs: 0,
		updatedAtMs: 0,
		threadName: `Axial${index}`,
		slot: String.fromCharCode(65 + index),
		syncStatus: "open",
		lastError: index === 0 ? "boom" : undefined,
	} as unknown as TelegramTopicTargetRecord;
}

test("Queue renders a table when the Host advertises view-table, with single-glyph lane cells", () => {
	const queue = [
		{ queueLane: "default" as const, summary: "third" },
		{ queueLane: "control" as const, summary: "first" },
		{ queueLane: "priority" as const, summary: "second" },
	];
	const root = project(baseState(), [], queue, true).root as unknown as AnyNode;
	const table = firstTable(tabById(root, "queue").children);
	assert.ok(table, "expected a table node");
	assert.equal(table.id, "tg-queue");
	assert.deepEqual(
		table.columns?.map((column) => column.key),
		["lane", "summary"],
	);
	// 表体按派发顺序出行，而不是按入队顺序
	assert.deepEqual(
		table.rows?.map((row) => row.cells.summary),
		["first", "second", "third"],
	);
	// 车道列在 220px 侧栏只剩 22.4px 文本宽，两个汉字（24px）必被切 → 表内用单字
	assert.deepEqual(
		table.rows?.map((row) => row.cells.lane),
		["控", "优", "默"],
	);
	// 1:3 而不是 1:4：留出表头「车道」两个字的宽度（th 没有 title，切了就读不到）
	assert.deepEqual(
		table.columns?.map((column) => column.width),
		[1, 3],
	);
});

test("Summaries are clipped to the panel budget, and the full text stays one hover away", () => {
	const queue = [{ queueLane: "default" as const, summary: "x".repeat(300) }];
	const table = firstTable(
		tabById(project(baseState(), [], queue, true).root as unknown as AnyNode, "queue").children,
	);
	const summary = String(table?.rows?.[0]?.cells.summary);
	assert.equal(summary.length, PANEL_SUMMARY_CHARS, "extension-side clip");
	assert.ok(summary.endsWith("…"), summary);
});

test("Table mode truncates on its own side so the Host never drops rows silently", () => {
	// 协议有 maxTableRows 硬上限；把整队交给宿主会让超出部分静默消失，
	// 所以扩展必须自己切到面板预算并把真实总数写进表尾。
	const queue = Array.from({ length: PANEL_MAX_QUEUE_ROWS + 7 }, (_, index) => ({
		queueLane: "default" as const,
		summary: `job-${index}`,
	}));
	const threads = Array.from({ length: PANEL_MAX_THREAD_ROWS + 3 }, (_, index) => threadRecord(index));
	const root = project(
		baseState({ queuedItems: queue.map((item) => ({ queueLane: item.queueLane })) }),
		threads,
		queue,
		true,
	).root as unknown as AnyNode;

	const queueTab = tabById(root, "queue").children;
	assert.equal(firstTable(queueTab)?.rows?.length, PANEL_MAX_QUEUE_ROWS);
	assert.ok(
		allText({ type: "column", children: queueTab }).some((line) =>
			line.includes(`显示 ${PANEL_MAX_QUEUE_ROWS} / 共 ${queue.length}`),
		),
		"queue truncation total is reported",
	);
	const threadTab = tabById(root, "threads").children;
	assert.ok(
		allText({ type: "column", children: threadTab }).some((line) =>
			line.includes(`显示 ${PANEL_MAX_THREAD_ROWS} / 共 ${threads.length}`),
		),
		"thread truncation total is reported",
	);
	assert.equal(firstList(threadTab)?.items?.length, PANEL_MAX_THREAD_ROWS);
});

test("Threads and events never depend on the table capability", () => {
	// 两页都是 list：老宿主同样能画，且 items 不吃 maxNodes
	const events = [{ at: 1_700_000_000_000, category: "delivery", message: "boom" }];
	for (const tableCapable of [false, true]) {
		const root = project(baseState({ recentRuntimeEvents: events }), [threadRecord(0)], [], tableCapable)
			.root as unknown as AnyNode;
		assert.ok(firstList(tabById(root, "threads").children), `threads list in ${tableCapable ? "table" : "row"} mode`);
		assert.ok(firstList(tabById(root, "events").children), `events list in ${tableCapable ? "table" : "row"} mode`);
	}
});

// --- projection: 0.5.0 panel capabilities (docs/06 R1/R6/R7/R9) ---

test("Diagnostic lists become readonly only when the Host advertises view-readonly-list", () => {
	const events = [{ at: 1_700_000_000_000, category: "delivery", message: "boom" }];
	const state = baseState({ recentRuntimeEvents: events });
	const oldHost = project(state, [threadRecord(0)]).root as unknown as AnyNode;
	for (const tab of ["threads", "events"]) {
		// 旧宿主会丢字段；扩展不主动发，避免把「不可选」伪装成可选项
		assert.equal(firstList(tabById(oldHost, tab).children)?.readonly, undefined, `${tab} must stay unchanged`);
	}
	const newHost = project(state, [threadRecord(0)], [], { readonlyList: true }).root as unknown as AnyNode;
	for (const tab of ["threads", "events"]) {
		assert.equal(firstList(tabById(newHost, tab).children)?.readonly, true, `${tab} is a read-only diagnostic list`);
	}
});

test("A panel-header Host gets the status line in the fixed slot, not the scroll body", () => {
	const projection = project(baseState(), [threadRecord(0)], [], { panelHeader: true });
	assert.equal(projection.header?.length, 1, "exactly one fixed header row");
	const header = projection.header?.[0] as unknown as AnyNode;
	assert.equal(header.type, "row");
	assert.ok(
		allText(header).some((line) => line.includes("已连接")),
		allText(header).join(" | "),
	);
	const root = projection.root as unknown as AnyNode;
	assert.equal(root.children?.[0]?.type, "tabs", "the scroll body starts with the tabs");
	assert.ok(
		!allText(root).some((line) => line.includes("已连接")),
		"the status line is not duplicated inside the scroll body",
	);
});

test("Broken threads surface an attention badge; healthy frames leave it absent", () => {
	const failed = [
		{ ...threadRecord(0), status: "failed", lastError: "boom" },
	] as unknown as TelegramTopicTargetRecord[];
	const failing = project(baseState(), failed, [], { panelBadge: true });
	assert.deepEqual(failing.badge, { tone: "attention", count: 1, label: "需要处理" });

	const probe = [{ ...threadRecord(0), status: "probe-required" }] as unknown as TelegramTopicTargetRecord[];
	assert.equal(
		project(baseState(), probe, [], { panelBadge: true }).badge?.count,
		1,
		"probe-required also needs the operator",
	);
	assert.equal(project(baseState(), [threadRecord(0)], [], { panelBadge: true }).badge, undefined);
	assert.equal(project(baseState(), failed).badge, undefined, "no badge without the capability");
});

test("Host-reported width raises text budgets but never below the narrowest-safe value", () => {
	const queue = [{ queueLane: "default" as const, summary: "x".repeat(300) }];
	const at = (width: number): number => {
		const projection = projectTelegramPanel(source(baseState(), [], queue), {
			nowMs: 1_700_000_000_000,
			capabilities: { ...NO_TELEGRAM_PANEL_CAPABILITIES, table: true },
			width,
		});
		const table = firstTable(tabById(projection.root as unknown as AnyNode, "queue").children);
		return String(table?.rows?.[0]?.cells.summary ?? "").length;
	};
	assert.equal(at(600), PANEL_SUMMARY_CHARS * 2, "600px doubles the budget, capped at 2×");
	assert.equal(at(300), PANEL_SUMMARY_CHARS, "the reference width keeps the measured budget");
	assert.equal(at(220), PANEL_SUMMARY_CHARS, "narrower than the reference keeps the safe budget");
});

test("Row fallback keeps every table out of the tree so an old Host never sees an unknown placeholder", () => {
	const root = project(
		baseState({ instanceSlot: "A", lockState: "active-here" }),
		[threadRecord(0)],
		[{ queueLane: "default", summary: "job" }],
	).root as unknown as AnyNode;
	assert.equal(findTable(root), undefined, "no table node without the capability");
	// 但内容不能因此丢失：链路键值仍以 row 组合出现，队列条目仍以行文本出现
	const overview = tabText(root, "overview");
	assert.ok(overview.includes("A"), overview.join(" | "));
	assert.ok(overview.includes("active-here"), overview.join(" | "));
	assert.ok(overview.includes("链路"), overview.join(" | "));
	const queue = tabText(root, "queue");
	assert.ok(
		queue.some((line) => line.includes("1. 默 · job")),
		queue.join(" | "),
	);
});

test("Table mode needs fewer nodes than the row fallback for the same state", () => {
	const queue = Array.from({ length: PANEL_MAX_QUEUE_ROWS }, (_, index) => ({
		queueLane: "default" as const,
		summary: `job-${index}`,
	}));
	const threads = Array.from({ length: PANEL_MAX_THREAD_ROWS }, (_, index) => threadRecord(index));
	const state = baseState({ queuedItems: queue.map((item) => ({ queueLane: item.queueLane })) });

	const rowMode = measureViewTree(project(state, threads, queue, false).root, VIEW_LIMITS).nodes;
	const tableMode = measureViewTree(project(state, threads, queue, true).root, VIEW_LIMITS).nodes;
	// 差值只来自链路表：6 个键值对，table 是 1 节点 + 6 行，row 组合是 6 个 row × 2 个 text。
	// 队列表两种模式等重（1 + 50），线程/事件恒为 list（各 1 节点）。
	assert.ok(tableMode < rowMode, `expected tables to be lighter: ${tableMode} vs row composition ${rowMode}`);
	assert.ok(tableMode < 200, `unexpectedly heavy table projection: ${tableMode}`);
});

// --- frame budget wiring ---

/**
 * The coalescer's own semantics — merge window, in-flight backpressure,
 * action-boundary flush, `stop()` settling waiters — are pinned in
 * `@pidesk/view-sdk` by `frame-scheduler.test.ts` (13 cases). What this suite
 * owns is the wiring: the panel is the thing feeding it, and a torn-down panel
 * must not leave a scheduler running.
 */

test("A burst of marks inside one window reaches the host as a single frame", async () => {
	const { sdk, sessions } = fakeSdk();
	const runtime = createTelegramPanelRuntime({
		source: source(baseState()),
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 0,
		frameIntervalMs: 250,
	});

	await runtime.open();
	await until(() => sessions[0].updates.length === 1, 500);
	for (let i = 0; i < 20; i += 1) runtime.refresh();
	await delay(60);

	assert.equal(sessions[0].updates.length, 1, "20 marks stayed inside the merge window");
	runtime.dispose();
});

test("Sustained marks deliver at the ≤4 frames/second ceiling", async () => {
	const { sdk, sessions } = fakeSdk();
	const runtime = createTelegramPanelRuntime({
		source: source(baseState()),
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 5,
	});

	await runtime.open();
	const start = Date.now();
	while (Date.now() - start < 1100) await delay(10);
	runtime.dispose();

	// 1.1 s at 250 ms/window + the immediate first frame
	assert.ok(sessions[0].updates.length <= 6, `expected ≤6 frames, delivered ${sessions[0].updates.length}`);
	assert.ok(sessions[0].updates.length >= 3, "the window still produced frames");
});

test("Re-opening after a dismiss resumes frame delivery", async () => {
	// 回归：调度器随 session 创建、随 teardown 停止。若复用已 stop 的调度器，
	// 关掉 tab 再连回来的面板会永远停在 open() 时的第一棵树。
	const { sdk, sessions } = fakeSdk();
	const runtime = createTelegramPanelRuntime({
		source: source(baseState()),
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 0,
		frameIntervalMs: 5,
	});

	await runtime.open();
	await until(() => sessions[0].updates.length > 0, 500);
	sessions[0].resolveClosed({ reason: "dismissed" });
	await until(() => !runtime.isOpen);

	assert.equal(await runtime.open(), true, "the panel re-opens on the same slot");
	await until(() => sessions[1].updates.length > 0, 500);
	runtime.dispose();
});

// --- resident lifecycle ---

/**
 * Fake SDK surface. The runtime takes the SDK by injection rather than importing
 * it, because an unresolvable SDK must degrade to "no Host" instead of failing
 * the bridge load — production resolves it
 * lazily in `desktop-panel-sdk.ts`. The
 * frame scheduler handed out below is the **real** SDK one: the panel's job is
 * wiring, so that is what these tests cover.
 */
type OpenPanelOptions = {
	panelId: string;
	title?: string;
	root: unknown;
	actions: unknown;
	onEvent: (event: { type: string; actionId?: string; width?: number; height?: number }) => void;
};

/** A fake host-side session plus the levers a test needs to drive it. */
interface FakeSession {
	updates: Array<{ root: unknown; actions: unknown; placementHint?: unknown }>;
	closed: boolean;
	emit: (event: { type: string; actionId?: string; width?: number; height?: number }) => void;
	resolveClosed: (payload: { reason?: string } | null) => void;
	session: TelegramPanelSession;
}

/** `capabilities` keeps the boolean shorthand for the many table-only cases. */
function fakeSdk(capabilities: boolean | Partial<TelegramPanelCapabilities> = false): {
	sdk: TelegramPanelSdk;
	opens: OpenPanelOptions[];
	sessions: FakeSession[];
	capabilityProbes: number;
} {
	const resolved =
		typeof capabilities === "boolean"
			? { ...NO_TELEGRAM_PANEL_CAPABILITIES, table: capabilities }
			: { ...NO_TELEGRAM_PANEL_CAPABILITIES, ...capabilities };
	const opens: OpenPanelOptions[] = [];
	const sessions: FakeSession[] = [];
	let capabilityProbes = 0;

	const sdk: TelegramPanelSdk = {
		connect: () => ({ dispose: () => undefined }),
		async capabilities() {
			capabilityProbes += 1;
			return resolved;
		},
		async openPanel(_client, options) {
			opens.push(options);
			let resolveClosed: (payload: { reason?: string } | null) => void = () => undefined;
			// Resolve from the outside so tests can drive `closed(reason)`.
			const closedPromise = new Promise<{ reason?: string } | null>((resolve) => {
				resolveClosed = resolve;
			});
			const record: FakeSession = {
				updates: [],
				closed: false,
				resolveClosed: (payload) => resolveClosed(payload),
				emit: (event) => options.onEvent(event),
				session: {
					update: (payload: { root: unknown; actions: unknown; placementHint?: unknown }) => {
						record.updates.push(payload);
					},
					close: () => {
						record.closed = true;
					},
					closed: closedPromise,
					createFrameScheduler: createViewFrameScheduler,
				},
			};
			sessions.push(record);
			return record.session;
		},
	};

	return {
		sdk,
		opens,
		sessions,
		/** Read after `open()`: the gates are asked once per open, never per frame. */
		get capabilityProbes() {
			return capabilityProbes;
		},
	};
}

test("Panel runtime does nothing without an SDK (TUI fallback)", async () => {
	let touched = false;
	const runtime = createTelegramPanelRuntime({
		source: source(baseState()),
		actions: {
			connect: () => {
				touched = true;
			},
			disconnect: () => {
				touched = true;
			},
			refresh: () => {
				touched = true;
			},
		},
		sdk: null,
		pollIntervalMs: 0,
	});

	assert.equal(await runtime.open(), false, "open() must report failure, not throw");
	assert.equal(runtime.isOpen, false);
	runtime.dispose();
	assert.equal(touched, false);
});

test("Panel runtime opens the right-side panel with a stable panelId", async () => {
	const { sdk, opens } = fakeSdk();
	const runtime = createTelegramPanelRuntime({
		source: source(baseState()),
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 0,
	});

	assert.equal(await runtime.open(), true);
	assert.equal(runtime.isOpen, true);
	assert.equal(opens.length, 1, "one open per open() call");
	assert.equal(opens[0].panelId, TELEGRAM_PANEL_ID, "identity must be stable across reconnects");
	assert.equal(opens[0].title, "Telegram");
	const root = opens[0].root as AnyNode;
	assert.equal(root.type, "column", "the projected tree is handed to the host");

	// 幂等：重复 open 复用同一个 panelId（同 connection 内新 open 顶替旧视图）
	assert.equal(await runtime.open(), true);
	assert.equal(opens.length, 2);
	assert.equal(opens[1].panelId, opens[0].panelId);

	runtime.dispose();
});

test("Panel runtime pushes a first frame before the merge window elapses", async () => {
	// 回归：宿主保留的是 open() 时的树。若首帧被合并窗口吸收，面板会空白
	// 直到下一个 poll tick —— 用超长窗口把「等窗口」和「立刻推」区分开。
	const { sdk, sessions } = fakeSdk();
	const runtime = createTelegramPanelRuntime({
		source: source(baseState()),
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 0, // 没有轮询兜底，首帧只能来自 open() 自身
		frameIntervalMs: 60_000,
	});

	assert.equal(await runtime.open(), true);
	await until(() => sessions[0].updates.length > 0, 500);
	assert.equal(sessions[0].updates.length, 1, "exactly one first frame, sent immediately");
	const first = sessions[0].updates[0]?.root as unknown as AnyNode;
	assert.equal(first.children?.length, 2, "the first frame carried a real projection: status row + tabs");
	assert.equal(tabsNode(first).tabs?.length, 4);
	runtime.dispose();
});

test("Panel runtime routes action events to handlers and flushes first", async () => {
	const { sdk, sessions } = fakeSdk();
	const seen: string[] = [];
	const runtime = createTelegramPanelRuntime({
		source: source(baseState()),
		actions: {
			connect: () => {
				seen.push("connect");
			},
			disconnect: () => {
				seen.push("disconnect");
			},
			refresh: () => {
				seen.push("refresh");
			},
		},
		sdk,
		pollIntervalMs: 0,
	});

	await runtime.open();
	sessions[0].emit({ type: "action", actionId: TELEGRAM_PANEL_ACTIONS.refresh });
	sessions[0].emit({ type: "action", actionId: TELEGRAM_PANEL_ACTIONS.disconnect });
	// 非动作事件与未知 action id 一律忽略
	sessions[0].emit({ type: "input", actionId: TELEGRAM_PANEL_ACTIONS.connect });
	sessions[0].emit({ type: "action", actionId: "tg:bogus" });
	await until(() => seen.length >= 2);

	assert.deepEqual(seen, ["refresh", "disconnect"]);
	runtime.dispose();
});

test("Panel runtime keeps the bridge alive when the tab is dismissed", async () => {
	const { sdk, sessions } = fakeSdk();
	let tornDown = false;
	const runtime = createTelegramPanelRuntime({
		source: source(baseState()),
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 0,
		recordRuntimeEvent: () => {
			tornDown = true;
		},
	});

	await runtime.open();
	const record = sessions[0];
	// 用户关掉 tab：reason 是普通 dismiss，不是 replaced/session → 不进 wait-rebind 分支
	record.resolveClosed({ reason: "dismissed" });
	await until(() => !runtime.isOpen);

	assert.equal(tornDown, false, "a plain dismiss is not an error worth logging");
	assert.equal(record.closed, false, "the runtime does not re-close a host-closed view");
	runtime.dispose();
});

test("Panel runtime logs closed(replaced) but never reconnects", async () => {
	const { sdk, sessions } = fakeSdk();
	const reasons: Array<Record<string, unknown> | undefined> = [];
	const runtime = createTelegramPanelRuntime({
		source: source(baseState()),
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 0,
		recordRuntimeEvent: (_category, _error, details) => {
			reasons.push(details);
		},
	});

	await runtime.open();
	const record = sessions[0];
	record.resolveClosed({ reason: "replaced" });
	await until(() => !runtime.isOpen);

	assert.deepEqual(reasons, [{ reason: "replaced" }]);
	assert.equal(sessions.length, 1, "replaced must not trigger an open() — that would ping-pong forever");
	runtime.dispose();
});

test("Panel runtime dispose() tears down the session and the poll timer", async () => {
	const { sdk, sessions } = fakeSdk();
	const runtime = createTelegramPanelRuntime({
		source: source(baseState()),
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 5,
	});

	await runtime.open();
	await until(() => sessions[0].updates.length > 0, 500);
	// 计时器仍在推进时 dispose 必须干净退出，不留悬挂 timer / 悬挂 Promise
	runtime.dispose();
	await delay(30);

	assert.equal(runtime.isOpen, false);
	assert.equal(sessions[0].closed, true, "the session is closed on dispose");
	assert.equal(await runtime.open(), false, "a disposed runtime stays closed");
});

// --- runtime: capability gating ---

const QUEUE_AND_THREADS = source(
	baseState({ queuedItems: [{ queueLane: "default" }] }),
	[threadRecord(0)],
	[{ queueLane: "default" as const, summary: "job" }],
);

test("Panel runtime asks the Host about capabilities before projecting", async () => {
	const fake = fakeSdk(true);
	const { sdk, opens } = fake;
	const runtime = createTelegramPanelRuntime({
		source: QUEUE_AND_THREADS,
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 0,
	});

	assert.equal(await runtime.open(), true);
	assert.equal(fake.capabilityProbes, 1, "asked once per open, and only the SDK knows what that asks");
	assert.ok(findTable(opens[0].root as AnyNode), "advertised host receives tables");
	runtime.dispose();
});

test("Capability probing degrades when a pre-0.5.0 SDK surface lacks supportsReadonlyList", () => {
	const client = {} as unknown as Parameters<typeof readTelegramPanelCapabilities>[1];
	const oldSurface = {
		supportsTable: () => true,
		supportsCapability: (_client: unknown, capability: string) => capability === "panel-header",
	} as unknown as TelegramPanelCapabilitySurface;
	// 升级前启动的会话会解析到旧模块图：缺 helper 不得抛错，回落到旧树
	assert.deepEqual(readTelegramPanelCapabilities(oldSurface, client), {
		table: true,
		readonlyList: false,
		panelBadge: false,
		panelHeader: true,
	});

	const newSurface = {
		...oldSurface,
		supportsReadonlyList: () => true,
	} as unknown as TelegramPanelCapabilitySurface;
	assert.equal(readTelegramPanelCapabilities(newSurface, client).readonlyList, true);
});

test("Panel runtime logs an open failure instead of leaving an unhandled rejection", async () => {
	const failures: Array<Record<string, unknown> | undefined> = [];
	const sdk: TelegramPanelSdk = {
		connect: () => ({}),
		async capabilities() {
			// 旧 SDK 缺 supportsReadonlyList 时的真实形态
			throw new TypeError("sdk.supportsReadonlyList is not a function");
		},
		async openPanel() {
			throw new Error("openPanel must not be reached after a capability failure");
		},
	};
	const runtime = createTelegramPanelRuntime({
		source: source(baseState()),
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 0,
		recordRuntimeEvent: (_category, _error, details) => {
			failures.push(details);
		},
	});

	assert.equal(await runtime.open(), false, "the fire-and-forget call resolves false");
	assert.deepEqual(failures, [{ phase: "open" }], "the failure is diagnosable");
	assert.equal(runtime.isOpen, false);
	runtime.dispose();
});

test("Panel frames keep one capability decision across open and updates", async () => {
	const fake = fakeSdk(true);
	const { sdk, opens, sessions } = fake;
	const runtime = createTelegramPanelRuntime({
		source: QUEUE_AND_THREADS,
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 0,
		frameIntervalMs: 5,
	});

	await runtime.open();
	await until(() => sessions[0].updates.length > 0);
	for (let i = 0; i < 5; i += 1) {
		runtime.refresh();
		await delay(12);
	}

	assert.ok(sessions[0].updates.length > 1, "several frames went out, not just the first");
	assert.ok(findTable(opens[0].root as AnyNode));
	for (const frame of sessions[0].updates) {
		assert.ok(findTable(frame.root as AnyNode), "every frame keeps the table decision");
	}
	assert.equal(fake.capabilityProbes, 1, "an open-time decision, not a per-frame probe");
	runtime.dispose();
});

test("Panel runtime keeps row composition for a Host without the capability", async () => {
	const { sdk, opens, sessions } = fakeSdk(false);
	const runtime = createTelegramPanelRuntime({
		source: QUEUE_AND_THREADS,
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 0,
		frameIntervalMs: 5,
	});

	await runtime.open();
	await until(() => sessions[0].updates.length > 0);
	assert.equal(findTable(opens[0].root as AnyNode), undefined, "initial tree");
	for (const frame of sessions[0].updates) {
		assert.equal(findTable(frame.root as AnyNode), undefined, "no frame ships a table");
	}
	runtime.dispose();
});

// --- runtime: 0.5.0 panel hints & layout ---

test("Panel frames carry the fixed header and badge, and clear the badge when the condition ends", async () => {
	let threads = [
		{ ...threadRecord(0), status: "failed", lastError: "boom" },
	] as unknown as TelegramTopicTargetRecord[];
	const liveSource: TelegramPanelSource = {
		getStatusState: () => baseState(),
		listThreads: () => threads,
		listQueuedItems: () => [],
	};
	const { sdk, sessions } = fakeSdk({ panelBadge: true, panelHeader: true });
	const runtime = createTelegramPanelRuntime({
		source: liveSource,
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 0,
		frameIntervalMs: 5,
	});

	await runtime.open();
	await until(() => sessions[0].updates.length > 0);
	const first = sessions[0].updates.at(-1) as unknown as AnyFrame;
	assert.ok(first.placementHint, "the first frame carries the hints");
	assert.equal(first.placementHint.panelId, TELEGRAM_PANEL_ID);
	assert.deepEqual(first.placementHint.panelBadge, { tone: "attention", count: 1, label: "需要处理" });
	assert.equal(first.placementHint.panelHeader?.length, 1);
	assert.equal(first.root.children?.[0]?.type, "tabs", "root has no duplicate status row");

	threads = [];
	runtime.refresh();
	await until(() => {
		const frame = sessions[0].updates.at(-1) as unknown as AnyFrame;
		return frame.placementHint !== undefined && frame.placementHint.panelBadge === undefined;
	});
	const cleared = (sessions[0].updates.at(-1) as unknown as AnyFrame).placementHint;
	assert.equal(cleared?.panelBadge, undefined, "a healthy frame clears the badge by omission");
	assert.ok(cleared?.panelHeader, "the fixed header stays");
	runtime.dispose();
});

test("An old Host receives no placementHint and keeps the status row in the body", async () => {
	const { sdk, sessions } = fakeSdk();
	const runtime = createTelegramPanelRuntime({
		source: QUEUE_AND_THREADS,
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 0,
		frameIntervalMs: 5,
	});

	await runtime.open();
	await until(() => sessions[0].updates.length > 0);
	for (const frame of sessions[0].updates) {
		assert.equal(frame.placementHint, undefined, "no cap-gated fields on an old Host");
		assert.equal((frame.root as AnyNode).children?.[0]?.type, "row", "the status row stays in the scroll body");
	}
	runtime.dispose();
});

test("Layout events re-project the panel with the reported width", async () => {
	const queue = [{ queueLane: "default" as const, summary: "x".repeat(300) }];
	const { sdk, sessions } = fakeSdk({ table: true });
	const runtime = createTelegramPanelRuntime({
		source: source(baseState(), [], queue),
		actions: { connect: () => undefined, disconnect: () => undefined, refresh: () => undefined },
		sdk,
		pollIntervalMs: 0,
		frameIntervalMs: 5,
	});

	const summaryLength = (): number => {
		const frame = sessions[0].updates.at(-1) as unknown as AnyFrame;
		const table = firstTable(tabById(frame.root, "queue").children);
		return String(table?.rows?.[0]?.cells.summary ?? "").length;
	};

	await runtime.open();
	await until(() => sessions[0].updates.length > 0);
	assert.equal(summaryLength(), PANEL_SUMMARY_CHARS, "no layout yet: the narrowest-safe budget");

	sessions[0].emit({ type: "layout", width: 600 });
	await until(() => summaryLength() > PANEL_SUMMARY_CHARS);
	assert.equal(summaryLength(), PANEL_SUMMARY_CHARS * 2, "the wider budget reached the next frame");
	runtime.dispose();
});

// --- runtime: session-bound actions ---

test("Connect action runs against the live session context", async () => {
	const { sdk, sessions } = fakeSdk();
	const liveContext = { sessionId: "current" };
	const seen: unknown[] = [];
	const runtime = createTelegramPanelRuntime({
		source: source(baseState()),
		getSessionContext: () => liveContext,
		actions: {
			connect: (context) => {
				seen.push(context);
			},
			disconnect: () => undefined,
			refresh: () => undefined,
		},
		sdk,
		pollIntervalMs: 0,
	});

	await runtime.open();
	sessions[0].emit({ type: "action", actionId: TELEGRAM_PANEL_ACTIONS.connect });
	await until(() => seen.length === 1);
	assert.deepEqual(seen, [liveContext], "the click acts on the context bound right now");
	runtime.dispose();
});

test("Connect action is refused while no session context is bound", async () => {
	const { sdk, sessions } = fakeSdk();
	let touched = false;
	const failures: unknown[] = [];
	const runtime = createTelegramPanelRuntime({
		source: source(baseState()),
		actions: {
			connect: () => {
				touched = true;
			},
			disconnect: () => undefined,
			refresh: () => undefined,
		},
		sdk,
		pollIntervalMs: 0,
		recordRuntimeEvent: (_category, error) => {
			failures.push(error);
		},
	});

	await runtime.open();
	sessions[0].emit({ type: "action", actionId: TELEGRAM_PANEL_ACTIONS.connect });
	await until(() => failures.length === 1);
	assert.equal(touched, false, "must not replay connect on a synthesized or stale context");
	assert.ok(failures[0] instanceof Error);
	runtime.dispose();
});
