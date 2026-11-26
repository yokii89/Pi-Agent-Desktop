/**
 * Desktop (PiDesk) view paths for yoki-plan via @pidesk/view-sdk.
 *
 * Surfaces:
 * 1. Post-plan next-step picker — widget above the input bar, single row of action buttons
 * 2. Plan-mode chip registration — composer access-mode slot
 *
 * Resident access-mode lifecycle (re-register on closed, backoff, shutdown)
 * is built into the SDK (`superviseAccessMode` / process client). This module
 * only supplies the registration descriptor and one-shot helpers.
 *
 * Returns `null` when no desktop host is present so callers fall back to
 * TUI / dialog primitives.
 */

import {
	ACCESS_MODE_ACTIONS,
	type AccessModeContributionInput,
	type AccessModeHandle,
	connectDesktopView,
	type DesktopViewClient,
	defineAccessMode,
	type LiveViewSession,
	// 必须是**本地导入绑定**：`export { x as readContributionKey } from …` 只建立
	// 对外 re-export，不会让 `readContributionKey` 在本模块可见——文件内的两个调用
	// 点因此抛 ReferenceError，并被 registerPlanModeOnDesktop 的 catch-all 吞成
	// "没有桌面宿主"。这是 consumer 4 那组红测的真实根因。
	resolveContributionKey as readContributionKey,
	registerAccessMode,
	type SlotSupervisor,
	superviseAccessMode,
	type ViewNode,
	type ViewSessionEvent,
	type ViewSpec,
} from "@pidesk/view-sdk";
import type { AgentWorkMode } from "./bridge.ts";
import type { PlanStep } from "./extract.ts";
import pkg from "./package.json";
import {
	POST_PLAN_OPTION_VALUES,
	POST_PLAN_OPTIONS,
	type PostPlanChoice,
	postPlanChoiceFromValue,
} from "./post-plan-options.ts";

export type { AccessModeHandle, SlotSupervisor };
export { postPlanChoiceFromValue };

export interface DesktopViewDeps {
	connect?: typeof connectDesktopView;
}

const OPTION_VALUE_BY_INDEX = POST_PLAN_OPTION_VALUES;

/** Compact labels for the single-row widget (full labels live in POST_PLAN_OPTIONS). */
const SHORT_OPTION_LABELS = ["Execute now", "New session", "Keep exploring", "Save only"] as const;

export function buildPostPlanSpec(steps: readonly PlanStep[]): ViewSpec {
	const buttons = SHORT_OPTION_LABELS.map((label, i) => ({
		type: "button" as const,
		id: OPTION_VALUE_BY_INDEX[i] ?? `opt:${i}`,
		label,
		variant: i === 0 ? ("primary" as const) : undefined,
	}));

	return {
		title: "Plan ready",
		placement: "widget",
		placementHint: { side: "aboveEditor" },
		root: {
			type: "column",
			gap: 8,
			children: [
				{ type: "text", content: `${steps.length} steps — what next?`, variant: "caption" },
				{ type: "row", gap: 8, children: buttons },
			],
		},
	};
}

/**
 * Present the post-plan picker on the desktop host (input-bar widget).
 * Returns the chosen option, or `undefined` when dismissed / no host.
 * `null` means no desktop host (caller should fall back).
 */
export async function presentPostPlanOnDesktop(
	steps: readonly PlanStep[],
	opts?: { deps?: DesktopViewDeps },
): Promise<PostPlanChoice | null | undefined> {
	const connect = opts?.deps?.connect ?? connectDesktopView;
	let client: DesktopViewClient | null = null;
	try {
		client = connect();
	} catch {
		return null;
	}
	if (!client) return null;

	try {
		const result = await client.open(buildPostPlanSpec(steps), {
			onEvent: (event, session) => {
				if (event.type === "action") {
					// Button ViewNodes fire action with actionId = button id (opt:N).
					const choiceVal = postPlanChoiceFromValue(event.actionId);
					if (choiceVal) {
						session.close({ action: "confirm", values: { choice: event.actionId } });
						return;
					}
					if (event.actionId === "cancel") {
						session.close({ action: "cancel", values: {} });
					}
				}
			},
		});

		if (!result) return undefined;
		if (result.action === "cancel") return undefined;
		return postPlanChoiceFromValue(result.values.choice) ?? POST_PLAN_OPTIONS[2];
	} catch {
		return null;
	} finally {
		client.dispose();
	}
}

/** Test helper: expose post-plan tree without opening a socket. */
export function buildPostPlanSpecForTest(steps: readonly PlanStep[]): ViewSpec {
	return buildPostPlanSpec(steps);
}

export const PLAN_MODE_DETAIL = "只读：edit/write 已禁用";

/**
 * Host 注入的 contributionKey 映射。
 * 实现已下沉到 SDK；此处保留同名 re-export，
 * 使既有调用点与测试无需改动。
 */
export { resolveContributionKey as readContributionKey } from "@pidesk/view-sdk";

/**
 * Live chip descriptor, projected from the `pidesk.contributes.accessModes[]`
 * entry in package.json — the same entry the Host's Catalog scanner reads, so
 * the Catalog row and the live registration cannot drift. `defineAccessMode`
 * validates + freezes it and drops `activation`.
 */
