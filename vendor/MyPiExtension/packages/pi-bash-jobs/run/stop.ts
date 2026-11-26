/**
 * `bash_job_stop` (doc 129 §6.3). The *only* deliberate kill path besides an explicit timeout.
 *
 * Windows has no SIGTERM for a process tree, so "graceful" is honest about what it can do: on
 * Unix it sends SIGTERM first and falls back to a tree kill; on Windows it is a tree kill
 * immediately. Pretending otherwise would be a receipt that lies.
 */

import { formatStopReceipt } from "../core/format.ts";
import type { Job, JobRegistry } from "../core/jobs.ts";

export interface StopInput {
	job: string;
	/** `graceful` asks the process to exit first (Unix); Windows always tree-kills. */
	signal?: "tree-kill" | "graceful";
}

export interface StopDeps {
	registry: JobRegistry;
	/** Sends a signal to the whole process group (Unix); unused on Windows. */
	signalTree: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
	sleep: (ms: number) => Promise<void>;
	/** How long a graceful stop waits for the process to exit on its own. */
	graceMs?: number;
	/** How long a hard kill waits for the exit to be observed. */
	killWaitMs?: number;
}

export interface StopOutcome {
	text: string;
	stopped: boolean;
	isError?: boolean;
}

const DEFAULT_GRACE_MS = 3_000;
const DEFAULT_KILL_WAIT_MS = 5_000;

async function waitForExit(job: Job, ms: number, sleep: (ms: number) => Promise<void>): Promise<boolean> {
	let exited = job.status !== "running";
	const probe = job.exited.then(() => {
		exited = true;
	});
	await Promise.race([probe, sleep(ms)]);
	return exited || job.status !== "running";
}

export async function stopJob(deps: StopDeps, input: StopInput): Promise<StopOutcome> {
	const { registry } = deps;
	const job = registry.get(input.job);
	if (!job) {
		const known =
			registry
				.list()
				.map((item) => item.id)
				.join(", ") || "none";
		return { text: `Unknown job "${input.job}". Known jobs: ${known}.`, stopped: false, isError: true };
	}
	if (job.status !== "running") {
		return { text: formatStopReceipt(job.snapshot(), false), stopped: false };
	}

	if (input.signal === "graceful" && process.platform !== "win32" && job.pid !== undefined) {
		deps.signalTree(job.pid, "SIGTERM");
		const exited = await waitForExit(job, deps.graceMs ?? DEFAULT_GRACE_MS, deps.sleep);
		if (exited) return { text: formatStopReceipt(job.snapshot(), true), stopped: true };
	}

	if (!registry.kill(job.id, "model")) {
		return { text: formatStopReceipt(job.snapshot(), false), stopped: false };
	}
	const waited = await waitForExit(job, deps.killWaitMs ?? DEFAULT_KILL_WAIT_MS, deps.sleep);
	if (!waited) {
		return {
			text: `Sent a tree kill to job ${job.id} but it has not exited yet. Output can still be read with tool_execution_inspect_output.`,
			stopped: false,
		};
	}
	return { text: formatStopReceipt(job.snapshot(), true), stopped: true };
}
