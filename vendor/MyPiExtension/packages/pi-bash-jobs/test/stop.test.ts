import { describe, expect, it } from "vitest";
import { createJobRegistry } from "../core/jobs.ts";
import { createRingBuffer } from "../infra/ring.ts";
import { stopJob } from "../run/stop.ts";

const limits = { maxBytes: 4_096, maxLines: 100 };

function setup(options: { settleOnKill?: boolean } = {}) {
	const registry = createJobRegistry({ now: () => 0 });
	let killed = false;
	const ring = createRingBuffer(limits);
	const job = registry.create({
		command: "pnpm dev",
		mode: "detach",
		reason: "vite",
		pid: 4242,
		ring,
		kill: () => {
			killed = true;
			// The OS reports the exit right after the tree kill — unless the test wants it lost.
			if (options.settleOnKill !== false) registry.settle(job.id, { exitCode: null, killedBy: job.killedBy });
		},
	});
	const deps = {
		registry,
		signalTree: (_pid: number, _signal: "SIGTERM" | "SIGKILL") => {},
		sleep: async () => {},
	};
	return { registry, job, deps, wasKilled: () => killed };
}

describe("stopJob", () => {
	it("kills a running job and reports the tree kill", async () => {
		const { deps, wasKilled } = setup();
		const outcome = await stopJob(deps, { job: "J-1" });
		expect(outcome.stopped).toBe(true);
		expect(wasKilled()).toBe(true);
		expect(outcome.text).toContain("Stopped job J-1");
	});

	it("does nothing to a job that already exited", async () => {
		const { deps, registry, job, wasKilled } = setup();
		registry.settle(job.id, { exitCode: 0 });
		const outcome = await stopJob(deps, { job: "J-1" });
		expect(outcome.stopped).toBe(false);
		expect(wasKilled()).toBe(false);
		expect(outcome.text).toContain("already exited");
	});

	it("rejects an unknown job id", async () => {
		const { deps } = setup();
		const outcome = await stopJob(deps, { job: "J-9" });
		expect(outcome.isError).toBe(true);
		expect(outcome.text).toContain("Unknown job");
	});

	it("graceful sends SIGTERM first and stops when the process obeys", async () => {
		const { deps, registry, job } = setup();
		const signals: string[] = [];
		const outcome = await stopJob(
			{
				...deps,
				signalTree: (_pid, signal) => {
					signals.push(signal);
					registry.settle(job.id, { exitCode: 0 });
				},
			},
			{ job: "J-1", signal: "graceful" },
		);
		expect(signals).toEqual(["SIGTERM"]);
		expect(outcome.stopped).toBe(true);
	});

	it("graceful falls back to a tree kill when the process ignores SIGTERM", async () => {
		const { deps, registry, job, wasKilled } = setup();
		const outcome = await stopJob({ ...deps, signalTree: () => {} }, { job: "J-1", signal: "graceful" });
		expect(outcome.stopped).toBe(true);
		expect(wasKilled()).toBe(true);
		expect(registry.get(job.id)?.killedBy).toBe("model");
	});

	it("reports an unobserved exit instead of claiming success", async () => {
		const { deps, job } = setup({ settleOnKill: false });
		// The killer never reports back: the receipt must not say "stopped".
		const outcome = await stopJob({ ...deps, killWaitMs: 10 }, { job: "J-1" });
		expect(outcome.stopped).toBe(false);
		expect(outcome.text).toContain("has not exited yet");
		expect(job.status).toBe("running");
	});
});
