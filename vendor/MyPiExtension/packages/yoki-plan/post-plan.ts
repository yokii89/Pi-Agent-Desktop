/**
 * Post-plan TUI: after agent_settled in plan mode with ready+steps, ask what next.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { presentPostPlanOnDesktop } from "./desktop-view.ts";
import type { PlanStep } from "./extract.ts";
import { extractPlanSteps, parseReadyPlan, planFingerprint } from "./extract.ts";
import type { PlanModeController } from "./mode.ts";
import { writePlanArtifact } from "./persist.ts";
import { POST_PLAN_OPTIONS, POST_PLAN_SELECT_TITLE } from "./post-plan-options.ts";

interface AssistantLike {
	role: string;
	content: Array<{ type?: string; text?: string }>;
}

/** Re-export for existing importers (tests, desktop-view). */
export {
	POST_PLAN_OPTIONS,
	POST_PLAN_SELECT_TITLE,
	type PostPlanChoice,
} from "./post-plan-options.ts";

const EXECUTE_CUSTOM_TYPE = "yoki-plan-execute";
const PLAN_LIST_CUSTOM_TYPE = "yoki-plan-steps";

function isAssistantLike(m: unknown): m is AssistantLike {
	if (!m || typeof m !== "object") return false;
	const msg = m as { role?: string; content?: unknown };
	return msg.role === "assistant" && Array.isArray(msg.content);
}

function getTextContent(message: AssistantLike): string {
	const parts: string[] = [];
	for (const block of message.content) {
		if (block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		}
	}
	return parts.join("\n");
}

/** Last assistant text on the current branch, if any. */
export function getLastAssistantText(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		const msg = (entry as { message?: unknown }).message;
		if (!isAssistantLike(msg)) continue;
		return getTextContent(msg);
	}
	return undefined;
}

function stepsListText(steps: readonly PlanStep[]): string {
	return steps.map((s) => `${s.step}. ${s.text}`).join("\n");
}

function buildExecutePrompt(steps: readonly PlanStep[], planPath?: string): string {
	const pathLine = planPath ? `Plan file: ${planPath}\n\n` : "";
	return (
		`${pathLine}Execute the plan.\n\n` +
		`Steps:\n${stepsListText(steps)}\n\n` +
		`Start with step 1. Work through each step in order. Do not skip steps.`
	);
}

function buildNewSessionKickoff(planPath: string): string {
	return (
		`Execute the exploration plan saved at:\n${planPath}\n\n` +
		`Read that file and implement its steps in order. Prefer the plan document over any other context.`
	);
}

/** Duck-typed newSession — present on command ctx, not on event ctx. */
function getNewSession(ctx: ExtensionContext): ExtensionCommandContext["newSession"] | undefined {
	const fn = (ctx as Partial<ExtensionCommandContext>).newSession;
	return typeof fn === "function" ? fn.bind(ctx) : undefined;
}

/**
 * Core settled handler. Register via:
 *   pi.on("agent_settled", (_e, ctx) => handlePostPlanSettled(pi, controller, ctx))
 */
export async function handlePostPlanSettled(
	pi: ExtensionAPI,
	controller: PlanModeController,
	ctx: ExtensionContext,
): Promise<void> {
	if (controller.getMode() !== "plan") return;
	if (!ctx.hasUI) return;
	if (!ctx.isIdle()) return;

	const text = getLastAssistantText(ctx);
	if (!text) return;

	const parsed = parseReadyPlan(text);
	if (!parsed) return;

	const { steps, fingerprint } = parsed;
	if (fingerprint === controller.getLastPlanFingerprint()) return;

	// Desktop (PiDesk) first: richer step preview. null → no host → dialog select.
	let choice: string | undefined;
	const desktopChoice = await presentPostPlanOnDesktop(steps);
	if (desktopChoice !== null) {
		// undefined = dismissed → same as Esc (option 3)
		choice = desktopChoice;
	} else {
		choice = await ctx.ui.select(POST_PLAN_SELECT_TITLE, [...POST_PLAN_OPTIONS]);
	}

	// Esc / dismiss → option 3 (explore): no write, stay plan, fingerprint prompted
	if (!choice || choice === POST_PLAN_OPTIONS[2]) {
		controller.setLastPlanFingerprint(fingerprint);
		return;
	}

	if (choice === POST_PLAN_OPTIONS[0]) {
		await executeSameSession(pi, controller, ctx, steps, fingerprint);
		return;
	}
	if (choice === POST_PLAN_OPTIONS[1]) {
		await executeNewSession(pi, controller, ctx, steps, fingerprint);
		return;
	}
	if (choice === POST_PLAN_OPTIONS[3]) {
		await saveOnly(controller, ctx, steps, fingerprint);
	}
}

