/**
 * The blocking↔background bridge (doc 129 §4). One function owns the whole decision:
 * spawn, stream into the ring, and either wait or yield.
 *
 * Every side effect that a test would otherwise have to fake out is injected: the clock, the
 * tick wait, the process factory. `shell.ts` is the only real spawn; nothing else here touches
 * the OS.
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyCommand } from "../core/classify.ts";
import {
	appendStatus,
	formatAbortedError,
	formatAttachReceipt,
	formatDetachReceipt,
	formatResultTrimNote,
	formatStoppedStatus,
	formatTimeoutError,
} from "../core/format.ts";
import type { Job, JobRegistry } from "../core/jobs.ts";
import { nextWaitAction, resolveMode, WAIT_TICK_MS } from "../core/policy.ts";
import { settleAwareWait } from "../core/wait.ts";
import { createRingBuffer, tailWithinBytes } from "../infra/ring.ts";
import type { ShellChild, ShellExit } from "../infra/shell.ts";
import type { JobLogTee } from "../infra/tee.ts";
import type { BashJobsConfig } from "../state/config.ts";
import type { DetachReason, JobMode } from "../types.ts";

export interface BashParams {
	command: string;
	timeout?: number;
	mode?: JobMode;
	label?: string;
}

export interface RunBashContext {
	cwd: string;
	env?: NodeJS.ProcessEnv;
	signal?: AbortSignal;
	/** Same callback contract as pi's tool `execute`. */
	onUpdate?: (update: { content: { type: "text"; text: string }[]; details: undefined }) => void;
	/** Notified when a blocking call has been silent for `idleWarnSec`. */
	onIdleNotice?: (job: Job, idleSec: number, detachInSec: number) => void;
}

export interface BashToolResult {
	content: { type: "text"; text: string }[];
	details: undefined;
	structuredContent?: {
		output: string;
		truncated: boolean;
		/** Present when the model-visible text was trimmed; the complete output is in this file. */
		full_output_path?: string;
		exit_code?: number;
		wall_time_seconds: number;
		job_id: string;
		status: "exited" | "detached" | "killed";
	};
	isError?: boolean;
}

export interface RunBashDeps {
	config: BashJobsConfig;
	registry: JobRegistry;
	now: () => number;
	/** Spawns the shell child. Injected in tests. */
	spawn: (request: { command: string; cwd: string; env?: NodeJS.ProcessEnv }) => ShellChild;
	/** Wait one slice; resolves early when the job settles. Injected in tests. */
	waitTick?: (ms: number, job: Job) => Promise<void>;
	/** Writes the complete output and returns its path; injected in tests (default: a temp file). */
	writeFullOutput?: (jobId: string, text: string) => string | undefined;
	/** How many lines a receipt/result carries. */
	receiptLines?: number;
	/** Per-session job log tee (方案 B); provider because the tool outlives sessions. */
	tee?: () => JobLogTee | undefined;
}

const DEFAULT_RECEIPT_LINES = 20;
const UPDATE_THROTTLE_MS = 100;

function textResult(text: string, extra: Partial<BashToolResult> = {}): BashToolResult {
	return { content: [{ type: "text", text }], details: undefined, ...extra };
}

/**
 * Why the text above is not everything: either whole lines were dropped, or one over-long line was
 * shortened. Both must be said out loud, or a capped tail reads like complete output.
 */
function truncationNote(stats: { truncated: boolean; lines: number; nextSeq: number }): string {
	const total = stats.nextSeq - 1;
	if (total > stats.lines) {
		return `[Showing the last ${stats.lines} of ${total} lines. Older output was dropped by the job ring buffer.]`;
	}
	if (stats.truncated) return "[An over-long output line was trimmed by the job ring buffer.]";
	return "";
}

/**
 * What the model reads: the last `maxLines`/`maxBytes`, like pi's own bash. The ring keeps more than
 * this on purpose, so a chatty command cannot spend the whole context window on one call.
 */
function tailForModel(
	text: string,
	limits: { maxBytes: number; maxLines: number },
): { text: string; trimmed: boolean } {
	let result = text;
	let trimmed = false;
	const lines = result.split("\n");
	if (lines.length > limits.maxLines) {
		result = lines.slice(lines.length - limits.maxLines).join("\n");
		trimmed = true;
	}
	const bounded = tailWithinBytes(result, limits.maxBytes);
	if (bounded !== result) {
		// A byte cut can land inside a line, leaving a half-line at the top: start at the next break so
		// what the model reads is whole lines only.
		const nextBreak = bounded.indexOf("\n");
		result = nextBreak >= 0 ? bounded.slice(nextBreak + 1) : bounded;
		trimmed = true;
	}
	return { text: result, trimmed };
}

/** Default spill file: the complete output stays available after the model-visible text was trimmed. */
function writeSpillFile(jobId: string, text: string): string | undefined {
	const file = join(tmpdir(), `pi-bash-jobs-${jobId}-${Date.now()}.log`);
	try {
		writeFileSync(file, text, "utf8");
		return file;
	} catch {
		return undefined;
	}
}

