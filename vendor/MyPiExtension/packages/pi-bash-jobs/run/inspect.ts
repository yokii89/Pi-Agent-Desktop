/**
 * `tool_execution_inspect_output` (doc 129 §6.1). Read-only by contract: it never stops or
 * kills anything, so a model that is unsure can look without changing the world.
 *
 * The long poll (`waitMs`) is the point of the tool: without it, watching a 20-minute build
 * costs a full turn per look. It returns as soon as *any* target job produces a line, not when
 * the window ends.
 */

import { formatBytes, formatJobLine } from "../core/format.ts";
import type { Job, JobRegistry } from "../core/jobs.ts";
import { formatDuration } from "../core/policy.ts";
import { settleAwareWait, type WaitSlice } from "../core/wait.ts";
import type { BashJobsConfig } from "../state/config.ts";

export interface InspectInput {
	job?: string;
	tailLines?: number;
	cursor?: string;
	waitMs?: number;
	grep?: string;
}

export interface InspectJobView {
	id: string;
	command: string;
	label?: string;
	mode: string;
	status: string;
	reason: string;
	exitCode?: number;
	killedBy?: string;
	detached: boolean;
	startedAt: string;
	lastOutputAt: string;
	idleSec: number;
	durationSec: number;
	bytes: number;
	lines: number;
	cursor: string;
	lost: boolean;
	tail: string;
}

export interface InspectResult {
	text: string;
	structured: { jobs: InspectJobView[] };
	isError?: boolean;
}

export interface InspectDeps {
	registry: JobRegistry;
	config: BashJobsConfig;
	now: () => number;
	waitSlice?: WaitSlice;
	/** Long-poll granularity. Tests shorten it; production 1s is enough. */
	waitStepMs?: number;
}

const DEFAULT_WAIT_STEP_MS = 1_000;

function clampTailLines(input: number | undefined, config: BashJobsConfig): number {
	const requested = typeof input === "number" && Number.isFinite(input) ? Math.floor(input) : config.inspectTailLines;
	return Math.max(1, Math.min(requested, config.inspectMaxTailLines));
}

function grepLines(lines: string[], pattern: string | undefined): string[] {
	if (!pattern) return lines;
	const needle = pattern.toLowerCase();
	return lines.filter((line) => line.toLowerCase().includes(needle));
}

function viewOf(job: Job, input: InspectInput, tailLines: number, now: number): InspectJobView {
	const record = job.snapshot();
	const since = input.cursor !== undefined ? job.ring.since(input.cursor) : job.ring.since();
	const tail = grepLines(since.lines, input.grep).slice(-tailLines).join("\n");
	return {
		id: record.id,
		command: record.command,
		label: record.label,
		mode: record.mode,
		status: record.status,
		reason: record.reason,
		exitCode: record.exitCode,
		killedBy: record.killedBy,
		detached: record.detached,
		startedAt: new Date(record.startedAt).toISOString(),
		lastOutputAt: new Date(record.lastOutputAt).toISOString(),
		idleSec: Math.max(0, Math.round((now - record.lastOutputAt) / 1000)),
		durationSec: Math.max(0, Math.round(((record.exitedAt ?? now) - record.startedAt) / 1000)),
		bytes: record.outputBytes,
		lines: record.outputLines,
		cursor: job.ring.cursor(),
		lost: since.lost,
		tail,
	};
}

function formatDetail(view: InspectJobView, input: InspectInput): string {
	const head = [
		`Job ${view.id}${view.label ? ` (${view.label})` : ""} — ${view.status}`,
		`  command: ${view.command}`,
		`  mode: ${view.mode} (${view.reason})${view.detached ? ", detached from its turn" : ""}`,
		`  ${
			view.status === "running"
				? `running for ${formatDuration(view.durationSec * 1000)}, idle ${view.idleSec}s`
				: `ended after ${formatDuration(view.durationSec * 1000)}`
		}${
			view.exitCode === undefined ? "" : `, exit ${view.exitCode}`
		}${view.killedBy ? `, killed by ${view.killedBy}` : ""}`,
		`  output: ${view.lines} lines / ${formatBytes(view.bytes)}, cursor ${view.cursor}${
			view.lost ? " (older lines dropped — the cursor you passed is gone)" : ""
		}`,
	];
	const filter = input.grep ? ` (filtered by "${input.grep}")` : "";
	const tailHeader = view.tail ? `  tail${filter}:` : `  tail${filter}: (no new output)`;
	return [...head, tailHeader, ...view.tail.split("\n").map((line) => `    ${line}`)].join("\n");
}

function formatSummary(jobs: Job[], now: number): string {
	const lines = [`${jobs.length} job(s):`, ""];
	for (const job of jobs) lines.push(formatJobLine(job.snapshot(), now));
	lines.push("", "Pass `job` to read one job's tail, `cursor` for only new lines, `waitMs` to wait for output.");
	return lines.join("\n");
}

export async function inspectJobs(
	deps: InspectDeps,
	input: InspectInput,
	signal?: AbortSignal,
): Promise<InspectResult> {
	const { registry, config } = deps;
	const now = deps.now;
	const waitStepMs = deps.waitStepMs ?? DEFAULT_WAIT_STEP_MS;

	let targets: Job[];
	if (input.job) {
		const job = registry.get(input.job);
		if (!job) {
			const known =
				registry
					.list()
					.map((item) => item.id)
					.join(", ") || "none";
			return {
				text: `Unknown job "${input.job}". Known jobs: ${known}. Call without \`job\` to list them.`,
				structured: { jobs: [] },
				isError: true,
			};
		}
		targets = [job];
	} else {
		targets = registry.list();
	}
	if (targets.length === 0) {
		return { text: "No bash jobs in this session.", structured: { jobs: [] } };
	}
	if (input.cursor !== undefined && !input.job) {
		return {
			text: "`cursor` needs a `job`: cursors are per job, and passing one without a job is ambiguous.",
			structured: { jobs: [] },
			isError: true,
		};
	}

	const requestedWait = typeof input.waitMs === "number" && Number.isFinite(input.waitMs) ? input.waitMs : 0;
	const waitMs = Math.max(0, Math.min(requestedWait, config.inspectWaitMaxMs));
	if (waitMs > 0) {
		const cursors = new Map(targets.map((job) => [job.id, job.ring.cursor()]));
		const deadline = now() + waitMs;
		const waitSlice = deps.waitSlice ?? settleAwareWait;
		while (now() < deadline) {
			if (signal?.aborted) break;
			const changed =
				targets.some((job) => job.ring.cursor() !== cursors.get(job.id)) ||
				targets.some((job) => job.status !== "running");
			if (changed) break;
			const remaining = deadline - now();
			const slice = Math.min(waitStepMs, Math.max(1, remaining));
			// Wait on the first target; the loop re-checks all of them, so one wakeup is enough.
			await waitSlice(slice, targets[0] as Job);
		}
	}

	const currentNow = now();
	const tailLines = clampTailLines(input.tailLines, config);
	const views = targets.map((job) => viewOf(job, input, tailLines, currentNow));
	const text = input.job ? formatDetail(views[0] as InspectJobView, input) : formatSummary(targets, currentNow);
	return { text, structured: { jobs: views } };
}
