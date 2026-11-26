import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { BusyQueueHint } from "../busyError.ts";
import {
	type BusyRetryMode,
	createBusyRetryPlanner,
	DEFAULT_BUSY_RETRY_POLICY,
	formatBusyRetryNotice,
} from "../policy.ts";
import { createBusyRetryStreamFn, type ProviderStreamSimple, waitWithAbort } from "../retryStream.ts";
import {
	collect,
	eventTypes,
	failedAfterTextStream,
	LONG_QUEUED_ERROR,
	QUEUED_ERROR,
	rejectedStream,
	streamArgs,
	textStream,
} from "./support.ts";

interface HarnessState {
	attempts: number;
	waits: number[];
	plans: Array<{ attempt: number; hint?: BusyQueueHint }>;
	notices: Array<{ attempt: number; delayMs: number; mode: BusyRetryMode; waitMs?: number; ahead?: number }>;
}

/** What a test wants the planner to answer, in the shape the real planner returns. */
function scheduled(attempt: number, delayMs: number, hint?: BusyQueueHint) {
	return { attempt, delayMs, mode: "probe" as const, waitMs: hint?.waitMs, ahead: hint?.ahead, trimmed: false };
}

/**
 * One canned provider answer per attempt, in order; the last one repeats if it is reached
 * again, so a test that expects a stop cannot accidentally ask for more.
 */
function harness(
	responses: AssistantMessageEventStream[],
	schedule: Array<number | undefined> = [],
): { stream: (options?: { signal?: AbortSignal }) => AssistantMessageEventStream; state: HarnessState } {
	const state: HarnessState = { attempts: 0, waits: [], plans: [], notices: [] };
	let responseIndex = 0;
	const wrapped = createBusyRetryStreamFn({
		delegate: (() => {
			state.attempts += 1;
			return responses[Math.min(responseIndex++, responses.length - 1)];
		}) as ProviderStreamSimple,
		plan: (attempt, hint) => {
			state.plans.push({ attempt, hint });
			const delayMs = schedule[attempt - 1];
			return delayMs === undefined ? undefined : scheduled(attempt, delayMs, hint);
		},
		wait: async (ms) => {
			state.waits.push(ms);
		},
		onWait: (decision) => {
			state.notices.push({
				attempt: decision.attempt,
				delayMs: decision.delayMs,
				mode: decision.mode,
				waitMs: decision.waitMs,
				ahead: decision.ahead,
			});
		},
	});
	return { stream: (options) => wrapped(streamArgs[0], streamArgs[1], options), state };
}

