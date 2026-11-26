import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  defineTask,
  type Extension,
  GenerationTask,
  hook,
  hookTask,
  section,
  ToolTask,
} from "@earendil-works/pi-durable";
import { INTERACTION_LIFETIME_MS } from "../../shared/nativeBuiltins.js";
import { isSafePlanCommand } from "./planCommands.js";
import { NativeState, PlanSignal } from "./state.js";

const PLAN_GUIDANCE = `Plan mode is active. Explore and ask questions, then present a concrete numbered plan. File changes, image generation, outgoing messages, process control and unknown tools are blocked by the host. Bash accepts a small read-only command allowlist; use read and rg for inspection. When the plan is ready, end with a Plan: heading, numbered steps, and [PLAN READY]. Execution requires the user's choice in the plan review.`;

/** A durable review task keeps the answer visible while the run waits for the user's decision. */
export const ReviewPlan = defineTask<
  { text: string; fingerprint: string },
  { phase: "ask" } | { phase: "decide" },
  { continue?: string; path?: string; action?: string }
>({
  name: "pidesk.review-plan",
  version: 1,
  initial: () => ({ phase: "ask" }),
  phases: {
    ask: async (task, runtime, context) => {
      const until = await runtime.memo("until", runtime.now() + INTERACTION_LIFETIME_MS, context);
      await runtime.commit(async (tx) => {
        const state = await tx.doc(NativeState, runtime.conversationId);
        state.plan = { taskId: task.id, ...task.input, until };
        state.lastPlan = task.input.fingerprint;
        return {
          status: "sleeping",
          signals: [PlanSignal.key("answer")],
          until,
          checkpoint: { phase: "decide" },
        };
      }, context);
    },
    decide: async (task, runtime, context) => {
      const signal = await runtime.readSignal(PlanSignal, "answer", context);
      const action =
        signal && "value" in signal && typeof signal.value === "string" ? signal.value : "explore";
      let saved = "";
      if (["execute", "new", "save"].includes(action)) {
        const env = await runtime.env(context);
        if (!env?.cwd) throw new Error("A plan artifact requires a session workspace.");
        const directory = path.join(env.cwd, ".pidesk", "artifacts", "plans");
        await mkdir(directory, { recursive: true });
        saved = path.join(directory, `plan-${task.id}-${task.input.fingerprint.slice(0, 16)}.md`);
        const body = `---\nsource: pidesk-plan\n---\n\n${task.input.text}\n`;
        // A resumed decision finds its own identical artifact, never overwrites a user's edits.
        try {
          await writeFile(saved, body, { flag: "wx" });
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== "EEXIST" ||
            (await readFile(saved, "utf8")) !== body
          )
            throw error;
        }
      }
      await runtime.commit(async (tx) => {
        const state = await tx.doc(NativeState, runtime.conversationId);
        if (state.plan?.taskId === task.id) state.plan = null;
        if (saved) state.savedPlan = saved;
        if (action === "execute") state.mode = "edit";
        return {
          status: "terminal",
          outcome: {
            status: "completed",
            result: {
              action,
              ...(saved ? { path: saved } : {}),
              ...(action === "new" ? { text: task.input.text } : {}),
              ...(action === "execute"
                ? {
                    continue: `Implement the approved plan saved at ${saved}.\n\n${task.input.text}`,
                  }
                : {}),
            },
          },
        };
      }, context);
    },
  },
  abort: async (task, runtime, context) => {
    await runtime.commit(async (tx) => {
      const state = await tx.doc(NativeState, runtime.conversationId);
      if (state.plan?.taskId === task.id) state.plan = null;
      return { status: "terminal", outcome: { status: "aborted" } };
    }, context);
  },
});

/** Install last, so the gate checks the final arguments after extension rewrites. */
export function planExtension(): Extension {
  return {
    name: "pidesk-plan",
    tasks: [ReviewPlan],
    sections: [
      section("pidesk-plan", async (input, context) =>
        (await input.read.snapshot(NativeState, input.conversationId, context))?.mode === "plan"
          ? PLAN_GUIDANCE
          : undefined,
      ),
    ],
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call, api, context) => {
          if ((await api.snapshot(NativeState, api.conversationId, context))?.mode !== "plan")
            return;
          if (
            [
              "read",
              "web_search",
              "web_fetch",
              "ask_user_question",
              "tool_execution_inspect_output",
              "telegram_help",
            ].includes(call.name)
          )
            return;
          if (
            call.name === "bash" &&
            typeof call.arguments.command === "string" &&
            (call.arguments.mode === undefined || call.arguments.mode === "finish") &&
            isSafePlanCommand(call.arguments.command)
          )
            return;
          return {
            block:
              "Plan mode permits read-only exploration. Review the plan and choose Execute before using this tool or command.",
          };
        },
      }),
      hook(GenerationTask, {
        onYield: async (answer, api, context) => {
          const state = await api.snapshot(NativeState, api.conversationId, context);
          if (state?.mode !== "plan") return;
          const text = answer.content
            .flatMap((block) => (block.type === "text" ? [block.text] : []))
            .join("\n");
          if (
            text.length > 128000 ||
            !/\[PLAN READY\]/i.test(text) ||
            !/(?:^|\n)(?:#{1,6}\s*)?(?:Plan|计划)[:：]?\s*\n[\s\S]*?^\s*1[.)、]\s*\S/im.test(text)
          )
            return;
          const fingerprint = createHash("sha256").update(text.trim()).digest("hex");
          if (fingerprint === state.lastPlan) return;
          return { tasks: [hookTask(ReviewPlan, { text, fingerprint })] };
        },
      }),
    ],
  };
}
