/**
 * The bash tool definition: pi's own definition (so TUI rendering, prompt wiring and
 * `constrainedSampling` stay pi's) with three additions — `mode`, `label`, and an `execute`
 * that can yield instead of block.
 *
 * Doc 129 D1 chose replacement over a new `bash_bg` tool: a tool the model must remember to use
 * is a tool it will forget, and the failure mode of forgetting is a permanently blocked turn.
 */

import type { ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { JobRegistry } from "../core/jobs.ts";
import type { WaitSlice } from "../core/wait.ts";
import { spawnShellCommand } from "../infra/shell.ts";
import type { JobLogTee } from "../infra/tee.ts";
import { type BashParams, runBash } from "../run/runBash.ts";
import type { BashJobsConfig } from "../state/config.ts";

const BashParameters = Type.Object({
	command: Type.String({ description: "Shell command to execute" }),
	timeout: Type.Optional(
		Type.Number({
			description:
				"Timeout in seconds. Killing is the only thing it does: at the deadline the whole process tree is killed and the call fails. Omit it for services and long tasks.",
		}),
	),
	mode: Type.Optional(
		Type.Union([Type.Literal("finish"), Type.Literal("detach"), Type.Literal("long")], {
			description:
				"How the call relates to the turn. finish = block until exit (auto-yields to background, never kills). detach = return immediately, for dev servers only. long = block up to the grace window, then continue in the background and wake me when it exits — for work you expect to outlive the turn. Omit to let the extension classify the command.",
		}),
	),
	label: Type.Optional(
		Type.String({ description: 'Human-readable job name shown in receipts and notices (e.g. "download isubs")' }),
	),
});

const BashOutput = Type.Object({
	output: Type.String({ description: "Combined stdout and stderr, trimmed to the tail the model reads" }),
	truncated: Type.Boolean({ description: "True when older output was dropped (by the job ring or the result cap)" }),
	full_output_path: Type.Optional(
		Type.String({ description: "File holding the complete output, present when the text above was trimmed" }),
	),
	exit_code: Type.Optional(Type.Number({ description: "Exit code, absent when the job is still running" })),
	wall_time_seconds: Type.Number(),
	job_id: Type.String({ description: "Job id (`J-3`) for tool_execution_inspect_output / bash_job_stop" }),
	status: Type.Union([Type.Literal("exited"), Type.Literal("detached"), Type.Literal("killed")]),
});

const DESCRIPTION = [
	"Execute a bash command in the current working directory. Returns stdout and stderr.",
	"",
	"Commands that would block the turn do not block forever: once a call has been silent for a while or has run past its soft budget it **moves to the background** (it is never killed), and you get a job id back.",
	"",
	"Modes:",
	'- `finish` (default): wait for the exit code. If it takes too long you get a "moved to the background" receipt with the output so far. Nothing is killed.',
	"- `detach`: return immediately. Use it for dev servers, watchers, `tail -f` — anything meant to keep running. These are never auto-killed.",
	"- `long`: block up to the grace window (~3 min), then continue in the background and wake you when the process exits. A command that finishes inside the window just returns its result. Use it for downloads, builds, `docker pull` — work you expect to outlive the turn.",
	"- Omit `mode` and the command is classified for you (`pnpm dev` → detach, `git clone` → long, everything else → finish).",
	"",
	"`timeout` keeps pi's native meaning: at the deadline the process tree is killed and the call fails. **It only applies to blocking calls** — never pass it to keep a service alive, and never pass it to a long task you want to finish.",
	"",
	"To follow a background job: `tool_execution_inspect_output({ job })` (add `waitMs` to wait inside one call, `cursor` for only new lines). To stop one: `bash_job_stop({ job })`. Output is kept per job (tail, capped) even after the process exits.",
].join("\n");

const PROMPT_SNIPPET =
	"Execute bash commands; long ones move to the background instead of being killed (finish/detach/long)";

const PROMPT_GUIDELINES = [
	'Start dev servers and watchers with `mode:"detach"` and never pass `timeout` to them — a timeout is the only thing that kills a command.',
	'Start downloads, builds, `git clone`, `docker pull` and similar with `mode:"long"` when you want to continue working; you will be woken when it exits. A `long` call that finishes inside its grace window just returns its result, so this is never wasted.',
	"Keep `mode` off for anything you expect to finish quickly (tests, type checks, git, format, short scripts): `finish` already waits, and turning a 15-second command into a background job is noise for the user.",
	"Read a background job with tool_execution_inspect_output (pass `waitMs` to wait inside one call instead of polling in separate turns).",
	"Stop a background job with bash_job_stop; do not use `taskkill`/`kill` from bash — that cannot tell a reused pid from the real process.",
];

/** Re-expose pi's session environment so the model can read PI_* (same contract as built-in bash). */
function sessionEnv(ctx: ExtensionToolContext | undefined): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env.PI_SESSION_ID;
	delete env.PI_SESSION_FILE;
	delete env.PI_PROVIDER;
	delete env.PI_MODEL;
	delete env.PI_REASONING_LEVEL;
	if (!ctx) return env;
	env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (sessionFile) env.PI_SESSION_FILE = sessionFile;
	if (ctx.model) {
		env.PI_PROVIDER = ctx.model.provider;
		env.PI_MODEL = ctx.model.id;
	}
	if (ctx.thinkingLevel) env.PI_REASONING_LEVEL = ctx.thinkingLevel;
	return env;
}

export interface BashToolDeps {
	config: BashJobsConfig;
	registry: JobRegistry;
	now?: () => number;
	spawn?: typeof spawnShellCommand;
	/** Injected in tests so the wait loop can be stepped without real seconds. */
	waitTick?: WaitSlice;
	/**
	 * Per-session job log tee (方案 B). A provider because the tool outlives sessions: the tee
	 * directory depends on the session id and is rebuilt on `session_start`.
	 */
	tee?: () => JobLogTee | undefined;
}

export function createBashJobsTool(deps: BashToolDeps): ToolDefinition<typeof BashParameters, undefined> {
	const base = createBashToolDefinition(process.cwd());
	const definition = {
		...base,
		name: "bash",
		label: "bash",
		description: DESCRIPTION,
		promptSnippet: PROMPT_SNIPPET,
		promptGuidelines: PROMPT_GUIDELINES,
		parameters: BashParameters,
		outputSchema: BashOutput,
		async execute(
			_toolCallId: string,
			params: BashParams,
			signal: AbortSignal | undefined,
			onUpdate: ((update: { content: { type: "text"; text: string }[]; details: undefined }) => void) | undefined,
			ctx: ExtensionToolContext,
		) {
			return runBash(
				{
					config: deps.config,
					registry: deps.registry,
					now: deps.now ?? (() => Date.now()),
					spawn: deps.spawn ?? spawnShellCommand,
					waitTick: deps.waitTick,
					tee: deps.tee,
				},
				params,
				{
					cwd: ctx?.cwd ?? process.cwd(),
					env: sessionEnv(ctx),
					signal,
					onUpdate,
					onIdleNotice: (job, idleSec, detachInSec) => {
						const detached = Math.max(0, detachInSec - idleSec);
						ctx?.ui.notify(
							`${job.id} silent for ${idleSec}s${detached > 0 ? ` — moves to background in ${detached}s` : " — moving to background"}: ${job.command}`,
							"warning",
						);
					},
				},
			);
		},
	};
	// The renderers come from pi's own bash definition and are typed against pi's schema; ours is a
	// superset, so the cast only relaxes the parameter type, not the behavior.
	return definition as unknown as ToolDefinition<typeof BashParameters, undefined>;
}