async function executeSameSession(
	pi: ExtensionAPI,
	controller: PlanModeController,
	ctx: ExtensionContext,
	steps: readonly PlanStep[],
	fingerprint: string,
): Promise<void> {
	const written = await writePlanArtifact({ cwd: ctx.cwd, steps });
	controller.setLastPlan(fingerprint, written.relativePath);
	controller.enterEdit(ctx);
	pi.sendMessage(
		{
			customType: PLAN_LIST_CUSTOM_TYPE,
			content: `**Plan steps (${steps.length}):**\n\n${stepsListText(steps)}`,
			display: true,
		},
		{ deliverAs: "followUp" },
	);
	pi.sendMessage(
		{
			customType: EXECUTE_CUSTOM_TYPE,
			content: buildExecutePrompt(steps, written.relativePath),
			display: true,
		},
		{ triggerTurn: true, deliverAs: "followUp" },
	);
	ctx.ui.notify(`Plan saved to ${written.relativePath}. Executing in this session.`, "info");
}

async function executeNewSession(
	_pi: ExtensionAPI,
	controller: PlanModeController,
	ctx: ExtensionContext,
	steps: readonly PlanStep[],
	fingerprint: string,
): Promise<void> {
	const written = await writePlanArtifact({ cwd: ctx.cwd, steps });
	controller.setLastPlan(fingerprint, written.relativePath);

	const kickoff = buildNewSessionKickoff(written.relativePath);
	const parentSession = ctx.sessionManager.getSessionFile() ?? undefined;
	// Plain-data capture only — never pass old pi / old sessionManager into withSession.
	const stepsText = stepsListText(steps);
	const seedContent =
		`# Exploration plan (from plan mode)\n\n` +
		`Path: ${written.relativePath}\n\n` +
		`## Steps\n\n${stepsText}\n\n` +
		`Absolute: ${written.absolutePath}`;

	const pending = {
		planPath: written.relativePath,
		absolutePath: written.absolutePath,
		stepsText,
		kickoff,
		seedContent,
		parentSession,
	};

	const newSession = getNewSession(ctx);
	if (newSession) {
		// Command-capable ctx (rare for agent_settled; used when tests inject newSession).
		const result = await runNewSessionFromKickoff(newSession, pending);
		if (result.cancelled) {
			ctx.ui.notify("New session cancelled. Plan file kept.", "warning");
		}
		return;
	}

	// Pi only exposes newSession on slash-command ctx (event handlers would deadlock).
	// Stash plain data + prefill `/plan new` so the user can confirm with Enter.
	controller.setPendingNewSession(pending);
	if (typeof ctx.ui.setEditorText === "function") {
		ctx.ui.setEditorText("/plan new");
	}
	ctx.ui.notify(
		`Plan saved to ${written.relativePath}. Press Enter to run /plan new (fresh session + execute).`,
		"info",
	);
}

type NewSessionFn = NonNullable<ExtensionCommandContext["newSession"]>;

async function runNewSessionFromKickoff(
	newSession: NewSessionFn,
	pending: {
		planPath: string;
		absolutePath: string;
		stepsText: string;
		kickoff: string;
		seedContent: string;
		parentSession?: string;
	},
): Promise<{ cancelled: boolean }> {
	return newSession({
		parentSession: pending.parentSession,
		setup: async (sm) => {
			sm.appendMessage({
				role: "user",
				content: [{ type: "text", text: pending.seedContent }],
				timestamp: Date.now(),
			});
		},
		withSession: async (newCtx) => {
			// Replacement ctx only — never old pi / old sessionManager.
			await newCtx.sendUserMessage(pending.kickoff);
		},
	});
}