export async function runBash(deps: RunBashDeps, params: BashParams, context: RunBashContext): Promise<BashToolResult> {
	const { config, registry } = deps;
	const classified = classifyCommand(params.command, {
		extraDetachPatterns: config.extraDetachPatterns,
		extraLongPatterns: config.extraLongPatterns,
	});
	const hasExplicitTimeout = typeof params.timeout === "number" && params.timeout > 0;
	const decision = resolveMode({
		requestedMode: params.mode,
		explicitTimeoutSec: params.timeout,
		classified,
		hasExplicitTimeout,
	});

	const ring = createRingBuffer(config.output);
	const startedAt = deps.now();
	const receiptLines = deps.receiptLines ?? DEFAULT_RECEIPT_LINES;

	let child: ShellChild;
	try {
		child = deps.spawn({ command: params.command, cwd: context.cwd, env: context.env });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return textResult(`Failed to start command: ${message}`, { isError: true });
	}

	const job = registry.create({
		command: params.command,
		label: params.label,
		mode: decision.mode,
		reason: decision.reason,
		pid: child.pid,
		kill: () => child.kill(),
		ring,
	});

	// 方案 B：committed lines tee 到作业日志（stripAnsi 后），PiDesk 详情页签增量 tail。
	// attach 在同一同步块里紧随 create，child.onData 的首批 commit 不可能先于订阅到达。
	deps.tee?.()?.attach(job.id, ring);

	// Output path: ring for retention, throttled onUpdate for the streaming tool row — the frame
	// payload is capped like pi's own per-frame snapshot (see flushUpdate). Once the call returns
	// (detach or finish) the UI stops receiving updates — the job keeps the ring.
	let acceptingOutput = true;
	let lastUpdateAt = 0;
	let updateTimer: NodeJS.Timeout | undefined;
	const flushUpdate = () => {
		if (!acceptingOutput || !context.onUpdate) return;
		lastUpdateAt = deps.now();
		// Same size class as pi's native streaming frames (the result cap, 50KB/2000 lines), not
		// the whole ring: the row does a full-replace render, and at 10 Hz a 256 KB frame means
		// 2.5 MB/s of serialization for output the model will never read in full. The complete
		// text still goes out with the final result, and the ring keeps everything for inspect.
		const text = ring.tailWithin(config.resultMaxLines, config.resultMaxBytes);
		context.onUpdate({ content: [{ type: "text", text }], details: undefined });
	};
	const scheduleUpdate = () => {
		if (!acceptingOutput || !context.onUpdate) return;
		const elapsed = deps.now() - lastUpdateAt;
		if (elapsed >= UPDATE_THROTTLE_MS) {
			flushUpdate();
			return;
		}
		updateTimer ??= setTimeout(() => {
			updateTimer = undefined;
			flushUpdate();
		}, UPDATE_THROTTLE_MS - elapsed);
	};

	child.onData((chunk) => {
		// Silence is measured in bytes, not in committed lines: a command drawing one long progress line
		// (no newline, no `\r`) is producing output, and calling it "silent" would be a lie in the
		// notice and a premature yield.
		job.lastOutputAt = deps.now();
		if (!acceptingOutput) {
			// Past the return we still keep the ring current: inspect reads from it.
			ring.append(chunk);
			return;
		}
		ring.append(chunk);
		scheduleUpdate();
	});

	let settledExit: ShellExit | undefined;
	void child.exited.then((exit) => {
		settledExit = exit;
		registry.settle(job.id, { exitCode: exit.exitCode, killedBy: job.killedBy });
	});

	context.onUpdate?.({ content: [], details: undefined });

	const stopAccepting = () => {
		acceptingOutput = false;
		if (updateTimer) {
			clearTimeout(updateTimer);
			updateTimer = undefined;
		}
	};

	const finishWithOutput = (text: string, isError: boolean): BashToolResult => {
		const stats = ring.stats();
		const raw = text || "(no output)";
		const limits = { maxBytes: config.resultMaxBytes, maxLines: config.resultMaxLines };
		const model = tailForModel(raw, limits);
		const droppedByRing = stats.truncated;
		const fullPath = model.trimmed ? (deps.writeFullOutput ?? writeSpillFile)(job.id, raw) : undefined;
		let body = model.text;
		if (model.trimmed) body = appendStatus(body, formatResultTrimNote(limits, fullPath));
		body = appendStatus(body, truncationNote(stats));
		const structuredContent: NonNullable<BashToolResult["structuredContent"]> = {
			output: model.text,
			truncated: droppedByRing || model.trimmed,
			wall_time_seconds: Math.round((deps.now() - startedAt) / 100) / 10,
			job_id: job.id,
			status: job.status === "killed" ? "killed" : "exited",
		};
		if (fullPath !== undefined) structuredContent.full_output_path = fullPath;
		if (job.exitCode !== undefined) structuredContent.exit_code = job.exitCode;
		return { content: [{ type: "text", text: body }], details: undefined, structuredContent, isError };
	};

	const detach = (reason: DetachReason): BashToolResult => {
		stopAccepting();
		job.markDetached();
		const record = job.snapshot();
		const receipt = formatDetachReceipt({
			job: record,
			reason,
			tail: ring.tail(receiptLines),
			tailLines: receiptLines,
			now: deps.now(),
		});
		const stats = ring.stats();
		return {
			content: [{ type: "text", text: receipt }],
			details: undefined,
			structuredContent: {
				output: ring.tail(receiptLines),
				truncated: stats.truncated,
				wall_time_seconds: Math.round((deps.now() - startedAt) / 100) / 10,
				job_id: job.id,
				status: "detached",
			},
		};
	};

	// mode=detach: resolve immediately, and only for a real service. No timeout applies — doc 129 §4
	// keeps the background path kill-free, and the receipt says so instead of silently arming a timer.
	if (decision.mode === "detach") {
		stopAccepting();
		job.markDetached();
		const record = job.snapshot();
		const receipt = formatAttachReceipt(record, hasExplicitTimeout ? params.timeout : undefined);
		return {
			content: [{ type: "text", text: receipt }],
			details: undefined,
			structuredContent: {
				output: "",
				truncated: false,
				wall_time_seconds: 0,
				job_id: job.id,
				status: "detached",
			},
		};
	}

	// mode=long blocks through its grace window first (doc 06 §7): a `long` command that finishes in
	// 20s is an ordinary blocking call — filing a job for it would arm a wake and draw a background
	// badge for work that was already over. `detach` skips this, because a dev server is expected
	// to keep running and blocking on it is exactly what this extension exists to avoid.
	const waitTick = deps.waitTick ?? settleAwareWait;
	let abortRequested = false;
	const onAbort = () => {
		abortRequested = true;
		registry.kill(job.id, "user");
	};
	if (context.signal) {
		if (context.signal.aborted) onAbort();
		else context.signal.addEventListener("abort", onAbort, { once: true });
	}
	const detachAbort = () => context.signal?.removeEventListener("abort", onAbort);

	const waitForMode = async (mode: JobMode): Promise<DetachReason | null> => {
		let idleWarned = false;
		for (;;) {
			if (settledExit !== undefined) return null;
			const now = deps.now();
			const action = nextWaitAction({
				mode,
				elapsedMs: now - startedAt,
				idleMs: now - job.lastOutputAt,
				idleWarned,
				explicitTimeoutSec: hasExplicitTimeout ? params.timeout : undefined,
				config,
			});
			if (action.action === "kill") {
				registry.kill(job.id, "timeout");
				// Bounded: taskkill can fail on a stuck process, and hanging here would be the exact
				// failure mode this extension exists to remove.
				await Promise.race([job.exited, waitTick(5_000, job)]);
				return null;
			}
			if (action.action === "notify") {
				idleWarned = true;
				context.onIdleNotice?.(job, action.idleSec, config.idleDetachSec);
				continue;
			}
			if (action.action === "detach") {
				detachAbort();
				flushUpdate();
				return action.reason;
			}
			await waitTick(WAIT_TICK_MS, job);
		}
	};

	try {
		if (decision.mode === "long") {
			const reason = await waitForMode("long");
			if (reason !== null) return detach(reason);
		} else {
			const reason = await waitForMode("finish");
			if (reason !== null) return detach(reason);
		}
	} finally {
		detachAbort();
	}

	stopAccepting();
	if (abortRequested) throw new Error(formatAbortedError(ring.tail(receiptLines)));
	if (job.killedBy === "timeout" && hasExplicitTimeout) {
		throw new Error(formatTimeoutError(params.timeout as number, ring.tail(receiptLines)));
	}
	if (!settledExit) {
		// Killed but the exit never arrived within the bound: report the timeout rather than lie.
		throw new Error(formatTimeoutError(params.timeout ?? 0, ring.tail(receiptLines)));
	}
	const exit: ShellExit = settledExit;
	if (exit.error) {
		// A bad cwd or a missing shell is reported *asynchronously* by Node, so the try/catch around
		// `spawn()` never sees it. Handle it here, and drop the job: it never ran, so leaving it as an
		// "exited" job with no exit code would only confuse the next inspect.
		registry.remove(job.id);
		return textResult(`Failed to start command: ${exit.error.message}`, { isError: true });
	}
	if (job.killedBy) {
		// Somebody stopped this call while it was blocking (bash_job_stop, session shutdown). The
		// shell's incidental exit code would read as "your command failed".
		return finishWithOutput(appendStatus(ring.text(), formatStoppedStatus(job.killedBy)), true);
	}
	if (exit.exitCode === null) {
		return finishWithOutput(appendStatus(ring.text(), "Command terminated without an exit code"), true);
	}
	if (exit.exitCode !== 0) {
		return finishWithOutput(appendStatus(ring.text(), `Command exited with code ${exit.exitCode}`), true);
	}
	return finishWithOutput(ring.text(), false);
}
