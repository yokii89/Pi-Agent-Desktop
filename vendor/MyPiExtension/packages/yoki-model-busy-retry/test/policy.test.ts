import { describe, expect, it } from "vitest";
import {
	type BusyRetryPolicy,
	createBusyRetryPlanner,
	DEFAULT_BUSY_RETRY_POLICY,
	formatBusyRetryNotice,
} from "../policy.ts";

const policy: BusyRetryPolicy = {
	probeFraction: 0.25,
	minProbeMs: 1_000,
	maxProbeMs: 8_000,
	fallbackDelayMs: 2_000,
	maxServerHintMs: 20_000,
	drainRatio: 0.5,
	maxStalledProbes: 3,
	maxAttemptsPerRequest: 4,
	maxWaitMsPerRun: 30_000,
};

/** The same ladder with room for a multi-minute queue, so slicing and escalation are visible. */
const longPolicy: BusyRetryPolicy = {
	...policy,
	maxProbeMs: 60_000,
	maxServerHintMs: 600_000,
	maxWaitMsPerRun: 600_000,
};

/**
 * A planner on a clock that only moves when a wait is handed out: a queue promise has to
 * keep falling against the time the retry loop actually spent, and a test has to spend it.
 */
function clocked(p: BusyRetryPolicy = policy) {
	let nowMs = 0;
	const planner = createBusyRetryPlanner(p, { now: () => nowMs });
	return {
		policy: planner.policy,
		get waitedMs() {
			return planner.waitedMs;
		},
		reset() {
			planner.reset();
		},
		plan(attempt: number, hint?: { waitMs?: number; ahead?: number }) {
			const decision = planner.plan(attempt, hint);
			if (decision) nowMs += decision.delayMs;
			return decision;
		},
	};
}

/** The wait chosen for one attempt under the small policy, without the bookkeeping around it. */
function delay(attempt: number, hint: { waitMs?: number; ahead?: number }): number | undefined {
	return clocked().plan(attempt, hint)?.delayMs;
}

