/**
 * Backoff for queued-model failures, driven by the wait the queue itself announced.
 *
 * The old schedule slept the *whole* announced wait (a 205s queue burned 205s of a 240s
 * run budget in one blind guess, then re-entered 35s later and died). This one treats an
 * announced wait as a promise to be *chased* rather than slept through:
 *
 * - a promise short enough to afford in one sleep is kept in one sleep — slicing a 30s
 *   queue only re-enters it and pays for a worse position;
 * - a long promise is sliced: sleep a share of it (`probeFraction`, i.e. the announced
 *   X/4), re-ask, and re-plan from the *new* number. Cheap probes catch a queue that
 *   drains early, keep `Esc` meaningful, and never wager the whole budget on one estimate;
 * - when the number stops falling, the slice stops paying off — re-asking a queue that
 *   has not moved just re-queues us at the back — so the share doubles each stalled probe
 *   (X/4 → X/2 → X) until we are sleeping what the queue actually asked for;
 * - when the queue has not moved at all and the budget left cannot cover its own promise,
 *   waiting longer is fiction: fail and let Pi's retry layer and the user decide.
 *
 * Two bounds keep it honest: attempts per model request, and total wait per agent run
 * (Pi retries the same response through its own layer, so the budget is shared).
 */

import type { BusyQueueHint } from "./busyError.ts";

/** `probe` re-asks early to refresh the estimate; `honor` sleeps the announced wait. */
export type BusyRetryMode = "honor" | "probe";

/** What the planner decided to do before the next attempt. */
export interface BusyRetryDecision {
	readonly attempt: number;
	readonly delayMs: number;
	readonly mode: BusyRetryMode;
	/** The wait the provider announced, when it announced one. */
	readonly waitMs?: number;
	/** Requests ahead of us, when the provider reported a queue position. */
	readonly ahead?: number;
	/** True when the run budget cut this wait short. */
	readonly trimmed: boolean;
}

export interface BusyRetryPolicy {
	/** Share of a long announced wait slept before re-asking: the queue's X, our X/4. */
	readonly probeFraction: number;
	/** Floor for one wait. A probe costs a request against the very limit that queued us. */
	readonly minProbeMs: number;
	/** Ceiling for one wait while the estimate is still moving. */
	readonly maxProbeMs: number;
	/** Wait for a busy failure that carries no number; each later attempt doubles from it. */
	readonly fallbackDelayMs: number;
	/** Ceiling for an announced wait we are willing to chase at all. */
	readonly maxServerHintMs: number;
	/** An estimate that fell by less than this share of the time slept did not keep its promise. */
	readonly drainRatio: number;
	/** Probes that kept no promise before we stop waiting for a queue that is not moving. */
	readonly maxStalledProbes: number;
	/** Waits allowed for one model request. */
	readonly maxAttemptsPerRequest: number;
	/** Total wait allowed for one agent run, across every request of that run. */
	readonly maxWaitMsPerRun: number;
}

export const DEFAULT_BUSY_RETRY_POLICY: BusyRetryPolicy = {
	probeFraction: 0.25,
	minProbeMs: 5_000,
	maxProbeMs: 60_000,
	fallbackDelayMs: 30_000,
	maxServerHintMs: 300_000,
	drainRatio: 0.5,
	maxStalledProbes: 3,
	maxAttemptsPerRequest: 6,
	maxWaitMsPerRun: 240_000,
};

export interface BusyRetryPlanner {
	readonly policy: BusyRetryPolicy;
	/** Milliseconds already committed for the current agent run. */
	readonly waitedMs: number;
	/** Forget the run budget and everything learned about the queue. Called when a run starts. */
	reset(): void;
	/**
	 * The wait to take before `attempt` (1-based), or undefined when the request should fail
	 * instead of waiting. `hint` is what this rejection said; it re-plans from scratch, it
	 * does not add to the previous schedule.
	 */
	plan(attempt: number, hint?: BusyQueueHint): BusyRetryDecision | undefined;
}

export interface BusyRetryPlannerDeps {
	/** Clock used to judge whether the queue kept its promise. Injectable for tests. */
	readonly now?: () => number;
}

/** The announced wait, bounded by what we are ever willing to chase. */
function boundedWait(waitMs: number | undefined, policy: BusyRetryPolicy): number | undefined {
	if (waitMs === undefined || !Number.isFinite(waitMs) || waitMs <= 0) return undefined;
	return Math.min(waitMs, policy.maxServerHintMs);
}

function floored(ms: number, policy: BusyRetryPolicy): number {
	return Math.max(Math.round(ms), policy.minProbeMs);
}

/**
 * How long one wait should be, given the announced wait and how many probes the queue has
 * failed to justify. Pure: it neither spends the budget nor remembers anything.
 */
