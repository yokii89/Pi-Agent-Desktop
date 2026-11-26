/**
 * The provider-level retry loop.
 *
 * Wrapping `streamSimple` rather than reacting to Pi's own retry is the only way to own
 * the wait: extensions read settings but cannot write them, so `retry.baseDelayMs` stays
 * out of reach, and the queue rejection is not something a later event can un-fail.
 *
 * Consumers (pi-agent-core's loop) push a partial assistant message at `start` and
 * replace it at the terminal event, so a retried request must look like exactly one
 * response: each attempt's `start` is held back until that attempt produces content, and
 * a swallowed `error` is never forwarded. That is also why only a failure with no output
 * at all can be retried — once content is on the wire the response is already committed.
 *
 * The *timing* is not decided here: every rejection is read for what the queue said
 * (`busyError.ts`) and handed to the planner (`policy.ts`), which re-plans from the newest
 * number each time. This loop only owns the forwarding and the sleep.
 */

import { type AssistantMessageEvent, lazyStream } from "@earendil-works/pi-ai";
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import { isModelBusyError, parseBusyQueueHint } from "./busyError.ts";
import type { BusyRetryDecision, BusyRetryPlanner } from "./policy.ts";

type StartEvent = Extract<AssistantMessageEvent, { type: "start" }>;
type ErrorEvent = Extract<AssistantMessageEvent, { type: "error" }>;

/** A provider's streaming entrypoint, as Pi's extension-facing `ProviderConfig` declares it. */
export type ProviderStreamSimple = NonNullable<ProviderConfig["streamSimple"]>;

export interface BusyRetryStreamDeps {
	/** The provider implementation being wrapped. */
	readonly delegate: ProviderStreamSimple;
	/** Same contract as `BusyRetryPlanner.plan`. */
	readonly plan: BusyRetryPlanner["plan"];
	/** Resolves after `ms`, or early once `signal` is aborted. Never rejects. */
	readonly wait: (ms: number, signal?: AbortSignal) => Promise<void>;
	readonly onWait?: (decision: BusyRetryDecision) => void;
}

/** Sleep that resolves instead of throwing when the request is aborted. */
export function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted || ms <= 0) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export function createBusyRetryStreamFn(deps: BusyRetryStreamDeps): ProviderStreamSimple {
	return (model, context, options) => lazyStream(model, async () => replayAttempts(deps, model, context, options));
}

async function* replayAttempts(
	deps: BusyRetryStreamDeps,
	...params: Parameters<ProviderStreamSimple>
): AsyncGenerator<AssistantMessageEvent, void, undefined> {
	const [model, context, options] = params;
	let attempt = 0;
	for (;;) {
		const inner = deps.delegate(model, context, options);
		let pendingStart: StartEvent | undefined;
		let failure: ErrorEvent | undefined;
		for await (const event of inner) {
			if (event.type === "start") {
				pendingStart = event;
				continue;
			}
			if (event.type === "error") {
				failure = event;
				break;
			}
			if (pendingStart) {
				yield pendingStart;
				pendingStart = undefined;
			}
			yield event;
		}
		if (!failure) return;

		const hint = parseBusyQueueHint(failure.error.errorMessage);
		const retryable =
			failure.reason === "error" &&
			failure.error.content.length === 0 &&
			isModelBusyError(failure.error.errorMessage);
		const decision = retryable ? deps.plan(attempt + 1, hint) : undefined;
		if (!decision) {
			// Nothing to hide any more: hand the caller the response it was always going to see.
			if (pendingStart) yield pendingStart;
			yield failure;
			return;
		}
		attempt += 1;
		deps.onWait?.(decision);
		await deps.wait(decision.delayMs, options?.signal);
	}
}
