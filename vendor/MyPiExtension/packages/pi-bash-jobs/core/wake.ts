/**
 * The single wake queue (doc 129 §7.3, seam #2 of doc 132 §10).
 *
 * Every path that wants to wake the model — a finished background job, a killed job, and later
 * doc 132's condition matches — goes through here, so there is exactly one coalescing window and
 * one hourly gate. Two implementations of "when may I call sendMessage" is how a session turns
 * into a fountain of turns.
 */

import type { WakeNotice } from "../types.ts";

export interface WakeQueueOptions {
	/** How long notices are collected before one message is sent. */
	coalesceMs: number;
	/** Upper bound on wake messages per rolling hour. */
	maxPerHour: number;
	now?: () => number;
	/** Injected for tests; defaults to the real timers. */
	schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
	cancel?: (handle: ReturnType<typeof setTimeout>) => void;
	/** Delivers one combined message. */
	send: (text: string, notices: WakeNotice[]) => void;
}

export interface WakeQueue {
	/** Queue one notice. The same `key` twice in one window replaces the earlier text. */
	enqueue(notice: WakeNotice): void;
	/** Send now, ignoring the coalescing window (still honours the hourly gate). */
	flush(): void;
	/** Notices waiting for delivery. */
	pending(): number;
	/** Drops the timer and the buffer — session shutdown. */
	dispose(): void;
}

const HOUR_MS = 60 * 60 * 1000;
/** Longer than any realistic batch; the message lists the first few and counts the rest. */
const MAX_LISTED = 5;

export function createWakeQueue(options: WakeQueueOptions): WakeQueue {
	const now = options.now ?? (() => Date.now());
	const schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms));
	const cancel = options.cancel ?? ((handle) => clearTimeout(handle));
	const buffer: WakeNotice[] = [];
	const sentAt: number[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	const clearTimer = () => {
		if (timer !== undefined) {
			cancel(timer);
			timer = undefined;
		}
	};

	const recentSends = (): number[] => {
		const cutoff = now() - HOUR_MS;
		while (sentAt.length > 0 && (sentAt[0] as number) <= cutoff) sentAt.shift();
		return sentAt;
	};

	const compose = (notices: WakeNotice[]): string => {
		if (notices.length === 1) return (notices[0] as WakeNotice).text;
		const listed = notices.slice(0, MAX_LISTED).map((notice) => notice.text);
		if (notices.length > MAX_LISTED) listed.push(`…and ${notices.length - MAX_LISTED} more.`);
		return [`${notices.length} background notices:`, ...listed].join("\n\n");
	};

	const arm = (delayMs: number) => {
		if (disposed || timer !== undefined) return;
		const handle = schedule(() => {
			timer = undefined;
			flush();
		}, delayMs);
		// A held notice can be retried an hour later. That timer must not be the reason a host
		// process stays alive once everything else has finished (skip it in the fake-timer tests).
		(handle as { unref?: () => void }).unref?.();
		timer = handle;
	};

	const flush = () => {
		if (disposed || buffer.length === 0) return;
		const sends = recentSends();
		if (sends.length >= options.maxPerHour) {
			// Hold, don't drop: the notices are still true, they just have to wait for a slot.
			// Retry when the oldest send ages out, never sooner than a second (fake timers hate 0).
			const oldest = sends[0] as number;
			arm(Math.max(1_000, oldest + HOUR_MS - now() + 1));
			return;
		}
		clearTimer();
		const notices = buffer.splice(0, buffer.length);
		sentAt.push(now());
		options.send(compose(notices), notices);
	};

	return {
		enqueue(notice) {
			if (disposed) return;
			const existing = buffer.find((item) => item.key === notice.key);
			if (existing) {
				existing.text = notice.text;
			} else {
				buffer.push({ ...notice });
			}
			arm(options.coalesceMs);
		},
		flush() {
			flush();
		},
		pending() {
			return buffer.length;
		},
		dispose() {
			disposed = true;
			clearTimer();
			buffer.length = 0;
			sentAt.length = 0;
		},
	};
}
