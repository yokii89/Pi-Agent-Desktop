/**
 * PiDesk desktop panel lifecycle for the Telegram bridge
 * Zones: telegram, desktop, orchestration
 * Resident lifecycle: open on connect, poll on a frame
 * budget, tear down on dismiss / dispose.
 *
 * **The SDK is injected, not imported.** Every reach into
 * `@pidesk/view-sdk` lives in `desktop-panel-sdk.ts` and is soft-failing; a
 * static import here would take the whole bridge down with it when the package
 * cannot resolve. Callers pass the real functions from `@pidesk/view-sdk`, which
 * also keeps this module unit-testable with fakes.
 *
 * This module owns the refresh cadence over bridge state and nothing else: the
 * merge window comes from the SDK's `createViewFrameScheduler` and the
 * capability gates from its `hello` advertisement.
 *
 * Headless pi gets `open() === false` and callers keep the TUI path.
 */

import type { ViewFrameScheduler, ViewPlacementHint } from "@pidesk/view-sdk";
import {
	isTelegramPanelAction,
	NO_TELEGRAM_PANEL_CAPABILITIES,
	projectTelegramPanel,
	TELEGRAM_PANEL_ID,
	TELEGRAM_PANEL_TITLE,
	type TelegramPanelAction,
	type TelegramPanelCapabilities,
	type TelegramPanelProjection,
	type TelegramPanelSource,
} from "./desktop-view.ts";

/** Panel refresh cadence. Slower than the frame budget — state is pull-only. */
export const PANEL_POLL_INTERVAL_MS = 1000;

/**
 * The slice of `@pidesk/view-sdk` this runtime needs.
 * Every member is asynchronous and soft-failing: `connect` resolves `null` when
 * no Host is present, `openPanel` resolves `null` when the Host is too old, and
 * `capabilities` answers all-false rather than guessing.
 */
export interface TelegramPanelSdk {
	connect: () => TelegramPanelClient | null | Promise<TelegramPanelClient | null>;
	/**
	 * Host `hello` gates, resolved once per open. A missing advertisement or a
	 * handshake that never landed resolves every flag to `false` — the projection
	 * then keeps its old-Host composition instead of shipping fields the Host
	 * would silently drop. Capability names stay inside the SDK.
	 */
	capabilities: (client: TelegramPanelClient) => Promise<TelegramPanelCapabilities>;
	openPanel: (
		client: TelegramPanelClient,
		options: {
			panelId: string;
			title?: string;
			root: unknown;
			actions: unknown;
			/** `layout` carries the content-box size (docs/06 R5); other events ignore it. */
			onEvent: (event: { type: string; actionId?: string; width?: number; height?: number }) => void;
		},
	) => Promise<TelegramPanelSession | null>;
}

/** Minimal client surface — structurally compatible with `DesktopViewClient`. */
export interface TelegramPanelClient {
	dispose?: () => void;
}

/** Minimal session surface — structurally compatible with `LiveViewSession`. */
export interface TelegramPanelSession {
	update: (payload: { root: unknown; actions: unknown; placementHint?: unknown }) => void;
	close: () => void;
	closed: Promise<{ reason?: string } | null>;
	/**
	 * The SDK's frame coalescer for this panel: the merge window, the
	 * action-boundary flush and the in-flight backpressure are SDK semantics, and
	 * the adapter hands out its factory because it is the one module that resolved
	 * the SDK. Lives and dies with the session that owns it.
	 */
	createFrameScheduler: (options: { intervalMs?: number; send: () => Promise<void> | void }) => ViewFrameScheduler;
}

/**
 * Actions the panel surfaces; wired by the extension to real command effects.
 * `connect` receives the live session context so a panel click cannot act on a
 * context replaced underneath it.
 */
export interface TelegramPanelActionHandlers<TContext> {
	connect: (context: TContext) => void | Promise<void>;
	disconnect: () => void | Promise<void>;
	refresh: () => void | Promise<void>;
}

