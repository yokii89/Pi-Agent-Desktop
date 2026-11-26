import { describe, expect, it } from "vitest";
import { createWakeQueue, type WakeQueue } from "../core/wake.ts";

interface Harness {
	queue: WakeQueue;
	sent: string[];
	/** Move the clock forward; fires the queue's own timer if it is due. */
	advance(ms: number): void;
	/** Fire a queued timer regardless of the clock (models a timer that already expired). */
	fireTimer(): void;
	readonly hasTimer: boolean;
}

function harness(options: { coalesceMs?: number; maxPerHour?: number } = {}): Harness {
	const sent: string[] = [];
	let clock = 0;
	let pending: { callback: () => void; at: number } | undefined;
	const queue = createWakeQueue({
		coalesceMs: options.coalesceMs ?? 5_000,
		maxPerHour: options.maxPerHour ?? 24,
		now: () => clock,
		schedule: (callback, ms) => {
			pending = { callback, at: clock + ms };
			return 0 as unknown as ReturnType<typeof setTimeout>;
		},
		cancel: () => {
			pending = undefined;
		},
		send: (text) => sent.push(text),
	});
	const fire = () => {
		if (!pending) return;
		const { callback } = pending;
		pending = undefined;
		callback();
	};
	return {
		queue,
		sent,
		get hasTimer() {
			return pending !== undefined;
		},
		advance(ms) {
			clock += ms;
			if (pending && pending.at <= clock) fire();
		},
		fireTimer: fire,
	};
}

describe("wake queue", () => {
	it("waits for the coalescing window, then sends one message", () => {
		const h = harness({ coalesceMs: 5_000 });
		h.queue.enqueue({ key: "a", text: "job J-1 finished" });
		expect(h.queue.pending()).toBe(1);
		expect(h.sent).toHaveLength(0);
		h.advance(4_000);
		expect(h.sent).toHaveLength(0);
		h.advance(1_000);
		expect(h.sent).toEqual(["job J-1 finished"]);
	});

	it("coalesces several notices into one message and counts the overflow", () => {
		const h = harness({ coalesceMs: 1_000 });
		h.queue.enqueue({ key: "a", text: "job J-1 finished" });
		h.queue.enqueue({ key: "b", text: "job J-2 finished" });
		h.advance(1_000);
		expect(h.sent).toHaveLength(1);
		expect(h.sent[0]).toContain("2 background notices");
		expect(h.sent[0]).toContain("job J-1 finished");
	});

	it("collapses duplicates by key inside one window", () => {
		const h = harness({ coalesceMs: 0 });
		h.queue.enqueue({ key: "same", text: "first" });
		h.queue.enqueue({ key: "same", text: "second" });
		expect(h.queue.pending()).toBe(1);
		h.queue.flush();
		expect(h.sent).toEqual(["second"]);
	});

	it("flush sends immediately without waiting for the window", () => {
		const h = harness({ coalesceMs: 60_000 });
		h.queue.enqueue({ key: "a", text: "x" });
		h.queue.flush();
		expect(h.sent).toEqual(["x"]);
	});

	it("holds notices once the hourly gate is reached, and retries later", () => {
		const h = harness({ coalesceMs: 0, maxPerHour: 1 });
		h.queue.enqueue({ key: "a", text: "first" });
		h.queue.flush();
		expect(h.sent).toHaveLength(1);

		h.queue.enqueue({ key: "b", text: "second" });
		h.queue.flush();
		// Gate closed: buffered, not dropped.
		expect(h.sent).toHaveLength(1);
		expect(h.queue.pending()).toBe(1);
		expect(h.hasTimer).toBe(true);

		// Firing the retry before the hour is up must not send.
		h.fireTimer();
		expect(h.sent).toHaveLength(1);
		expect(h.queue.pending()).toBe(1);

		// An hour later the slot has aged out.
		h.advance(60 * 60 * 1000);
		h.queue.flush();
		expect(h.sent).toEqual(["first", "second"]);
	});

	it("unrefs its retry timer so a held notice cannot keep the host alive", () => {
		// The gate can hold a notice for an hour. That timer must not be the reason a host process
		// stays up after everything else finished.
		let unrefCalls = 0;
		const queue = createWakeQueue({
			coalesceMs: 10,
			maxPerHour: 24,
			schedule: () => ({ unref: () => (unrefCalls += 1) }) as unknown as ReturnType<typeof setTimeout>,
			cancel: () => {},
			send: () => {},
		});
		queue.enqueue({ key: "a", text: "x" });
		expect(unrefCalls).toBe(1);
		queue.dispose();
	});

	it("dispose drops everything still buffered", () => {
		const h = harness({ coalesceMs: 1_000 });
		h.queue.enqueue({ key: "a", text: "x" });
		h.queue.dispose();
		h.queue.flush();
		expect(h.sent).toHaveLength(0);
		expect(h.queue.pending()).toBe(0);
	});
});
