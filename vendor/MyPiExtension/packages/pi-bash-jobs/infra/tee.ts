/**
 * Job log tee (方案 B / PiDesk 对接 §5): raw bytes keep flowing into the ring unchanged;
 * committed lines are additionally written — stripped of ANSI escapes — to
 * `<agentDir>/bash-jobs/logs/<sessionId>/<jobId>.log`, so the desktop host can tail a job's
 * stdout in real time (the pipes themselves belong to the shell the extension spawned and are
 * not attachable after the fact).
 *
 * Writes are buffered and flushed on a short debounce (a chatty job must not hit the disk per
 * line), each job's file is capped at `maxBytes`, and past the cap the tee stops writing and
 * leaves a marker line instead of pretending the log is complete.
 */

import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripAnsi } from "./ansi.ts";

/** Minimal surface of the ring the tee needs (duck-typed so tests can pass a stub). */
export interface TeeRingSource {
	onCommit(listener: (line: string) => void): () => void;
}

export interface JobLogTee {
	/** Subscribes the tee to the job's ring; commits land in `<dir>/<jobId>.log`. */
	attach(jobId: string, ring: TeeRingSource): void;
	/** Flush every pending buffer (job settle / session shutdown). */
	flushAll(): void;
	/** Stop accepting lines and flush (session shutdown). */
	dispose(): void;
}

export interface JobLogTeeOptions {
	/** Directory for per-job logs (`<agentDir>/bash-jobs/logs/<sessionId>`). */
	dir: string;
	/** Hard cap per log file; past it the tee stops writing and marks the truncation. */
	maxBytes: number;
	/** Debounce for buffered writes; defaults to 250ms. */
	flushMs?: number;
}

const TRUNCATION_MARKER = "[job log truncated: the tee cap was reached; output continues in the ring]";

interface TeeEntry {
	path: string;
	unsubscribe: () => void;
	buffer: string[];
	/** Bytes already on disk (0 when the file does not exist yet). */
	writtenBytes: number;
	stopped: boolean;
}

export function createJobLogTee(options: JobLogTeeOptions): JobLogTee {
	const { dir, maxBytes } = options;
	const flushMs = options.flushMs ?? 250;
	const entries = new Map<string, TeeEntry>();
	let flushTimer: ReturnType<typeof setTimeout> | undefined;
	let dirReady = false;

	const ensureDir = (): void => {
		if (dirReady) return;
		mkdirSync(dir, { recursive: true });
		dirReady = true;
	};

	const fileSize = (path: string): number => {
		try {
			return statSync(path).size;
		} catch {
			return 0;
		}
	};

	const scheduleFlush = (): void => {
		if (flushTimer) return;
		flushTimer = setTimeout(() => {
			flushTimer = undefined;
			flushAll();
		}, flushMs);
		// A pending flush must not keep pi alive on its own (same posture as the snapshot timer).
		flushTimer.unref?.();
	};

	const flush = (entry: TeeEntry): void => {
		if (entry.buffer.length === 0) return;
		const text = entry.buffer.join("");
		entry.buffer = [];
		try {
			ensureDir();
			appendFileSync(entry.path, text, "utf8");
			entry.writtenBytes += Buffer.byteLength(text, "utf8");
		} catch {
			// A failed log write must never take a job down; drop this batch and keep going.
		}
	};

	const commit = (entry: TeeEntry, rawLine: string): void => {
		if (entry.stopped) return;
		const line = `${stripAnsi(rawLine)}\n`;
		const lineBytes = Buffer.byteLength(line, "utf8");
		if (entry.writtenBytes + lineBytes > maxBytes) {
			entry.stopped = true;
			entry.unsubscribe();
			entry.buffer.push(`${TRUNCATION_MARKER}\n`);
			flush(entry);
			return;
		}
		entry.buffer.push(line);
		scheduleFlush();
	};

	const flushAll = (): void => {
		for (const entry of entries.values()) flush(entry);
	};

	return {
		attach(jobId, ring) {
			if (entries.has(jobId)) return;
			const path = join(dir, `${jobId}.log`);
			const entry: TeeEntry = {
				path,
				unsubscribe: () => {},
				buffer: [],
				writtenBytes: fileSize(path),
				stopped: false,
			};
			entry.unsubscribe = ring.onCommit((line) => commit(entry, line));
			entries.set(jobId, entry);
		},
		flushAll,
		dispose() {
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = undefined;
			}
			flushAll();
			for (const entry of entries.values()) entry.unsubscribe();
			entries.clear();
		},
	};
}
