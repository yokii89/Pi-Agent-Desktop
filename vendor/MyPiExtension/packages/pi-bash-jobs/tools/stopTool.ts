/**
 * `bash_job_stop` tool wiring. The decision logic lives in `stop.ts`; this file is the schema
 * and the process-layer injection.
 */

import type { ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { JobRegistry } from "../core/jobs.ts";
import { signalProcessGroup } from "../infra/shell.ts";
import { type StopInput, stopJob } from "../run/stop.ts";

const StopParams = Type.Object({
	job: Type.String({ description: "Job id to stop (`J-3`)" }),
	signal: Type.Optional(
		Type.Union([Type.Literal("tree-kill"), Type.Literal("graceful")], {
			description:
				"tree-kill (default) kills the whole process tree immediately. graceful asks the process to exit first, then falls back to a tree kill (Unix only; Windows always tree-kills).",
		}),
	),
});

const DESCRIPTION = [
	"Stop a background bash job started by this extension.",
	"",
	"Kills the whole process tree — not just the shell — so a dev server's children do not survive as orphans. Use this instead of `taskkill`/`kill` from bash: a bare pid cannot be told apart from a reused one.",
	"",
	"Stopping a job is the only deliberate way to end a dev server or a long task; they are never killed automatically.",
].join("\n");

export interface StopToolDeps {
	registry: JobRegistry;
	/** Called before the kill so the settle event does not also wake the model. */
	onModelStopped?: (jobId: string) => void;
	sleep?: (ms: number) => Promise<void>;
}

export function createStopTool(deps: StopToolDeps): ToolDefinition<typeof StopParams, undefined> {
	return {
		name: "bash_job_stop",
		label: "stop bash job",
		description: DESCRIPTION,
		promptSnippet: "Stop a background bash job (kills the process tree)",
		parameters: StopParams,
		async execute(
			_toolCallId,
			params: StopInput,
			_signal: AbortSignal | undefined,
			_onUpdate,
			_ctx: ExtensionToolContext,
		) {
			// Suppress the wake *before* the kill: the settle event fires while `stopJob` waits for
			// the exit, so suppressing afterwards would arrive too late.
			if (deps.registry.get(params.job)?.status === "running") deps.onModelStopped?.(params.job);
			const outcome = await stopJob(
				{
					registry: deps.registry,
					signalTree: (pid, signal) => signalProcessGroup(pid, signal),
					sleep: deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
				},
				params,
			);
			return {
				content: [{ type: "text" as const, text: outcome.text }],
				details: undefined,
				...(outcome.isError ? { isError: true } : {}),
			};
		},
	};
}