export interface TelegramPanelRuntimeOptions<TContext = unknown> {
	source: TelegramPanelSource;
	actions: TelegramPanelActionHandlers<TContext>;
	/**
	 * Current pi session context. Panel actions are session-bound: a resolved
	 * `undefined` means no context is bound yet, so the action is refused rather
	 * than replayed against a stale one.
	 */
	getSessionContext?: () => TContext | undefined;
	/** Injected SDK surface. Absent = no desktop host, every call is a no-op. */
	sdk?: TelegramPanelSdk | null;
	/** Reuse an existing connection; otherwise one is created lazily. */
	client?: TelegramPanelClient | null;
	/** Poll interval; default 1000ms. Set 0 to disable polling (tests). */
	pollIntervalMs?: number;
	/** Frame merge interval; default 250ms. */
	frameIntervalMs?: number;
	recordRuntimeEvent?: (category: string, error: unknown, details?: Record<string, unknown>) => void;
}

export interface TelegramPanelRuntime {
	/** Idempotent: re-opening replaces the same `panelId` in place. */
	open(): Promise<boolean>;
	/** User closed the tab — tear down the view, leave the bridge alone (E6). */
	close(): void;
	/** Nudge the panel to re-render now (used after an action). */
	refresh(): void;
	dispose(): void;
	readonly isOpen: boolean;
}

/**
 * Own a resident Telegram panel for one pi session.
 *
 * - `open()` opens / re-opens the panel; the same `panelId` replaces in place.
 * - polling keeps the projection fresh, coalesced by the SDK frame scheduler.
 * - dismissing the tab closes the view only — the bridge keeps running, and a
 *   later `open()` gets a fresh scheduler (a stopped one is never revived).
 * - `dispose()` clears the poll timer, the frame scheduler, and the session.
 */