describe("createBusyRetryPlanner", () => {
	it("keeps a promise it can afford in one sleep", () => {
		// 6s of announced wait is cheaper to wait out than to re-queue for.
		expect(delay(1, { waitMs: 6_000 })).toBe(6_000);
		// A promise shorter than the floor is not a license to hammer the queue.
		expect(delay(1, { waitMs: 200 })).toBe(1_000);
	});

	it("slices a long promise down to the announced share", () => {
		const planner = clocked(longPolicy);
		const first = planner.plan(1, { waitMs: 205_000 });

		expect(first?.delayMs).toBe(51_250); // the queue's 205s, our X/4
		expect(first?.mode).toBe("probe");
		expect(first?.waitMs).toBe(205_000);
	});

	it("caps a slice while the estimate is still moving", () => {
		const planner = clocked(longPolicy);
		// A quarter of the 600s promise we are willing to chase is 150s; one probe stays at 60s.
		expect(planner.plan(1, { waitMs: 900_000 })?.delayMs).toBe(60_000);
	});

	it("doubles the share when the announced wait does not fall", () => {
		const planner = clocked(longPolicy);
		planner.plan(1, { waitMs: 205_000 });
		const second = planner.plan(2, { waitMs: 205_000 });
		const third = planner.plan(3, { waitMs: 205_000 });

		// Probing bought nothing, so stop guessing and sleep what the queue asked for.
		expect(second?.delayMs).toBe(102_500);
		expect(third?.delayMs).toBe(205_000);
		expect(third?.mode).toBe("honor");
	});

	it("treats a queue that is growing as no progress at all", () => {
		const planner = clocked(longPolicy);
		planner.plan(1, { waitMs: 205_000, ahead: 15_254 });
		// The wait fell by 105s for 51s slept — fair — but there are more requests ahead now.
		const second = planner.plan(2, { waitMs: 100_000, ahead: 20_000 });

		expect(second?.delayMs).toBe(50_000); // half of 100s, not a quarter
	});

	it("forgets the stall streak once the queue drains at the promised rate", () => {
		const planner = clocked(longPolicy);
		planner.plan(1, { waitMs: 205_000 });
		expect(planner.plan(2, { waitMs: 205_000 })?.delayMs).toBe(102_500);
		const third = planner.plan(3, { waitMs: 100_000 });

		expect(third?.delayMs).toBe(25_000);
		expect(third?.mode).toBe("probe");
	});

	it("re-plans from the newest number instead of adding to the old schedule", () => {
		const planner = clocked(longPolicy);
		planner.plan(1, { waitMs: 205_000 });
		const after = planner.plan(2, { waitMs: 8_000 });

		expect(after?.delayMs).toBe(8_000); // the new promise is short: keep it whole
	});

	it("gives up on a queue that is not moving and no longer fits what is left", () => {
		const planner = clocked({ ...policy, maxServerHintMs: 100_000, maxWaitMsPerRun: 200_000 });
		expect(planner.plan(1, { waitMs: 100_000 })?.delayMs).toBe(8_000);
		expect(planner.plan(2, { waitMs: 100_000 })?.delayMs).toBe(50_000);
		expect(planner.plan(3, { waitMs: 100_000 })?.delayMs).toBe(100_000);
		// 100s promised, 42s of budget left, and no probe ever saw the number move.
		expect(planner.plan(4, { waitMs: 100_000 })).toBeUndefined();
	});

	it("doubles from the fallback base when the failure carries no number", () => {
		const planner = clocked(policy);
		expect(planner.plan(1)?.delayMs).toBe(2_000);
		expect(planner.plan(2)?.delayMs).toBe(4_000);
		expect(planner.plan(3)?.delayMs).toBe(8_000);
		// No promise to be patient about, so a blind sleep never outgrows one probe.
		expect(planner.plan(4)?.delayMs).toBe(8_000);
		expect(planner.plan(4)?.mode).toBe("honor");
	});

	it("refuses attempts past the per-request limit", () => {
		const planner = clocked(policy);
		expect(planner.plan(0, { waitMs: 5_000 })).toBeUndefined();
		expect(planner.plan(5, { waitMs: 5_000 })).toBeUndefined();
	});

	it("bounds the whole run, so nested retries cannot add up forever", () => {
		const planner = clocked({ ...policy, maxWaitMsPerRun: 12_000 });
		expect(planner.plan(1, { waitMs: 20_000 })?.delayMs).toBe(5_000);
		expect(planner.plan(2, { waitMs: 20_000 })).toEqual({
			attempt: 2,
			delayMs: 7_000,
			mode: "probe",
			waitMs: 20_000,
			ahead: undefined,
			trimmed: true,
		});
		expect(planner.waitedMs).toBe(12_000);
		expect(planner.plan(3, { waitMs: 4_000 })).toBeUndefined();
	});

	it("tracks what it committed and forgets everything on reset", () => {
		const planner = clocked(policy);
		planner.plan(1, { waitMs: 20_000 });
		expect(planner.waitedMs).toBe(5_000);
		// Still the same promise: without a reset this probe would be twice as greedy.
		expect(planner.plan(2, { waitMs: 20_000 })?.delayMs).toBe(10_000);

		planner.reset();
		expect(planner.waitedMs).toBe(0);
		// A new run may believe the queue again, so the stall streak is gone too.
		expect(planner.plan(2, { waitMs: 20_000 })?.delayMs).toBe(5_000);
	});

	it("defaults to a quarter probe, six attempts, and a four minute run", () => {
		const planner = clocked(DEFAULT_BUSY_RETRY_POLICY);
		expect(planner.policy).toEqual(DEFAULT_BUSY_RETRY_POLICY);

		// The reported case: one 205s queue is chased as 51s + 102s + the 86s left of the budget.
		expect(planner.plan(1, { waitMs: 205_000 })).toMatchObject({ delayMs: 51_250, mode: "probe" });
		expect(planner.plan(2, { waitMs: 205_000 })).toMatchObject({ delayMs: 102_500, mode: "probe" });
		expect(planner.plan(3, { waitMs: 205_000 })).toMatchObject({ delayMs: 86_250, mode: "honor", trimmed: true });
		expect(planner.plan(4, { waitMs: 205_000 })).toBeUndefined();
	});

	it("reads the wall clock when nobody hands it one", () => {
		const planner = createBusyRetryPlanner(DEFAULT_BUSY_RETRY_POLICY);
		// No previous promise to judge against, so the real clock is only stamped — the first
		// probe is pure slice.
		expect(planner.plan(1, { waitMs: 205_000 })).toMatchObject({ delayMs: 51_250, mode: "probe" });
	});

	it("walks a draining queue down without ever wagering the whole budget", () => {
		const planner = clocked(DEFAULT_BUSY_RETRY_POLICY);
		const waits = [205_000, 150_000, 100_000, 50_000].map((waitMs, index) => planner.plan(index + 1, { waitMs }));

		expect(waits.map((wait) => wait?.delayMs)).toEqual([51_250, 37_500, 25_000, 50_000]);
		expect(waits.map((wait) => wait?.mode)).toEqual(["probe", "probe", "probe", "honor"]);
		expect(planner.waitedMs).toBe(163_750); // of a 240s budget
	});
});

describe("formatBusyRetryNotice", () => {
	it("says what the queue asked for and what we are doing about it", () => {
		expect(
			formatBusyRetryNotice(
				{ attempt: 2, delayMs: 51_000, mode: "probe", waitMs: 205_000, ahead: 15_254, trimmed: false },
				DEFAULT_BUSY_RETRY_POLICY,
			),
		).toBe("model busy: probing in 51s (queue asked 205s, 15254 ahead), retry 2/6");
	});

	it("says when the wait is the announced one", () => {
		expect(
			formatBusyRetryNotice(
				{ attempt: 1, delayMs: 30_000, mode: "honor", waitMs: 30_000, trimmed: false },
				DEFAULT_BUSY_RETRY_POLICY,
			),
		).toBe("model busy: waiting 30s (queue asked 30s), retry 1/6");
	});

	it("says when the run budget cut the wait short", () => {
		expect(
			formatBusyRetryNotice(
				{ attempt: 3, delayMs: 86_000, mode: "honor", waitMs: 205_000, trimmed: true },
				DEFAULT_BUSY_RETRY_POLICY,
			),
		).toBe("model busy: waiting 86s (queue asked 205s, only 86s of budget left), retry 3/6");
	});

	it("says when there was nothing to go on", () => {
		expect(
			formatBusyRetryNotice(
				{ attempt: 1, delayMs: 30_000, mode: "honor", trimmed: false },
				DEFAULT_BUSY_RETRY_POLICY,
			),
		).toBe("model busy: waiting 30s (no wait reported), retry 1/6");
	});
});
