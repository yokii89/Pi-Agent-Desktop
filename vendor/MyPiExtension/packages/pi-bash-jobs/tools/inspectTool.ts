/**
 * `tool_execution_inspect_output` (doc 129 §6.1). Named after pi's own `tool_execution_*` event
 * family on purpose: the model already knows what "tool execution output" means.
 *
 * Read-only: no stop, no kill. A model that is unsure can look without changing anything, which
 * is the whole reason this is a separate tool from `bash_job_stop`.
 */

import type { ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { JobRegistry } from "../core/jobs.ts";
import { type InspectInput, inspectJobs } from "../run/inspect.ts";
import type { BashJobsConfig } from "../state/config.ts";

const JobView = Type.Object({
	id: Type.String(),
	command: Type.String(),
	label: Type.Optional(Type.String()),
	mode: Type.String(),
	status: Type.String(),
	reason: Type.String(),
	exitCode: Type.Optional(Type.Number()),
	killedBy: Type.Optional(Type.String()),
	detached: Type.Boolean(),
	startedAt: Type.String(),
	lastOutputAt: Type.String(),
	idleSec: Type.Number(),
	durationSec: Type.Number(),
	bytes: Type.Number(),
	lines: Type.Number(),
	cursor: Type.String(),
	lost: Type.Boolean(),
	tail: Type.String(),
});

const InspectParams = Type.Object({
	job: Type.Optional(
		Type.String({ description: "Job id from a bash receipt (`J-3`). Omit to list every job in this session." }),
	),
	tailLines: Type.Optional(Type.Number({ description: "How many trailing lines to return (default 80, max 1000)" })),
	cursor: Type.Optional(
		Type.String({
			description:
				"Cursor from the previous call for this job. Returns only lines written since, so repeated inspects do not re-read the same output.",
		}),
	),
	waitMs: Type.Optional(
		Type.Number({
			description:
				"Long-poll: wait up to this many ms for new output before answering (default 0, max 120000). Prefer this over polling in separate turns.",
		}),
	),
	grep: Type.Optional(
		Type.String({
			description: "Only return lines containing this text (case-insensitive) — use it to find progress or ERROR",
		}),
	),
});

const DESCRIPTION = [
	"Read the output and status of a bash job, in this session, without blocking anything.",
	"",
	"Every bash call that did not finish inside the turn keeps running as a job (a dev server, a long download). This tool reads its retained output tail, whether it is still running, how long it has been silent, and its exit code when it has one.",
	"",
	"- Omit `job` to list all jobs with ids, status, duration and size.",
	"- Pass `job` to read one job's tail. Pass `cursor` from the previous answer to get only new lines.",
	"- Pass `waitMs` to wait inside this single call for new output (up to 2 minutes) instead of polling across turns.",
	"- Pass `grep` to filter lines, e.g. for a progress percentage or an ERROR.",
	"",
	"It never stops anything: use bash_job_stop for that.",
].join("\n");

export interface InspectToolDeps {
	registry: JobRegistry;
	config: BashJobsConfig;
	now?: () => number;
}

export function createInspectTool(deps: InspectToolDeps): ToolDefinition<typeof InspectParams, undefined> {
	return {
		name: "tool_execution_inspect_output",
		label: "inspect bash job",
		description: DESCRIPTION,
		promptSnippet: "Read a background bash job's output tail / status (read-only; pass waitMs to wait)",
		parameters: InspectParams,
		outputSchema: Type.Object({ jobs: Type.Array(JobView) }),
		async execute(
			_toolCallId,
			params: InspectInput,
			signal: AbortSignal | undefined,
			_onUpdate,
			_ctx: ExtensionToolContext,
		) {
			const result = await inspectJobs(
				{ registry: deps.registry, config: deps.config, now: deps.now ?? (() => Date.now()) },
				params,
				signal,
			);
			return {
				content: [{ type: "text" as const, text: result.text }],
				details: undefined,
				// `structuredContent` is a JSON contract, so round-trip it: this both satisfies the type and
				// proves the payload has no Date/Map/undefined holes that codemode scripts would see as null.
				structuredContent: JSON.parse(JSON.stringify(result.structured)),
				...(result.isError ? { isError: true } : {}),
			};
		},
	};
}