describe("createBusyRetryStreamFn", () => {
	it("forwards a provider response untouched", async () => {
		const h = harness([textStream("hello")]);
		const { events, message } = await collect(h.stream());

		expect(eventTypes(events)).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
		expect(message.stopReason).toBe("stop");
		expect(h.state.attempts).toBe(1);
		expect(h.state.waits).toEqual([]);
		expect(h.state.plans).toEqual([]);
	});

	it("retries a queued rejection so only the response that worked is visible", async () => {
		const h = harness([rejectedStream(QUEUED_ERROR), textStream("served")], [1000]);
		const { events, message } = await collect(h.stream());

		expect(h.state.attempts).toBe(2);
		expect(h.state.waits).toEqual([1000]);
		expect(h.state.plans).toEqual([{ attempt: 1, hint: { waitMs: 30_000, ahead: 4 } }]);
		expect(h.state.notices).toEqual([{ attempt: 1, delayMs: 1000, mode: "probe", waitMs: 30_000, ahead: 4 }]);
		expect(eventTypes(events)).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
		expect(message.stopReason).toBe("stop");
		expect(message.content).toEqual([{ type: "text", text: "served" }]);
		expect(message.errorMessage).toBeUndefined();
	});

	it("announces one response no matter how many attempts it took", async () => {
		const h = harness([rejectedStream(QUEUED_ERROR), rejectedStream(QUEUED_ERROR), textStream("late")], [1000, 2000]);
		const { events } = await collect(h.stream());

		expect(h.state.attempts).toBe(3);
		expect(h.state.waits).toEqual([1000, 2000]);
		expect(eventTypes(events).filter((type) => type === "start")).toEqual(["start"]);
		expect(h.state.notices).toEqual([
			{ attempt: 1, delayMs: 1000, mode: "probe", waitMs: 30_000, ahead: 4 },
			{ attempt: 2, delayMs: 2000, mode: "probe", waitMs: 30_000, ahead: 4 },
		]);
	});

	it("passes the failure through once the planner declines to wait", async () => {
		const h = harness([rejectedStream(QUEUED_ERROR)], [undefined]);
		const { events, message } = await collect(h.stream());

		expect(eventTypes(events)).toEqual(["start", "error"]);
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toBe(QUEUED_ERROR);
		expect(h.state.attempts).toBe(1);
		expect(h.state.plans).toEqual([{ attempt: 1, hint: { waitMs: 30_000, ahead: 4 } }]);
	});

	it("never retries once content is on the wire", async () => {
		const h = harness([failedAfterTextStream(QUEUED_ERROR)], [1000]);
		const { events } = await collect(h.stream());

		expect(eventTypes(events)).toEqual(["start", "text_start", "text_delta", "error"]);
		expect(h.state.attempts).toBe(1);
		expect(h.state.plans).toEqual([]);
	});

	it("leaves failures that a wait cannot fix alone", async () => {
		const h = harness([rejectedStream("Qoder API request failed: 502 Bad Gateway")], [1000]);
		await collect(h.stream());

		expect(h.state.attempts).toBe(1);
		expect(h.state.plans).toEqual([]);
	});

	it("never retries an aborted response", async () => {
		const h = harness([rejectedStream("Aborted", "aborted")], [1000]);
		const { message } = await collect(h.stream());

		expect(message.stopReason).toBe("aborted");
		expect(h.state.plans).toEqual([]);
	});

	it("terminates the stream when the provider throws before it starts", async () => {
		const delegate = (() => {
			throw new Error("Missing API key for qoder-cn");
		}) as ProviderStreamSimple;
		const stream = createBusyRetryStreamFn({
			delegate,
			plan: (attempt, hint) => scheduled(attempt, 1000, hint),
			wait: async () => {},
		});
		const { events, message } = await collect(stream(streamArgs[0], streamArgs[1], undefined));

		expect(eventTypes(events)).toEqual(["error"]);
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toBe("Missing API key for qoder-cn");
		expect(message.provider).toBe("qoder-cn");
	});

	it("stops waiting when the request is aborted and forwards the aborted result", async () => {
		const controller = new AbortController();
		const responses = [rejectedStream(QUEUED_ERROR), rejectedStream("Aborted", "aborted")];
		let attempts = 0;
		const stream = createBusyRetryStreamFn({
			delegate: (() => responses[Math.min(attempts++, responses.length - 1)]) as ProviderStreamSimple,
			plan: (attempt, hint) => scheduled(attempt, 30_000, hint),
			wait: async () => {
				controller.abort();
			},
		});
		const { events, message } = await collect(stream(streamArgs[0], streamArgs[1], { signal: controller.signal }));

		expect(attempts).toBe(2);
		expect(eventTypes(events)).toEqual(["start", "error"]);
		expect(message.stopReason).toBe("aborted");
	});
});