export const PLAN_MODE = defineAccessMode(pkg.pidesk.contributes.accessModes[0] as AccessModeContributionInput);

/** Chip detail line driven by controller truth. */
export function planModeDetailFor(mode: AgentWorkMode): string | undefined {
	return mode === "plan" ? PLAN_MODE_DETAIL : undefined;
}

/** Injection points for tests. */
export interface PlanDesktopModeDeps {
	connect?: typeof connectDesktopView;
	register?: typeof registerAccessMode;
	/**
	 * Reuse an existing connection (process-level supervisor passes its client).
	 * When injected, the caller owns the client — `dispose()` closes only the
	 * registration, and failures do not dispose it.
	 */
	client?: DesktopViewClient;
	/** Desktop activation requests (user clicked a mode row in PiDesk). */
	onAction?: (action: "activate" | "deactivate") => void;
	/** Override the access-mode tryRegister path (tests). */
	tryRegister?: Parameters<typeof superviseAccessMode>[0]["tryRegister"];
	/** Explicit Catalog contribution key; defaults to env lookup. */
	contributionKey?: string;
}

/** Live access-mode registration wrapper (one-shot path; prefer the supervisor). */
export interface PlanDesktopMode {
	handle: AccessModeHandle;
	/** Push controller state to the desktop chip (also fired by TUI toggles). */
	sync(mode: AgentWorkMode): void;
	/**
	 * Close the registration; also disposes the connection when this call
	 * created it. The registration view itself may outlive `dispose` by a
	 * tick — the Host cleans up either way.
	 */
	dispose(): void;
}

function routeAccessModeEvent(
	event: ViewSessionEvent,
	_session: LiveViewSession,
	onAction: PlanDesktopModeDeps["onAction"],
): void {
	if (event.type !== "action") return;
	if (event.actionId === ACCESS_MODE_ACTIONS.activate) onAction?.("activate");
	else if (event.actionId === ACCESS_MODE_ACTIONS.deactivate) onAction?.("deactivate");
}

/**
 * One-shot registration (no lifecycle). Prefer `createPlanModeSupervisor`
 * for the resident chip — re-registration / backoff / shutdown live in the SDK.
 *
 * Resolves `null` (never throws) when there is no desktop host, the host is
 * too old (no `access-mode` slot), the slot is refused, or the connection
 * fails — callers keep the `/plan` command + shortcut path in that case.
 */
export async function registerPlanModeOnDesktop(opts?: PlanDesktopModeDeps): Promise<PlanDesktopMode | null> {
	const connect = opts?.connect ?? connectDesktopView;
	const ownsClient = opts?.client === undefined;
	let client: DesktopViewClient | null = null;
	if (opts?.client) {
		client = opts.client;
	} else {
		try {
			client = connect();
		} catch {
			return null;
		}
	}
	if (!client) return null;

	const register = opts?.register ?? registerAccessMode;
	try {
		const handle = await register(client, {
			...PLAN_MODE,
			contributionKey: opts?.contributionKey ?? readContributionKey(PLAN_MODE.id),
			onEvent: (event, session) => routeAccessModeEvent(event, session, opts?.onAction),
		});
		if (!handle) {
			if (ownsClient) client.dispose();
			return null;
		}
		return {
			handle,
			sync: (mode) => {
				handle.setActive(mode === "plan", planModeDetailFor(mode));
			},
			dispose: () => {
				handle.session.close();
				// close 先于 dispose 写出；tiny delay 让 close 信封先落盘（尽力而为）
				if (ownsClient) {
					const c = client;
					const t = setTimeout(() => c?.dispose(), 25);
					t.unref?.();
				}
			},
		};
	} catch {
		if (ownsClient) client.dispose();
		return null;
	}
}

export interface PlanModeSupervisorDeps extends PlanDesktopModeDeps {
	/** Push controller truth after every successful (re)registration. */
	getMode: () => AgentWorkMode;
}

/**
 * Process-level access-mode supervisor for plan mode.
 * Lifecycle is SDK-built-in: re-register on `closed`, bounded backoff on
 * transient failures, `stop()` on session_shutdown.
 */
export function createPlanModeSupervisor(opts: PlanModeSupervisorDeps): SlotSupervisor<AccessModeHandle> {
	return superviseAccessMode({
		client: opts.client,
		connect:
			opts.connect ??
			(() => {
				try {
					return connectDesktopView();
				} catch {
					return null;
				}
			}),
		registration: {
			...PLAN_MODE,
			contributionKey: opts.contributionKey ?? readContributionKey(PLAN_MODE.id),
		},
		onActivate: () => opts.onAction?.("activate"),
		onDeactivate: () => opts.onAction?.("deactivate"),
		onRegistered: (handle) => {
			const mode = opts.getMode();
			handle.setActive(mode === "plan", planModeDetailFor(mode));
		},
		tryRegister: opts.tryRegister,
	});
}

/** Narrow ViewNode helper for tests. */
export function asColumn(node: ViewNode): Extract<ViewNode, { type: "column" }> {
	if (node.type !== "column") throw new Error("expected column");
	return node;
}

/** Narrow ViewNode helper for tests. */
export function asRow(node: ViewNode): Extract<ViewNode, { type: "row" }> {
	if (node.type !== "row") throw new Error("expected row");
	return node;
}
