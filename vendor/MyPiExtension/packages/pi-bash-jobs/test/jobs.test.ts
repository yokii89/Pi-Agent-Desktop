import { describe, expect, it } from "vitest";
import { createJobRegistry } from "../core/jobs.ts";
import { createRingBuffer } from "../infra/ring.ts";
import type { JobRecord } from "../types.ts";

const limits = { maxBytes: 64 * 1024, maxLines: 1_000 };

function makeRegistry(clock = { now: 0 }) {
	const registry = createJobRegistry({ now: () => clock.now });
	return { registry, clock };
}

function record(overrides: Partial<JobRecord> = {}): JobRecord {
	return {
		id: "J-1",
		command: "pnpm dev",
		mode: "detach",
		status: "running",
		reason: "vite",
		startedAt: 1_000,
		lastOutputAt: 1_000,
		detached: true,
		outputBytes: 0,
		outputLines: 0,
		...overrides,
	};
}

describe("job registry", () => {
	it("allocates increasing ids and starts jobs as running", () => {
		const { registry } = makeRegistry();
		const first = registry.create({
			command: "a",
			mode: "detach",
			reason: "r",
			ring: createRingBuffer(limits),
			kill: () => {},
		});
		const second = registry.create({
			command: "b",
			mode: "detach",
			reason: "r",
			ring: createRingBuffer(limits),
			kill: () => {},
		});
		expect(first.id).toBe("J-1");
		expect(second.id).toBe("J-2");
		expect(first.status).toBe("running");
	});

	it("tracks output freshness and size through the ring", () => {
		const { registry, clock } = makeRegistry();
		const ring = createRingBuffer(limits);
		const job = registry.create({ command: "a", mode: "long", reason: "r", ring, kill: () => {} });
		clock.now = 5_000;
		ring.append("hello\nworld\n");
		expect(job.lastOutputAt).toBe(5_000);
		expect(job.outputLines).toBe(2);
		expect(job.outputBytes).toBeGreaterThan(0);
	});

	it("settles once and never returns to running", async () => {
		const { registry } = makeRegistry();
		const job = registry.create({
			command: "a",
			mode: "finish",
			reason: "r",
			ring: createRingBuffer(limits),
			kill: () => {},
		});
		registry.settle(job.id, { exitCode: 0 });
		expect(job.status).toBe("exited");
		expect(job.exitCode).toBe(0);
		registry.settle(job.id, { exitCode: 3 });
		expect(job.exitCode).toBe(0);
		await expect(job.exited).resolves.toMatchObject({ exitCode: 0 });
	});

	it("records the kill reason and prefers `killed` over `exited`", () => {
		const { registry } = makeRegistry();
		const job = registry.create({
			command: "a",
			mode: "finish",
			reason: "r",
			ring: createRingBuffer(limits),
			kill: () => {},
		});
		expect(registry.kill(job.id, "timeout")).toBe(true);
		registry.settle(job.id, { exitCode: null, killedBy: "timeout" });
		expect(job.status).toBe("killed");
		expect(job.killedBy).toBe("timeout");
	});

	it("refuses to kill a settled job and to remove a running one", () => {
		const { registry } = makeRegistry();
		const job = registry.create({
			command: "a",
			mode: "finish",
			reason: "r",
			ring: createRingBuffer(limits),
			kill: () => {},
		});
		expect(registry.remove(job.id)).toBe(false);
		registry.settle(job.id, { exitCode: 0 });
		expect(registry.kill(job.id, "user")).toBe(false);
		expect(registry.remove(job.id)).toBe(true);
	});

	it("restores running records as orphaned and keeps the id sequence ahead", () => {
		const { registry } = makeRegistry();
		const ring = createRingBuffer(limits);
		ring.append("old output\n");
		const [restored] = registry.restore([{ record: record({ id: "J-7" }), ring }]);
		expect(restored?.status).toBe("orphaned");
		expect(restored?.ring.text()).toBe("old output");
		const next = registry.create({
			command: "b",
			mode: "finish",
			reason: "r",
			ring: createRingBuffer(limits),
			kill: () => {},
		});
		expect(next.id).toBe("J-8");
	});

	it("keeps an already-settled restored record's status", () => {
		const { registry } = makeRegistry();
		const [restored] = registry.restore([
			{ record: record({ id: "J-2", status: "exited", exitCode: 0 }), ring: createRingBuffer(limits) },
		]);
		expect(restored?.status).toBe("exited");
	});

	it("prunes settled jobs past the TTL but not running ones", () => {
		const { registry, clock } = makeRegistry();
		const running = registry.create({
			command: "a",
			mode: "detach",
			reason: "r",
			ring: createRingBuffer(limits),
			kill: () => {},
		});
		const finished = registry.create({
			command: "b",
			mode: "finish",
			reason: "r",
			ring: createRingBuffer(limits),
			kill: () => {},
		});
		registry.settle(finished.id, { exitCode: 0 });
		clock.now = 10 * 60 * 60 * 1000;
		expect(registry.prune(60 * 60 * 1000)).toBe(1);
		expect(registry.list().map((job) => job.id)).toEqual([running.id]);
	});

	it("emits started / settled events and reports line output", () => {
		const { registry } = makeRegistry();
		const events: string[] = [];
		registry.onEvent((event) => {
			events.push(event.type === "settled" ? `settled:${event.job.status}` : event.type);
		});
		const job = registry.create({
			command: "a",
			mode: "finish",
			reason: "r",
			ring: createRingBuffer(limits),
			kill: () => {},
		});
		registry.settle(job.id, { exitCode: 0 });
		expect(events).toEqual(["started", "settled:exited"]);
	});

	it("a throwing subscriber cannot break the registry", () => {
		const { registry } = makeRegistry();
		registry.onEvent(() => {
			throw new Error("subscriber bug");
		});
		expect(() =>
			registry.create({ command: "a", mode: "finish", reason: "r", ring: createRingBuffer(limits), kill: () => {} }),
		).not.toThrow();
	});
});
