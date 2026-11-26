import { describe, expect, it } from "vitest";
import { formatDuration, nextWaitAction, type PolicyConfig, resolveMode } from "../core/policy.ts";

const config: PolicyConfig = {
	finishSoftBudgetSec: 300,
	idleWarnSec: 120,
	idleDetachSec: 180,
	explicitTimeoutKills: true,
	longGraceSec: 20,
};

const base = { mode: "finish" as const, elapsedMs: 0, idleMs: 0, idleWarned: false, config };

describe("resolveMode", () => {
	const classified = { mode: "detach" as const, reason: "vite" };

	it("an explicit mode beats classification and timeout", () => {
		expect(
			resolveMode({ requestedMode: "finish", explicitTimeoutSec: 10, classified, hasExplicitTimeout: true }),
		).toEqual({
			mode: "finish",
			reason: "mode=finish (explicit)",
		});
	});

	it("an explicit timeout means 'finish' even for a server-looking command", () => {
		expect(resolveMode({ explicitTimeoutSec: 30, classified, hasExplicitTimeout: true })).toEqual({
			mode: "finish",
			reason: "timeout=30s (explicit)",
		});
	});

	it("falls back to the classifier", () => {
		expect(resolveMode({ classified, hasExplicitTimeout: false })).toEqual({ mode: "detach", reason: "vite" });
	});
});

describe("nextWaitAction", () => {
	it("waits inside every budget", () => {
		expect(nextWaitAction({ ...base, elapsedMs: 1_000, idleMs: 1_000 })).toEqual({ action: "wait" });
	});

	it("warns once when the call goes quiet, without interrupting", () => {
		expect(nextWaitAction({ ...base, elapsedMs: 121_000, idleMs: 121_000 })).toEqual({
			action: "notify",
			kind: "idle",
			idleSec: 121,
		});
		expect(nextWaitAction({ ...base, elapsedMs: 130_000, idleMs: 130_000, idleWarned: true })).toEqual({
			action: "wait",
		});
	});

	it("yields at idleDetachSec — the hung-pipe path, and it never kills", () => {
		expect(nextWaitAction({ ...base, elapsedMs: 181_000, idleMs: 181_000, idleWarned: true })).toEqual({
			action: "detach",
			reason: "idle",
		});
	});

	it("yields at the soft budget even while output keeps flowing", () => {
		expect(nextWaitAction({ ...base, elapsedMs: 301_000, idleMs: 1_000 })).toEqual({
			action: "detach",
			reason: "budget",
		});
	});

	it("an explicit timeout kills before the budget decides anything", () => {
		expect(nextWaitAction({ ...base, explicitTimeoutSec: 5, elapsedMs: 5_000, idleMs: 5_000 })).toEqual({
			action: "kill",
			reason: "timeout",
		});
	});

	it("an explicit timeout that yields instead of killing is opt-in", () => {
		expect(
			nextWaitAction({
				...base,
				explicitTimeoutSec: 5,
				elapsedMs: 5_000,
				config: { ...config, explicitTimeoutKills: false },
			}),
		).toEqual({ action: "detach", reason: "timeout" });
	});

	it("detach never reaches the wait loop with a kill", () => {
		expect(nextWaitAction({ ...base, mode: "detach", elapsedMs: 10_000_000 })).toEqual({
			action: "detach",
			reason: "budget",
		});
	});

	it("long keeps blocking inside the grace window, then hands over to the background", () => {
		expect(nextWaitAction({ ...base, mode: "long", elapsedMs: 0 })).toEqual({ action: "wait" });
		expect(nextWaitAction({ ...base, mode: "long", elapsedMs: 19_000 })).toEqual({ action: "wait" });
		expect(nextWaitAction({ ...base, mode: "long", elapsedMs: 20_000 })).toEqual({
			action: "detach",
			reason: "grace",
		});
	});

	it("longGraceSec=0 restores 'return immediately' for long calls", () => {
		expect(nextWaitAction({ ...base, mode: "long", elapsedMs: 0, config: { ...config, longGraceSec: 0 } })).toEqual({
			action: "detach",
			reason: "grace",
		});
	});

	it("an unconfigured grace window still falls back to a real value, not zero", () => {
		const { longGraceSec: _omitted, ...withoutKnob } = config;
		expect(nextWaitAction({ ...base, mode: "long", elapsedMs: 1_000, config: withoutKnob })).toEqual({
			action: "wait",
		});
	});

	it("idleDetach fires before the budget when output died early", () => {
		const earlyDetach = nextWaitAction({ ...base, elapsedMs: 181_000, idleMs: 181_000, idleWarned: true });
		expect(earlyDetach).toMatchObject({ action: "detach", reason: "idle" });
	});
});

describe("formatDuration", () => {
	it("scales seconds → minutes → hours", () => {
		expect(formatDuration(0)).toBe("0s");
		expect(formatDuration(42_000)).toBe("42s");
		expect(formatDuration(120_000)).toBe("2m");
		expect(formatDuration(123_000)).toBe("2m03s");
		expect(formatDuration(2 * 3_600_000 + 3 * 60_000)).toBe("2h03m");
	});
});
