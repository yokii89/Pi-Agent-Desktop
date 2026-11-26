import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { NativeJobOutput } from "../../../shared/nativeBuiltins.js";
import { toolArgs } from "../output.js";
import type { BackgroundJobs } from "./manager.js";

export function jobReceipt(result: NativeJobOutput): string {
  const row = result.job;
  return `${row.status === "running" ? "Moved to background" : row.status}: ${row.id}${row.exitCode === null ? "" : ` (exit ${row.exitCode})`}\n${row.label || row.command}\n${result.output}${result.lost || row.truncated ? `\nOutput was truncated. Retained log: ${row.logPath}` : ""}\nCursor: ${result.cursor}`;
}
/** Tools and desktop controls share the same session-scoped process registry. */
export function jobTools(jobs: BackgroundJobs, sessionId: string, cwd: string): ToolRegistration[] {
  return [
    {
      name: "bash",
      description:
        "Run bash in the session workspace. finish waits then yields on silence or a soft budget; detach immediately backgrounds servers; long waits through a grace window then backgrounds and reports completion. Background jobs are never killed by a soft budget. An explicit timeout kills only while blocking. Use inspect and bash_job_stop with the returned job id.",
      replay: "unsafe",
      outputLimits: { maxBytes: 60000, maxLines: 2100 },
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["command"],
        properties: {
          command: { type: "string", minLength: 1, maxLength: 128000 },
          mode: { type: "string", enum: ["finish", "detach", "long"] },
          timeout: { type: "number", exclusiveMinimum: 0, maximum: 86400 },
          label: { type: "string", maxLength: 200 },
        },
      },
      async execute(args, api, context) {
        const input = toolArgs(args);
        const result = await jobs.run(
          sessionId,
          cwd,
          api.taskId,
          api.callId,
          {
            command: String(input.command),
            mode: input.mode as "finish" | "detach" | "long" | undefined,
            timeout: input.timeout as number | undefined,
            label: input.label as string | undefined,
          },
          context.abortSignal,
          (chunk) => api.output(chunk),
        );
        return {
          output: [{ type: "text", text: jobReceipt(result) }],
          details: result,
          isError:
            ["stopped", "timed-out"].includes(result.job.status) ||
            (result.job.status === "exited" && result.job.exitCode !== 0),
        };
      },
    },
    {
      name: "tool_execution_inspect_output",
      description:
        "List this session's background jobs or inspect retained output. cursor reads new lines; grep filters output; waitMs waits up to 120000 ms for new output or exit without stopping the job.",
      replay: "safe",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          job: { type: "string", maxLength: 64 },
          cursor: { type: "string", pattern: "^[0-9]{1,16}$" },
          tailLines: { type: "integer", minimum: 1, maximum: 1000 },
          waitMs: { type: "integer", minimum: 0, maximum: 120000 },
          grep: { type: "string", maxLength: 1000 },
        },
      },
      async execute(args, _api, context) {
        const input = toolArgs(args);
        if (typeof input.job !== "string")
          return { output: [{ type: "text", text: JSON.stringify(jobs.list(sessionId)) }] };
        const result = await jobs.inspect(
          sessionId,
          input.job,
          input.cursor as string | undefined,
          input.tailLines as number | undefined,
          input.waitMs as number | undefined,
          input.grep as string | undefined,
          context.abortSignal,
        );
        return { output: [{ type: "text", text: jobReceipt(result) }], details: result };
      },
    },
    {
      name: "bash_job_stop",
      description:
        "Stop a background job owned by this session using its captured process handle. Kills the tree. graceful sends SIGTERM first on Unix; Windows always uses a tree kill. Restored orphan PIDs cannot authorize a stop.",
      replay: "unsafe",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["job"],
        properties: {
          job: { type: "string", minLength: 1, maxLength: 64 },
          signal: { type: "string", enum: ["tree-kill", "graceful"] },
        },
      },
      async execute(args) {
        const input = toolArgs(args);
        const result = await jobs.stop(sessionId, String(input.job), input.signal === "graceful");
        return { output: [{ type: "text", text: jobReceipt(result) }], details: result };
      },
    },
  ];
}
