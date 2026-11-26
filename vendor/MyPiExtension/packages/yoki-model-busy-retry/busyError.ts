/**
 * Recognition of "the model is busy, your request was queued" provider failures.
 *
 * Qoder answers a saturated model with code `10605` carried *inside* the SSE body, and
 * `pi-provider-qoder` turns it into an error whose text names the wait it was told to
 * keep (`retry-after-ms`, `retryAfterSeconds`, `~30s wait`). The provider cannot honor
 * that wait itself — its own busy loop is hard-capped at 5s — so the failure surfaces
 * immediately and Pi's agent-level retry (2s base) re-enters the same queue too early.
 */

/** Qoder's saturated-model rejection code. */
export const MODEL_BUSY_CODE = "10605";

const BUSY_TEXT_PATTERN = /(?:model is busy|request queued|isQueued)/i;

/**
 * Hints in the order they should win: an explicit millisecond value is more precise than
 * the human-readable seconds the provider also prints.
 */
function waitKeyHint(key: RegExp, scale: number): { readonly pattern: RegExp; readonly scale: number } {
	return { pattern: new RegExp(`["']?${key.source}["']?\\s*[=:]\\s*["']?(\\d+(?:\\.\\d+)?)`, "i"), scale };
}

const RETRY_AFTER_HINTS: ReadonlyArray<{ readonly pattern: RegExp; readonly scale: number }> = [
	waitKeyHint(/retry-after-ms/, 1),
	waitKeyHint(/retryAfterMs/, 1),
	{ pattern: /requested delay (\d+(?:\.\d+)?)\s*ms/i, scale: 1 },
	waitKeyHint(/retry-after-seconds?/, 1000),
	waitKeyHint(/retryAfterSeconds/, 1000),
	waitKeyHint(/waitTime/, 1000),
	{ pattern: /~\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?\s*wait/i, scale: 1000 },
];

/**
 * Milliseconds the provider asked us to keep before retrying, read from the first hint
 * present in the message. Undefined when the failure carries no wait at all.
 */
export function parseRetryAfterMs(errorMessage: string | undefined): number | undefined {
	if (!errorMessage) return undefined;
	// A rejection lifted out of a nested JSON body keeps its escapes (`\"waitTime\":12.5`),
	// which are noise for a text scan.
	const text = errorMessage.replace(/\\/g, "");
	for (const { pattern, scale } of RETRY_AFTER_HINTS) {
		const match = pattern.exec(text);
		if (!match) continue;
		const value = Number(match[1]);
		if (!Number.isFinite(value) || value <= 0) continue;
		return Math.round(value * scale);
	}
	return undefined;
}

/**
 * Whether the failure means "the model is saturated, ask again later" rather than
 * something a retry would not fix (bad request, auth, quota spent).
 *
 * A known busy code is enough on its own; a busy sentence needs a wait hint, so generic
 * gateway copy that merely mentions a queue does not turn into an open-ended backoff.
 */
export function isModelBusyError(errorMessage: string | undefined): boolean {
	if (!errorMessage) return false;
	const hasCode = errorMessage.includes(MODEL_BUSY_CODE);
	const hasText = BUSY_TEXT_PATTERN.test(errorMessage);
	if (!hasCode && !hasText) return false;
	return hasCode || parseRetryAfterMs(errorMessage) !== undefined;
}

/** Everything a saturated model said about the queue behind the rejection. */
export interface BusyQueueHint {
	/** Milliseconds until the queue says this request gets a slot. */
	readonly waitMs?: number;
	/** Requests ahead of this one, when the provider reported a position. */
	readonly ahead?: number;
}

/**
 * Queue position as the provider prints it: `…, 15254 ahead, ~205s wait, …`.
 *
 * The wait says when the queue *thinks* we are served; the position says how much work is
 * ahead, so a position that does not shrink is proof that re-asking early only moved us to
 * the back. Both feed the planner; the position is optional because only Qoder's queued
 * rejection reports it.
 */
const AHEAD_PATTERN = /([\d,]{1,15})\s+ahead\b/i;

/** Read the announced wait and the queue position out of a busy failure. */
export function parseBusyQueueHint(errorMessage: string | undefined): BusyQueueHint {
	const match = AHEAD_PATTERN.exec(errorMessage ?? "");
	const ahead = match ? Number(match[1].replace(/,/g, "")) : undefined;
	return { waitMs: parseRetryAfterMs(errorMessage), ahead: Number.isFinite(ahead) ? ahead : undefined };
}