export function createTelegramPanelRuntime<TContext = unknown>(
	options: TelegramPanelRuntimeOptions<TContext>,
): TelegramPanelRuntime {
	const pollIntervalMs = options.pollIntervalMs ?? PANEL_POLL_INTERVAL_MS;
	const sdk = options.sdk ?? null;
	const ownsClient = options.client === undefined;
	let client: TelegramPanelClient | null = options.client ?? null;
	let session: TelegramPanelSession | null = null;
	/** Owned by the SDK, created with the session it feeds and stopped with it. */
	let scheduler: ViewFrameScheduler | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let disposed = false;
	/** Serializes overlapping open() calls (action spam / reconnect races). */
	let opening: Promise<boolean> | null = null;
	/** Refreshed per open from the Host `hello`; decides which optional fields may be sent. */
	let capabilities: TelegramPanelCapabilities = NO_TELEGRAM_PANEL_CAPABILITIES;
	/** Last content-box width from a `layout` event; undefined before the first one / on old Hosts. */
	let layoutWidth: number | undefined;

	function placementHintFor(projection: TelegramPanelProjection): ViewPlacementHint | undefined {
		if (!capabilities.panelBadge && !capabilities.panelHeader) return undefined;
		const hint: ViewPlacementHint = { panelId: TELEGRAM_PANEL_ID };
		// 整体替换语义：条件消失时必须不带键，否则旧徽章 / 旧头部会留在宿主上
		if (capabilities.panelBadge && projection.badge) hint.panelBadge = projection.badge;
		if (capabilities.panelHeader && projection.header) hint.panelHeader = projection.header;
		return hint;
	}

	/** Re-reads live bridge state: the scheduler never buffers a tree, so a burst of marks still ships the newest panel. */
	function sendFrame(): void {
		if (!session) return;
		const projection = projectTelegramPanel(options.source, {
			nowMs: Date.now(),
			capabilities,
			width: layoutWidth,
		});
		const placementHint = placementHintFor(projection);
		session.update({
			root: projection.root,
			actions: projection.actions,
			...(placementHint ? { placementHint } : {}),
		});
	}

	async function ensureClient(): Promise<TelegramPanelClient | null> {
		if (client) return client;
		if (disposed || !sdk) return null;
		const connected = await sdk.connect();
		// dispose() 可能在 await 期间发生：不得留下无人回收的连接
		if (disposed) {
			connected?.dispose?.();
			return null;
		}
		client = connected;
		return client;
	}

	function pushFrame(): void {
		if (disposed) return;
		scheduler?.markDirty();
	}

	function startPolling(): void {
		if (pollIntervalMs <= 0 || pollTimer) return;
		pollTimer = setInterval(pushFrame, pollIntervalMs);
		pollTimer.unref?.();
	}

	function stopPolling(): void {
		if (!pollTimer) return;
		clearInterval(pollTimer);
		pollTimer = null;
	}

	async function handleAction(actionId: TelegramPanelAction): Promise<void> {
		// 动作边界不得丢：动作前先提交未发送的本地状态
		await scheduler?.flush();
		try {
			if (actionId === "tg:connect") {
				// 面板动作绑定当前会话：没有活上下文时拒绝，绝不拿旧 ctx 重放
				const context = options.getSessionContext?.();
				if (context === undefined) {
					throw new Error("no live session context");
				}
				await options.actions.connect(context);
			} else if (actionId === "tg:disconnect") {
				await options.actions.disconnect();
			} else {
				await options.actions.refresh();
			}
		} catch (error) {
			options.recordRuntimeEvent?.("desktop-panel", error, { phase: "action", actionId });
		}
		// 动作完成后立刻反映结果（不等下一个节流窗口）
		pushFrame();
	}

	/**
	 * Actions run one at a time, in arrival order. A double-click on 「刷新」 must
	 * not interleave with a 「断开」, and both must land after their own
	 * action-boundary flush.
	 */
	let actionQueue: Promise<void> = Promise.resolve();
	function enqueueAction(actionId: TelegramPanelAction): void {
		actionQueue = actionQueue.then(() => handleAction(actionId));
	}

	async function doOpen(): Promise<boolean> {
		if (disposed || !sdk) return false;
		const target = await ensureClient();
		if (!target) return false;

		capabilities = await sdk.capabilities(target);
		const initial = projectTelegramPanel(options.source, {
			nowMs: Date.now(),
			capabilities,
			width: layoutWidth,
		});
		const opened = await sdk.openPanel(target, {
			panelId: TELEGRAM_PANEL_ID,
			title: TELEGRAM_PANEL_TITLE,
			root: initial.root,
			actions: initial.actions,
			onEvent(event) {
				if (event.type === "layout") {
					// Host 已去抖（150ms）；这里只记宽度并标脏，不额外节流
					if (event.width !== undefined && Number.isFinite(event.width) && event.width > 0) {
						layoutWidth = event.width;
						pushFrame();
					}
					return;
				}
				if (event.type !== "action") return;
				if (event.actionId && isTelegramPanelAction(event.actionId)) enqueueAction(event.actionId);
			},
		});

		if (!opened) {
			// Host 不支持 panel / 连接失败 → 回落 TUI，不报错
			return false;
		}

		session = opened;
		scheduler = opened.createFrameScheduler({
			intervalMs: options.frameIntervalMs,
			send: sendFrame,
		});
		startPolling();
		// 首帧必须立刻推：宿主保留的是 open() 时的树，节流窗口内不会有第二次推送，
		// 否则面板要等一个 poll 周期才有内容。
		void scheduler.flushNow();
		void opened.closed.then((payload) => {
			if (session !== opened) return;
			// The Host already tore the view down: stop observing it, but never
			// `close()` a closed view (E6).
			stopPolling();
			scheduler?.stop();
			scheduler = null;
			session = null;
			layoutWidth = undefined;
			const reason = payload?.reason;
			if (reason === "replaced" || reason === "session") {
				// replaced: 由新 owner 占用，不重连（防无限互相抢占）
				// session: 等会话重绑，本轮交给调用方重新 open
				options.recordRuntimeEvent?.("desktop-panel", new Error(`panel closed: ${reason}`), { reason });
			}
		});
		return true;
	}

	function closePanel(): void {
		stopPolling();
		scheduler?.stop();
		scheduler = null;
		const current = session;
		session = null;
		layoutWidth = undefined;
		current?.close();
	}

	return {
		async open() {
			if (disposed) return false;
			if (opening) return opening;
			// 会话启动处是 fire-and-forget：失败必须落成可诊断事件，不能变成未处理拒绝
			opening = doOpen()
				.catch((error) => {
					options.recordRuntimeEvent?.("desktop-panel", error, { phase: "open" });
					return false;
				})
				.finally(() => {
					opening = null;
				});
			return opening;
		},

		close() {
			closePanel();
		},

		refresh() {
			pushFrame();
		},

		dispose() {
			if (disposed) return;
			disposed = true;
			closePanel();
			if (ownsClient) {
				client?.dispose?.();
			}
			client = null;
		},

		get isOpen() {
			return session !== null;
		},
	};
}