/**
 * `/plan new` — real fresh-session execute (command ctx has newSession).
 * Uses pending kickoff from option 2, or lastPlanPath as fallback.
 */
export async function executePlanInNewSessionCommand(
	controller: PlanModeController,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const pending =
		controller.takePendingNewSession() ??
		pendingFromLastPath(controller, ctx.sessionManager.getSessionFile() ?? undefined);

	if (!pending) {
		ctx.ui.notify(
			"No plan ready for new-session execute. Save a plan first (post-plan option 2/4 or /plan save).",
			"warning",
		);
		return;
	}

	const result = await runNewSessionFromKickoff(ctx.newSession.bind(ctx), pending);
	if (result.cancelled) {
		// Pending was already taken; re-stash so user can retry.
		controller.setPendingNewSession(pending);
		ctx.ui.notify("New session cancelled. Plan file kept. Run /plan new again to retry.", "warning");
	}
}

function pendingFromLastPath(
	controller: PlanModeController,
	parentSession: string | undefined,
):
	| {
			planPath: string;
			absolutePath: string;
			stepsText: string;
			kickoff: string;
			seedContent: string;
			parentSession?: string;
	  }
	| undefined {
	const planPath = controller.getLastPlanPath();
	if (!planPath) return undefined;
	const kickoff = buildNewSessionKickoff(planPath);
	const seedContent = `# Exploration plan (from plan mode)\n\nPath: ${planPath}\n\nRead the plan file and execute its steps.`;
	return {
		planPath,
		absolutePath: planPath,
		stepsText: "(see plan file)",
		kickoff,
		seedContent,
		parentSession,
	};
}

async function saveOnly(
	controller: PlanModeController,
	ctx: ExtensionContext,
	steps: readonly PlanStep[],
	fingerprint: string,
): Promise<void> {
	const written = await writePlanArtifact({ cwd: ctx.cwd, steps });
	controller.setLastPlan(fingerprint, written.relativePath);
	// Stay in plan mode.
	ctx.ui.notify(`Plan saved to ${written.relativePath}`, "info");
}

/**
 * Force-archive last assistant message (`/plan save`).
 * When requireReady is false, extracts steps if present or uses an excerpt.
 */
export async function savePlanFromLastAssistant(
	controller: PlanModeController,
	ctx: ExtensionContext,
	options: { requireReady?: boolean } = {},
): Promise<string | undefined> {
	const text = getLastAssistantText(ctx);
	if (!text) {
		ctx.ui.notify("No assistant message to save as a plan.", "warning");
		return undefined;
	}

	if (options.requireReady) {
		const parsed = parseReadyPlan(text);
		if (!parsed) {
			ctx.ui.notify("Last message has no [PLAN READY] + Plan: steps.", "warning");
			return undefined;
		}
		const written = await writePlanArtifact({ cwd: ctx.cwd, steps: parsed.steps });
		controller.setLastPlan(parsed.fingerprint, written.relativePath);
		ctx.ui.notify(`Plan saved to ${written.relativePath}`, "info");
		return written.relativePath;
	}

	let steps = extractPlanSteps(text);
	if (steps.length === 0) {
		const excerpt = text.trim().slice(0, 200).replace(/\s+/g, " ");
		steps = [{ step: 1, text: excerpt || "Saved plan" }];
	}
	const fingerprint = planFingerprint(steps) || `force-${Date.now()}`;
	const written = await writePlanArtifact({
		cwd: ctx.cwd,
		steps,
		overview: text.slice(0, 500),
	});
	controller.setLastPlan(fingerprint, written.relativePath);
	ctx.ui.notify(`Plan saved to ${written.relativePath}`, "info");
	return written.relativePath;
}
