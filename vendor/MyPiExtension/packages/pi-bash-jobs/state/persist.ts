/**
 * One snapshot per session (doc 129 §7.4). Busywork, not truth: pi owns session history, this
 * file only exists so a restart can *show* what a previous run had started.
 *
 * The output tail is stored separately from the record because the ring buffer is memory-only.
 * Without the tail an orphaned job is a command line that says "running" with nothing behind it,
 * which doc 104 F2 already taught us is worse than saying nothing.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { snapshotDir, snapshotPath } from "../infra/paths.ts";
import type { JobRecord } from "../types.ts";

export const SNAPSHOT_VERSION = 1;
/** 200 lines × 4 jobs is already unreadable; the rest can be re-read from the live job. */
const MAX_PERSISTED_JOBS = 20;
const MAX_TAIL_LINES = 200;

export interface PersistedJob {
	record: JobRecord;
	/** Last lines of output, so an orphan is inspectable after a restart. */
	tail: string;
}

export interface SnapshotFile {
	version: number;
	sessionId: string;
	updatedAt: string;
	jobs: PersistedJob[];
	/** Reserved for doc 132's watches — written empty, read defensively. */
	watchers: unknown[];
}

function isRecord(value: unknown): value is JobRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Partial<JobRecord>;
	return (
		typeof record.id === "string" &&
		typeof record.command === "string" &&
		typeof record.mode === "string" &&
		typeof record.status === "string" &&
		typeof record.startedAt === "number"
	);
}

/** Trim a tail to the last `MAX_TAIL_LINES` lines. */
export function trimTail(tail: string): string {
	const lines = tail.split("\n");
	return lines.length <= MAX_TAIL_LINES ? tail : lines.slice(lines.length - MAX_TAIL_LINES).join("\n");
}

/**
 * The record to persist. A kill we asked for but whose exit we could not observe (session shutdown
 * races the process death) must not be stored as `running`: the next run would show a process we
 * already killed as an orphan — and a *reused* pid would even be reported as "still live".
 */
export function projectJobRecord(record: JobRecord): JobRecord {
	if (record.status !== "running" || record.killedBy === undefined) return record;
	return { ...record, status: "killed" };
}

export function buildSnapshot(
	sessionId: string,
	jobs: { record: JobRecord; tail: string }[],
	now: number,
): SnapshotFile {
	return {
		version: SNAPSHOT_VERSION,
		sessionId,
		updatedAt: new Date(now).toISOString(),
		// Newest first: if a session ever hits the cap, the jobs a user cares about survive.
		jobs: [...jobs]
			.sort((a, b) => b.record.startedAt - a.record.startedAt)
			.slice(0, MAX_PERSISTED_JOBS)
			.map((job) => ({ record: projectJobRecord(job.record), tail: trimTail(job.tail) })),
		watchers: [],
	};
}

/**
 * Write the snapshot. Best effort by design: a read-only agent dir must not fail a bash call,
 * and losing a snapshot only costs orphan visibility (doc 129 D3 accepts that).
 */
export function saveSnapshot(file: SnapshotFile, env: NodeJS.ProcessEnv = process.env): boolean {
	try {
		mkdirSync(snapshotDir(env), { recursive: true });
		const target = snapshotPath(file.sessionId, env);
		const temporary = join(snapshotDir(env), `.${file.sessionId}.json.tmp`);
		writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, "utf8");
		renameSync(temporary, target);
		return true;
	} catch {
		return false;
	}
}

/**
 * Read the snapshot for `sessionId`. Anything unexpected — old version, corrupt JSON, jobs that
 * sat past the orphan TTL — is dropped silently: this is a convenience cache, not a ledger.
 */
export function loadSnapshot(
	sessionId: string,
	options: { now?: number; orphanTtlHours?: number; env?: NodeJS.ProcessEnv } = {},
): PersistedJob[] {
	const now = options.now ?? Date.now();
	const ttlHours = options.orphanTtlHours ?? 24;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(snapshotPath(sessionId, options.env ?? process.env), "utf8"));
	} catch {
		return [];
	}
	if (typeof parsed !== "object" || parsed === null) return [];
	const file = parsed as Partial<SnapshotFile>;
	if (file.version !== SNAPSHOT_VERSION || !Array.isArray(file.jobs)) return [];
	const cutoff = now - ttlHours * 60 * 60 * 1000;
	const kept: PersistedJob[] = [];
	for (const entry of file.jobs) {
		if (typeof entry !== "object" || entry === null) continue;
		const candidate = entry as Partial<PersistedJob>;
		if (!isRecord(candidate.record)) continue;
		if (candidate.record.startedAt < cutoff) continue;
		kept.push({ record: candidate.record, tail: typeof candidate.tail === "string" ? candidate.tail : "" });
	}
	return kept;
}
