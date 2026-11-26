import { describe, expect, it } from "vitest";
import { createJobRegistry } from "../core/jobs.ts";
import { createRingBuffer } from "../infra/ring.ts";
import { inspectJobs } from "../run/inspect.ts";
import { DEFAULT_CONFIG } from "../state/config.ts";

const limits = { maxBytes: 64 * 1024, maxLines: 1_000 };

function setup() {
	const clock = { now: 1_000_000 };
	const registry = createJobRegistry({ now: () => clock.now });
	const ring = createRingBuffer(limits);
	const job = registry.create({ command: "pnpm dev", mode: "detach", reason: "vite", ring, kill: () => {} });
	ring.append("VITE v6 ready in 412ms\nhttp://localhost:5173/\n");
	const deps = { registry, config: { ...DEFAULT_CONFIG, inspectTailLines: 80 }, now: () => clock.now };
	return { registry, ring, job, deps, clock };
}

describe("inspect — listing", () => {
	it("lists jobs with ids and status when no job is named", async () => {
		const { deps } = setup();
		const result = await inspectJobs(deps, {});
		expect(result.text).toContain("1 job(s)");
		expect(result.text).toContain("J-1");
		expect(result.text).toContain("detach");
		expect(result.structured.jobs[0]).toMatchObject({ id: "J-1", status: "running", mode: "detach" });
	});

	it("says so plainly when the session has no jobs", async () => {
		const { deps, registry } = setup();
		registry.clear();
		const result = await inspectJobs(deps, {});
		expect(result.text).toBe("No bash jobs in this session.");
		expect(result.structured.jobs).toEqual([]);
	});
});

describe("inspect — one job", () => {
	it("returns the tail plus the numbers a progress bar needs", async () => {
		const { deps } = setup();
		const result = await inspectJobs(deps, { job: "J-1" });
		expect(result.text).toContain("VITE v6 ready");
		expect(result.text).toContain("output: 2 lines");
		expect(result.structured.jobs[0]).toMatchObject({ id: "J-1", lines: 2, lost: false });
		expect(result.structured.jobs[0]?.idleSec).toBeGreaterThanOrEqual(0);
	});

	it("caps tailLines at the configured maximum", async () => {
		const { deps, ring } = setup();
		ring.append("a\nb\nc\nd\ne\n");
		const result = await inspectJobs({ ...deps, config: { ...deps.config, inspectMaxTailLines: 2 } }, { job: "J-1" });
		expect(result.structured.jobs[0]?.tail.split("\n")).toEqual(["d", "e"]);
	});

	it("returns only new lines for a cursor", async () => {
		const { deps, ring } = setup();
		const first = await inspectJobs(deps, { job: "J-1" });
		const cursor = first.structured.jobs[0]?.cursor as string;
		ring.append("compiled successfully\n");
		const second = await inspectJobs(deps, { job: "J-1", cursor });
		expect(second.structured.jobs[0]?.tail).toBe("compiled successfully");
	});

	it("filters with grep, case-insensitively", async () => {
		const { deps, ring } = setup();
		ring.append("ready\nERROR: boom\n");
		const result = await inspectJobs(deps, { job: "J-1", grep: "error" });
		expect(result.structured.jobs[0]?.tail).toBe("ERROR: boom");
	});

	it("rejects an unknown job and lists the real ones", async () => {
		const { deps } = setup();
		const result = await inspectJobs(deps, { job: "J-99" });
		expect(result.isError).toBe(true);
		expect(result.text).toContain("J-1");
	});

	it("rejects a cursor without a job instead of guessing which one it means", async () => {
		const { deps } = setup();
		const result = await inspectJobs(deps, { cursor: "3" });
		expect(result.isError).toBe(true);
		expect(result.text).toContain("needs a `job`");
	});
});

describe("inspect — long poll", () => {
	it("returns as soon as new output arrives, not when the window ends", async () => {
		const { deps, ring, clock } = setup();
		const waits: number[] = [];
		const result = await inspectJobs(
			{
				...deps,
				waitSlice: async (ms) => {
					waits.push(ms);
					clock.now += ms;
					if (waits.length === 2) ring.append("progress 50%\n");
				},
			},
			{ job: "J-1", waitMs: 60_000 },
		);
		expect(waits.length).toBe(2);
		expect(result.structured.jobs[0]?.tail).toContain("progress 50%");
	});

	it("stops waiting at the deadline", async () => {
		const { deps, clock } = setup();
		const startedAt = clock.now;
		await inspectJobs(
			{
				...deps,
				waitSlice: async (ms) => {
					clock.now += ms;
				},
			},
			{ job: "J-1", waitMs: 5_000 },
		);
		expect(clock.now - startedAt).toBeLessThanOrEqual(5_000 + 1_000);
	});

	it("caps waitMs with inspectWaitMaxMs", async () => {
		const { deps, clock } = setup();
		const startedAt = clock.now;
		await inspectJobs(
			{
				...deps,
				config: { ...deps.config, inspectWaitMaxMs: 2_000 },
				waitSlice: async (ms) => {
					clock.now += ms;
				},
			},
			{ job: "J-1", waitMs: 60_000 },
		);
		expect(clock.now - startedAt).toBeLessThanOrEqual(2_000 + 1_000);
	});

	it("stops waiting when the job settles", async () => {
		const { registry, deps } = setup();
		const waits: number[] = [];
		const result = await inspectJobs(
			{
				...deps,
				waitSlice: async (ms) => {
					waits.push(ms);
					registry.settle("J-1", { exitCode: 0 });
				},
			},
			{ job: "J-1", waitMs: 60_000 },
		);
		expect(waits.length).toBe(1);
		expect(result.structured.jobs[0]?.status).toBe("exited");
	});
});