function scheduledWait(
	attempt: number,
	promisedMs: number | undefined,
	stalledProbes: number,
	policy: BusyRetryPolicy,
): { delayMs: number; mode: BusyRetryMode } {
	// Nothing to chase: double from the fallback base, and still never sleep one long block —
	// without a number we have no promise to be patient about.
	if (promisedMs === undefined) {
		const doubled = Math.min(policy.fallbackDelayMs * 2 ** (attempt - 1), policy.maxProbeMs);
		return { delayMs: floored(doubled, policy), mode: "honor" };
	}
	// A queue we can afford to wait out in one sleep gets one sleep.
	if (promisedMs <= policy.maxProbeMs) return { delayMs: floored(promisedMs, policy), mode: "honor" };
	// Longer: probe a share of it, and a growing share of it while the estimate stands still.
	const fraction = Math.min(1, policy.probeFraction * 2 ** stalledProbes);
	const ceiling = stalledProbes > 0 ? policy.maxServerHintMs : policy.maxProbeMs;
	const delayMs = Math.min(floored(promisedMs * fraction, policy), ceiling);
	return { delayMs, mode: delayMs >= promisedMs ? "honor" : "probe" };
}

export function createBusyRetryPlanner(
	policy: BusyRetryPolicy = DEFAULT_BUSY_RETRY_POLICY,
	deps: BusyRetryPlannerDeps = {},
): BusyRetryPlanner {
	const now = deps.now ?? (() => Date.now());
	let waitedMs = 0;
	/** The promise the last rejection made, when it made it, and the position it reported. */
	let promisedMs: number | undefined;
	let promisedAtMs = 0;
	let ahead: number | undefined;
	let stalledProbes = 0;

	return {
		policy,
		get waitedMs() {
			return waitedMs;
		},
		reset() {
			waitedMs = 0;
			promisedMs = undefined;
			promisedAtMs = 0;
			ahead = undefined;
			stalledProbes = 0;
		},
		plan(attempt, hint) {
			if (attempt < 1 || attempt > policy.maxAttemptsPerRequest) return undefined;
			const remainingMs = policy.maxWaitMsPerRun - waitedMs;
			if (remainingMs < policy.minProbeMs) return undefined;

			const nextPromise = boundedWait(hint?.waitMs, policy);
			const nextAhead = typeof hint?.ahead === "number" && Number.isFinite(hint.ahead) ? hint.ahead : undefined;
			if (nextPromise !== undefined && promisedMs !== undefined) {
				// Progress is measured against the real time since that promise — our sleep, plus
				// whatever the request in between took. A queue that answered in between is a queue
				// that moved. A position that grew is never progress: re-asking pushed us back.
				const keptMs = promisedMs - nextPromise;
				const elapsedMs = Math.max(0, now() - promisedAtMs);
				const grew = nextAhead !== undefined && ahead !== undefined && nextAhead >= ahead;
				stalledProbes = keptMs < elapsedMs * policy.drainRatio || grew ? stalledProbes + 1 : 0;
			}

			// A queue that is not moving and whose own promise no longer fits what is left of
			// the budget will not be caught by waiting: stop rather than burn the remainder.
			const chaseMs = nextPromise ?? policy.fallbackDelayMs;
			if (stalledProbes >= policy.maxStalledProbes && chaseMs > remainingMs) return undefined;

			const scheduled = scheduledWait(attempt, nextPromise, stalledProbes, policy);
			const trimmed = scheduled.delayMs > remainingMs;
			const delayMs = Math.min(scheduled.delayMs, remainingMs);

			waitedMs += delayMs;
			if (nextPromise !== undefined) {
				promisedMs = nextPromise;
				promisedAtMs = now();
			}
			if (nextAhead !== undefined) ahead = nextAhead;
			return { attempt, delayMs, mode: scheduled.mode, waitMs: hint?.waitMs, ahead: nextAhead, trimmed };
		},
	};
}

function seconds(ms: number): string {
	return `${Math.round(ms / 1000)}s`;
}

/** One-line, user-facing description of a wait the extension is about to take. */
export function formatBusyRetryNotice(decision: BusyRetryDecision, policy: BusyRetryPolicy): string {
	const queue: string[] = [];
	if (decision.waitMs !== undefined) queue.push(`queue asked ${seconds(decision.waitMs)}`);
	if (decision.ahead !== undefined) queue.push(`${decision.ahead} ahead`);
	if (decision.trimmed) queue.push(`only ${seconds(decision.delayMs)} of budget left`);
	if (queue.length === 0) queue.push("no wait reported");
	const verb = decision.mode === "probe" ? "probing in" : "waiting";
	return (
		`model busy: ${verb} ${seconds(decision.delayMs)} (${queue.join(", ")}), ` +
		`retry ${decision.attempt}/${policy.maxAttemptsPerRequest}`
	);
}
