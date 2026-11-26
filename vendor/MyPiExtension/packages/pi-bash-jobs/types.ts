/**
 * Shared value types. No behavior, no imports — everything here is copied into a tool
 * result, a wake message or a persisted snapshot verbatim.
 *
 * Shape discipline comes from docs/design/129 §4: a job has one mode (how it was decided)
 * and one status (what the process is doing). The two are never merged: `mode` explains
 * why bash yielded, `status` says whether the process is still alive.
 */

/** How a command was classified (doc 129 §4). */
export type JobMode = "finish" | "detach" | "long";

/**
 * `orphaned` is not "gone": it is a job restored from a snapshot whose exit we can no
 * longer observe (doc 129 §7.4 — `null` is not "exited", see doc 104 F2).
 */
export type JobStatus = "running" | "exited" | "killed" | "orphaned";

/** Who ended the process. Only these three paths may ever kill a job (doc 129 §4). */
export type KillReason = "timeout" | "user" | "model";

/** Why a `finish` call stopped blocking (and why a `long` call finally did). */
export type DetachReason = "idle" | "budget" | "timeout" | "grace";

/** What the registry hands back when a process settles. */
export interface SettleInfo {
	exitCode: number | null;
	killedBy?: KillReason;
}

/** Plain, serializable view of one job. Every consumer (tool result, notice, snapshot) reads this. */
export interface JobRecord {
	id: string;
	command: string;
	label?: string;
	mode: JobMode;
	status: JobStatus;
	/** Why the mode was chosen — a matched rule, an explicit argument, `default`. */
	reason: string;
	pid?: number;
	startedAt: number;
	lastOutputAt: number;
	exitedAt?: number;
	exitCode?: number;
	killedBy?: KillReason;
	/** Set once `execute()` returned while the process was still running. */
	detached: boolean;
	/** How many bytes/lines the ring is holding right now (not lifetime totals). */
	outputBytes: number;
	outputLines: number;
}

/** Registry events. `output` is emitted per committed line, `status` on every transition. */
export type JobEvent =
	| { type: "started"; job: JobRecord }
	| { type: "output"; job: JobRecord; line: string }
	| { type: "settled"; job: JobRecord };

/** One wake-queue notice before it is turned into a message. */
export interface WakeNotice {
	/** Stable key, used to collapse duplicates inside one coalescing window. */
	key: string;
	text: string;
}
