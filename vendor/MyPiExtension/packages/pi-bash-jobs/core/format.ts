/**
 * Model-facing and human-facing text (doc 129 §6, §7.3). Kept apart from the state machines so
 * wording can change without touching policy, and so receipts stay assertable in tests.
 *
 * Everything the *model* reads is English — same as pi's own tool results. The one exception is
 * the idle notice, which is a UI notification and therefore user-facing (`ctx.ui.notify`).
 */

import type { DetachReason, JobRecord, KillReason } from "../types.ts";
import { formatDuration } from "./policy.ts";

const MODE_NOTE: Record<JobRecord["mode"], string> = {
	finish: "blocking call",
	detach: "long-running service — never auto-killed",
	long: "long task — never auto-killed",
};

const DETACH_NOTE: Record<DetachReason, string> = {
	idle: "no output for a while",
	budget: "soft budget reached",
	timeout: "the timeout you passed expired and `explicitTimeoutKills` is off",
	grace: "still running after the `long` grace window",
};

/** pi's own wording for a killed command, so users see the message they already know. */
export function formatTimeoutError(timeoutSec: number, tail: string): string {
	return appendStatus(tail, `Command timed out after ${timeoutSec} seconds`);
}

export function formatAbortedError(tail: string): string {
	return appendStatus(tail, "Command aborted");
}

/**
 * The call was stopped by someone else (bash_job_stop, session shutdown) while it was blocking.
 * Reporting the shell's incidental exit code here would read as "the command failed".
 */
export function formatStoppedStatus(killedBy: KillReason): string {
	return `Command stopped (killed by ${killedBy})`;
}

/**
 * Result-side trim note (doc: the model reads at most `resultMaxBytes`/`resultMaxLines`, pi's own
 * bash caps too). The path is the point: without it the trimmed tail is all the model will ever see.
 */
export function formatResultTrimNote(
	limits: { maxBytes: number; maxLines: number },
	fullPath: string | undefined,
): string {
	const head = `[Output trimmed to the last ${limits.maxLines} lines / ${formatBytes(
		limits.maxBytes,
	)} for the model.]`;
	return fullPath ? `${head}\nFull output: ${fullPath}` : `${head}\nThe full output could not be written to a file.`;
}

export function appendStatus(text: string, status: string): string {
	if (!status) return text;
	return text ? `${text}\n\n${status}` : status;
}

export function jobTitle(job: JobRecord): string {
	return job.label ? `${job.id} (${job.label})` : job.id;
}

/** Short one-liner used by `/bash-jobs` and by inspect headers. */
export function formatJobLine(job: JobRecord, now: number): string {
	const end = job.exitedAt ?? now;
	const duration = formatDuration(Math.max(0, end - job.startedAt));
	const exit = job.exitCode === undefined ? "" : ` exit=${job.exitCode}`;
	const killed = job.killedBy ? ` killed-by=${job.killedBy}` : "";
	const size = `${formatBytes(job.outputBytes)}/${job.outputLines} lines`;
	return `${job.id}  ${job.status}${exit}${killed}  ${duration}  mode=${job.mode}  ${job.command}  (${size})`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export interface DetachReceiptInput {
	job: JobRecord;
	reason: DetachReason;
	tail: string;
	tailLines: number;
	now: number;
}

/**
 * What the model sees instead of a result. It must answer three questions in one screen:
 * is the process still running, where is the job id, and how do I continue or stop it.
 */
export function formatDetachReceipt(input: DetachReceiptInput): string {
	const { job } = input;
	const duration = formatDuration(Math.max(0, input.now - job.startedAt));
	const lines = [
		`Job ${jobTitle(job)} moved to the background after ${duration} (${DETACH_NOTE[input.reason]}).`,
		`Command: ${job.command}`,
		`Mode: ${job.mode} — ${MODE_NOTE[job.mode]}. The process is still running; nothing was killed.`,
		"",
		`Output so far (last ${input.tailLines} lines):`,
		input.tail || "(no output yet)",
		"",
		"Next:",
		`- read progress: tool_execution_inspect_output({ job: "${job.id}" })`,
		`- wait for more output: tool_execution_inspect_output({ job: "${job.id}", waitMs: 60000 })`,
		`- stop it: bash_job_stop({ job: "${job.id}" })`,
		`- it keeps running after this turn ends${job.mode === "long" ? "; you will be woken when it exits" : ""}.`,
	];
	return lines.join("\n");
}

/** Immediate confirmation for `mode:"detach"` / `mode:"long"` (no blocking, no output yet). */
export function formatAttachReceipt(job: JobRecord, ignoredTimeoutSec?: number): string {
	const ignored =
		ignoredTimeoutSec !== undefined
			? `\nNote: the timeout=${ignoredTimeoutSec}s you passed is ignored for mode=${job.mode} — it only applies to blocking calls. Use bash_job_stop to end it.`
			: "";
	return (
		[
			`Job ${jobTitle(job)} started in the background (mode=${job.mode}).`,
			`Command: ${job.command}`,
			"",
			"Nothing is blocked: continue with other work and read progress with",
			`tool_execution_inspect_output({ job: "${job.id}" }) — or wait inside one call with waitMs.`,
			job.mode === "long" ? "You will be woken when it exits." : "Long-running services are never auto-killed.",
		].join("\n") + ignored
	);
}

/** UI notification when a blocking call has been silent for a while. */
export function formatIdleNotice(job: JobRecord, idleSec: number, detachInSec: number): string {
	const where = job.detached ? "background job" : "bash";
	const next = detachInSec > 0 ? ` — moving to background in ${detachInSec}s` : "";
	return `${where} ${job.id} has had no output for ${idleSec}s${next}: ${job.command}`;
}

/** Background job finished → the wake message (doc 129 §7.3). */
export function formatJobExitNotice(job: JobRecord, tail: string): string {
	const duration = formatDuration(Math.max(0, (job.exitedAt ?? job.startedAt) - job.startedAt));
	const outcome =
		job.status === "killed" ? `killed (${job.killedBy ?? "unknown"})` : `exit ${job.exitCode ?? "unknown"}`;
	const head = [`Bash job ${jobTitle(job)} finished: ${outcome} after ${duration}.`, `Command: ${job.command}`].join(
		"\n",
	);
	return [
		head,
		"",
		`Last output (tail):`,
		tail || "(no output)",
		"",
		`Read the rest: tool_execution_inspect_output({ job: "${job.id}" }).`,
	].join("\n");
}

export function formatStopReceipt(job: JobRecord, killed: boolean): string {
	if (!killed) {
		return job.status === "running"
			? `Job ${jobTitle(job)} could not be stopped (no process handle — it may be orphaned from a previous pi run).`
			: `Job ${jobTitle(job)} is already ${job.status}${
					job.exitCode === undefined ? "" : ` (exit ${job.exitCode})`
				}.`;
	}
	return `Stopped job ${jobTitle(job)}: killed the whole process tree (killedBy=${job.killedBy ?? "model"}).`;
}

/** `/bash-jobs` output. No jobs is a normal state, not an error. */
export function formatJobList(jobs: JobRecord[], now: number): string {
	if (jobs.length === 0) return "No bash jobs in this session.";
	const running = jobs.filter((job) => job.status === "running").length;
	const lines = [`${jobs.length} bash job(s), ${running} running:`, ""];
	for (const job of jobs) lines.push(formatJobLine(job, now));
	return lines.join("\n");
}
