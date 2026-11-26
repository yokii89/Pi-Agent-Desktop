/**
 * Plan/edit mode state machine: enable/disable tools, status chip, persist.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentWorkMode } from "./bridge.ts";
import { getNormalModeTools, getPlanModeTools } from "./tools.ts";

export const PLAN_ENTRY_CUSTOM_TYPE = "yoki-plan";
export const PLAN_STATUS_KEY = "yoki-plan";

/** Plain-data handoff for option 2 → `/plan new` (survives event→command boundary). */
export interface PendingNewSessionKickoff {
	/** Project-relative plan path. */
	planPath: string;
	absolutePath: string;
	stepsText: string;
	kickoff: string;
	seedContent: string;
	/** Parent session file path for newSession({ parentSession }). */
	parentSession?: string;
}

export interface PlanModeState {
	mode: AgentWorkMode;
	/** Snapshot of active tools before first entry into plan (restored on edit). */
	toolsBeforePlan?: string[];
	/** Fingerprint of last prompted/archived plan (dedup post-plan TUI). */
	lastPlanFingerprint?: string;
	/** Relative path of last written plan artifact. */
	lastPlanPath?: string;
}

/** Integration hooks fired after every mode transition (enter/exit/restore). */
export interface PlanModeControllerHooks {
	/** Notify desktop chip / status surfaces once `mode` has settled. */
	onModeChange?: (mode: AgentWorkMode) => void;
}

export interface PlanModeController {
	getMode(): AgentWorkMode;
	getToolsBeforePlan(): string[] | undefined;
	getLastPlanFingerprint(): string | undefined;
	getLastPlanPath(): string | undefined;
	/** Record fingerprint only (explore / Esc — no path). */
	setLastPlanFingerprint(fingerprint: string): void;
	/** Record fingerprint + path after write (execute / save only). */
	setLastPlan(fingerprint: string, path: string): void;
	/** Stash kickoff for `/plan new` (in-memory; not session-persisted). */
	setPendingNewSession(pending: PendingNewSessionKickoff): void;
	/** Peek pending kickoff without clearing. */
	getPendingNewSession(): PendingNewSessionKickoff | undefined;
	/** Take and clear pending kickoff. */
	takePendingNewSession(): PendingNewSessionKickoff | undefined;
	/** Enter plan mode. Returns true if mode changed. */
	enterPlan(ctx: ExtensionContext): boolean;
	/** Enter edit mode. Returns true if mode changed. */
	enterEdit(ctx: ExtensionContext): boolean;
	/** Toggle; returns new mode. Refuses (notify) when agent is busy. */
	toggle(ctx: ExtensionContext): AgentWorkMode;
	/** Explicit set from /plan on|off. */
	setMode(ctx: ExtensionContext, mode: AgentWorkMode): AgentWorkMode;
	/** Restore from session entry / flag without notifying. */
	restore(ctx: ExtensionContext, state: Partial<PlanModeState>): void;
	updateStatus(ctx: ExtensionContext): void;
	persist(): void;
}

export function createPlanModeController(pi: ExtensionAPI, hooks?: PlanModeControllerHooks): PlanModeController {
	let mode: AgentWorkMode = "edit";
	let toolsBeforePlan: string[] | undefined;
	let lastPlanFingerprint: string | undefined;
	let lastPlanPath: string | undefined;
	/** In-memory only — bridges event-handler option 2 to `/plan new` command ctx. */
	let pendingNewSession: PendingNewSessionKickoff | undefined;

	function enablePlanModeTools(): void {
		if (toolsBeforePlan === undefined) {
			toolsBeforePlan = pi.getActiveTools();
		}
		pi.setActiveTools(getPlanModeTools(toolsBeforePlan));
	}

	function restoreEditModeTools(): void {
		pi.setActiveTools(toolsBeforePlan ?? getNormalModeTools(pi.getActiveTools()));
		toolsBeforePlan = undefined;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		if (mode === "plan") {
			ctx.ui.setStatus(PLAN_STATUS_KEY, ctx.ui.theme.fg("warning", "plan"));
		} else {
			ctx.ui.setStatus(PLAN_STATUS_KEY, undefined);
		}
	}

	function persist(): void {
		pi.appendEntry(PLAN_ENTRY_CUSTOM_TYPE, {
			mode,
			toolsBeforePlan,
			lastPlanFingerprint,
			lastPlanPath,
		} satisfies PlanModeState);
	}

	function setLastPlanFingerprint(fingerprint: string): void {
		lastPlanFingerprint = fingerprint;
		persist();
	}

	function setLastPlan(fingerprint: string, path: string): void {
		lastPlanFingerprint = fingerprint;
		lastPlanPath = path;
		persist();
	}

	function setPendingNewSession(pending: PendingNewSessionKickoff): void {
		pendingNewSession = pending;
	}

	function getPendingNewSession(): PendingNewSessionKickoff | undefined {
		return pendingNewSession;
	}

	function takePendingNewSession(): PendingNewSessionKickoff | undefined {
		const pending = pendingNewSession;
		pendingNewSession = undefined;
		return pending;
	}

	function enterPlan(ctx: ExtensionContext): boolean {
		if (mode === "plan") return false;
		mode = "plan";
		enablePlanModeTools();
		updateStatus(ctx);
		persist();
		hooks?.onModeChange?.(mode);
		return true;
	}

	function enterEdit(ctx: ExtensionContext): boolean {
		if (mode === "edit") return false;
		mode = "edit";
		restoreEditModeTools();
		updateStatus(ctx);
		persist();
		hooks?.onModeChange?.(mode);
		return true;
	}

	function setMode(ctx: ExtensionContext, next: AgentWorkMode): AgentWorkMode {
		if (next === "plan") {
			if (enterPlan(ctx)) {
				ctx.ui.notify("Plan mode enabled. Write tools disabled.", "info");
			}
		} else if (enterEdit(ctx)) {
			ctx.ui.notify("Edit mode restored. Full tool access.", "info");
		}
		return mode;
	}

	function toggle(ctx: ExtensionContext): AgentWorkMode {
		if (!ctx.isIdle()) {
			ctx.ui.notify("Cannot toggle plan mode while the agent is busy.", "warning");
			return mode;
		}
		return setMode(ctx, mode === "plan" ? "edit" : "plan");
	}

	function restore(ctx: ExtensionContext, state: Partial<PlanModeState>): void {
		if (state.toolsBeforePlan) {
			toolsBeforePlan = state.toolsBeforePlan;
		}
		if (state.lastPlanFingerprint !== undefined) {
			lastPlanFingerprint = state.lastPlanFingerprint;
		}
		if (state.lastPlanPath !== undefined) {
			lastPlanPath = state.lastPlanPath;
		}
		if (state.mode === "plan") {
			mode = "plan";
			enablePlanModeTools();
		} else if (state.mode === "edit") {
			mode = "edit";
			// Only restore tools if we had been in plan (snapshot present).
			if (toolsBeforePlan !== undefined) {
				restoreEditModeTools();
			}
		}
		updateStatus(ctx);
		hooks?.onModeChange?.(mode);
	}

	return {
		getMode: () => mode,
		getToolsBeforePlan: () => toolsBeforePlan,
		getLastPlanFingerprint: () => lastPlanFingerprint,
		getLastPlanPath: () => lastPlanPath,
		setLastPlanFingerprint,
		setLastPlan,
		setPendingNewSession,
		getPendingNewSession,
		takePendingNewSession,
		enterPlan,
		enterEdit,
		toggle,
		setMode,
		restore,
		updateStatus,
		persist,
	};
}