describe("with the real planner and a 205s queue", () => {
	/** Every rejection says the same thing: the queue is not moving while we wait. */
	function congested(announced: string, times: number) {
		// The fake wait does not sleep, so the planner is given a clock the waits advance:
		// "did the estimate fall far enough for the time we spent" is the whole design.
		let nowMs = 0;
		const planner = createBusyRetryPlanner(DEFAULT_BUSY_RETRY_POLICY, { now: () => nowMs });
		const waits: number[] = [];
		const notices: string[] = [];
		let attempts = 0;
		const stream = createBusyRetryStreamFn({
			delegate: (() => {
				attempts += 1;
				return attempts <= times ? rejectedStream(announced) : textStream("served");
			}) as ProviderStreamSimple,
			plan: planner.plan,
			wait: async (ms) => {
				waits.push(ms);
				nowMs += ms;
			},
			onWait: (decision) => {
				notices.push(formatBusyRetryNotice(decision, planner.policy));
			},
		});
		return { stream, waits, notices };
	}

	it("chases the estimate in slices instead of wagering the run budget on one sleep", async () => {
		const { stream, waits } = congested(LONG_QUEUED_ERROR, 3);
		const { message } = await collect(stream(streamArgs[0], streamArgs[1], undefined));

		// 51s probe, 102s once the estimate stopped falling, then the 86s left of the budget.
		expect(waits).toEqual([51_250, 102_500, 86_250]);
		expect(message.stopReason).toBe("stop");
	});

	it("gives up on a queue that never moved, with the failure handed back untouched", async () => {
		const { stream, waits, notices } = congested(LONG_QUEUED_ERROR, 9);
		const { events, message } = await collect(stream(streamArgs[0], streamArgs[1], undefined));

		expect(waits).toEqual([51_250, 102_500, 86_250]); // 240s of the run budget, no more
		expect(eventTypes(events).filter((type) => type === "start")).toEqual(["start"]);
		expect(eventTypes(events)).toEqual(["start", "error"]);
		expect(message.errorMessage).toBe(LONG_QUEUED_ERROR);
		expect(notices).toEqual([
			"model busy: probing in 51s (queue asked 205s, 15254 ahead), retry 1/6",
			"model busy: probing in 103s (queue asked 205s, 15254 ahead), retry 2/6",
			"model busy: waiting 86s (queue asked 205s, 15254 ahead, only 86s of budget left), retry 3/6",
		]);
	});

	it("serves a queue that drains at the rate it promised, inside one budget", async () => {
		let nowMs = 0;
		const planner = createBusyRetryPlanner(DEFAULT_BUSY_RETRY_POLICY, { now: () => nowMs });
		const waits: number[] = [];
		const answers = [205_000, 150_000, undefined].map((waitMs) =>
			waitMs === undefined ? textStream("served") : rejectedStream(`10605 request queued, retry-after-ms=${waitMs}`),
		);
		let attempts = 0;
		const stream = createBusyRetryStreamFn({
			delegate: (() => answers[Math.min(attempts++, answers.length - 1)]) as ProviderStreamSimple,
			plan: planner.plan,
			wait: async (ms) => {
				waits.push(ms);
				nowMs += ms;
			},
		});
		const { message } = await collect(stream(streamArgs[0], streamArgs[1], undefined));

		// The estimate halved while we slept, so the queue is honest and the probes stay cheap.
		expect(waits).toEqual([51_250, 37_500]);
		expect(message.content).toEqual([{ type: "text", text: "served" }]);
	});
});

describe("waitWithAbort", () => {
	it("resolves immediately for a zero wait", async () => {
		await expect(waitWithAbort(0)).resolves.toBeUndefined();
	});

	it("resolves immediately for an already aborted signal", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(waitWithAbort(60_000, controller.signal)).resolves.toBeUndefined();
	});

	it("wakes early when the wait is interrupted", async () => {
		const controller = new AbortController();
		const startedAt = Date.now();
		const waiting = waitWithAbort(60_000, controller.signal);
		setTimeout(() => controller.abort(), 5);
		await waiting;
		expect(Date.now() - startedAt).toBeLessThan(5000);
	});

	it("stays asleep when nothing interrupts it", async () => {
		const startedAt = Date.now();
		await waitWithAbort(10, new AbortController().signal);
		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(5);
	});
});
