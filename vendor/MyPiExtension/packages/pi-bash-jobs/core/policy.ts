/**
 * The wait state machine (doc 129 §4, §5.3). Pure: given elapsed/idle/announced state and
 * the configured budgets it says what the *still blocking* `finish` call must do next.
 *
 * The one invariant this file exists to protect: **nothing here may yield `kill` unless the
 * caller explicitly asked for a timeout.** A wrong `detach` costs one background job; a wrong
 * `kill` closes the dev server the user was told would stay up.
 *
 * `long` is the second, narrower invariant (doc 06 §7): a `long` call that finishes inside its
 * grace window is an ordinary blocking call. Returning eagerly for `pnpm typecheck` would file a
 * job, arm a wake and draw a background badge for a command that was over in 20 seconds.
 * Only the part that outlives the window becomes a background job.
 */

import type { DetachReason, JobMode } from "../types.ts";

export interface PolicyConfig {
	finishSoftBudgetSec: number;
	idleWarnSec: number;
	idleDetachSec: number;
	explicitTimeoutKills: boolean;
	// Optional so a caller-built config (and every test fixture) keeps working without the new knob.
	/** How long `mode:long` blocks before it really hands the process to the background. */
	longGraceSec?: number;
}

export interface WaitInput {
	mode: JobMode;
	/** Wall clock since spawn. */
	elapsedMs: number;
	/** Time since the last output chunk. */
	idleMs: number;
	/** Whether the "silent for a while" notice already fired for this call. */
	idleWarned: boolean;
	/** Pi's native `timeout` argument, in seconds. */
	explicitTimeoutSec?: number;
	config: PolicyConfig;
}

export type WaitAction =
	| { action: "wait" }
	| { action: "notify"; kind: "idle"; idleSec: number }
	| { action: "detach"; reason: DetachReason }
	| { action: "kill"; reason: "timeout" };

/** Used when a `PolicyConfig` was built by hand without the knob; mirrors `DEFAULT_CONFIG`. */
export const LONG_GRACE_SEC = 180;

/** Priority 1–2 of doc 129 §5.1: explicit arguments beat classification. */
export interface ModeInput {
	requestedMode?: JobMode;
	explicitTimeoutSec?: number;
	classified: { mode: JobMode; reason: string };
	/** True when the caller wrote `timeout` (0/undefined means "not given"). */
	hasExplicitTimeout: boolean;
}

export interface ModeDecision {
	mode: JobMode;
	reason: string;
}

/**
 * The caller's `mode` wins even over `timeout`: if a model says "detach this and kill it in
 * 30s", the detach receipt must come back first and the timeout applies to the background job.
 */
export function resolveMode(input: ModeInput): ModeDecision {
	if (input.requestedMode) {
		return { mode: input.requestedMode, reason: `mode=${input.requestedMode} (explicit)` };
	}
	if (input.hasExplicitTimeout) {
		return { mode: "finish", reason: `timeout=${input.explicitTimeoutSec}s (explicit)` };
	}
	return { mode: input.classified.mode, reason: input.classified.reason };
}

/**
 * One tick. Order matters and mirrors doc 129 §5.3:
 *
 * 1. `long` grace — inside the window this is still a blocking call (doc 06 §7);
 * 2. explicit timeout (only if it kills) — the caller asked for a hard wall clock;
 * 3. idle-detach — the silence path, which is what catches a hung piped command in ~3 min;
 * 4. budget — the兜底 for scripts whose name says nothing (`node download.js`);
 * 5. idle warning — one shot, does not interrupt.
 */
export function nextWaitAction(input: WaitInput): WaitAction {
	const { config } = input;
	if (input.mode === "long") {
		const graceMs = (config.longGraceSec ?? LONG_GRACE_SEC) * 1000;
		// `longGraceSec: 0` (config floor) means "detach right away" — the escape hatch back to the
		// old behaviour. A settle inside the window falls out of the caller's loop instead.
		if (graceMs <= 0 || input.elapsedMs >= graceMs) return { action: "detach", reason: "grace" };
		return { action: "wait" };
	}
	if (input.mode !== "finish") return { action: "detach", reason: "budget" };

	const timeoutMs = input.explicitTimeoutSec !== undefined ? input.explicitTimeoutSec * 1000 : undefined;
	if (timeoutMs !== undefined && input.elapsedMs >= timeoutMs) {
		return config.explicitTimeoutKills
			? { action: "kill", reason: "timeout" }
			: { action: "detach", reason: "timeout" };
	}
	if (input.idleMs >= config.idleDetachSec * 1000) return { action: "detach", reason: "idle" };
	if (input.elapsedMs >= config.finishSoftBudgetSec * 1000) return { action: "detach", reason: "budget" };
	if (!input.idleWarned && input.idleMs >= config.idleWarnSec * 1000) {
		return { action: "notify", kind: "idle", idleSec: Math.round(input.idleMs / 1000) };
	}
	return { action: "wait" };
}

/** Tick granularity for the blocking loop. One second is enough for 120s/180s/300s budgets. */
export const WAIT_TICK_MS = 1_000;

export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m${String(seconds).padStart(2, "0")}s`;
	const hours = Math.floor(minutes / 60);
	const restMinutes = minutes % 60;
	return `${hours}h${String(restMinutes).padStart(2, "0")}m`;
}
