/**
 * yoki-model-busy-retry — wait out a saturated model instead of failing the turn.
 *
 * Qoder answers a full model with `10605 … request queued (…, 15254 ahead, ~205s wait,
 * rate limit, retry-after-ms=205000)`. The provider cannot keep that wait (its own busy
 * loop is capped at 5s) and Pi's agent-level retry starts at 2s, so every attempt
 * re-enters the same queue before it has drained and the turn dies with "模型调用失败".
 * This extension wraps the provider stream and treats the announced wait as a promise to
 * chase: sleep a share of it, re-ask, re-plan from the new number — and stop probing once
 * the number stops moving. A queue that clears when it said it would never reaches the
 * user as a failed model call.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BusyRetryDecision } from "./policy.ts";
import { createBusyRetryPlanner, formatBusyRetryNotice } from "./policy.ts";
import { installBusyRetryWrapping } from "./wrapProviders.ts";

const seconds = (ms: number): string => `${Math.round(ms / 1000)}s`;

export default function (pi: ExtensionAPI) {
	const planner = createBusyRetryPlanner();
	// The newest context wins: a wait can outlive the session that started it, and the
	// notification belongs to whatever UI is current.
	let context: ExtensionContext | undefined;
	let wrapped: string[] = [];
	let last: BusyRetryDecision | undefined;

	const install = (ctx: ExtensionContext) => {
		context = ctx;
		const ids = installBusyRetryWrapping({
			registry: ctx.modelRegistry,
			register: pi.registerProvider,
			plan: planner.plan,
			onWait: (decision) => {
				last = decision;
				context?.ui.notify(formatBusyRetryNotice(decision, planner.policy), "warning");
			},
		});
		if (ids.length > 0) wrapped = [...new Set([...wrapped, ...ids])];
	};

	pi.on("session_start", (_event, ctx) => {
		install(ctx);
	});
	pi.on("before_agent_start", (_event, ctx) => {
		planner.reset();
		install(ctx);
	});
	pi.on("model_select", (_event, ctx) => {
		install(ctx);
	});

	// "Did it intercept *my* queue failure?" is otherwise only answerable from the logs.
	pi.registerCommand("busy-retry", {
		description: "Show which providers are wrapped and how long this run has waited",
		handler: async (_args, ctx) => {
			const policy = planner.policy;
			const lines = [
				wrapped.length > 0 ? `wrapped: ${wrapped.join(", ")}` : "wrapped: nothing yet (no qoder-api provider seen)",
				`this run: waited ${seconds(planner.waitedMs)} of ${seconds(policy.maxWaitMsPerRun)}`,
				last ? formatBusyRetryNotice(last, policy) : "no queue hit in this session yet",
				`probe ${Math.round(policy.probeFraction * 100)}% of the announced wait, ` +
					`${seconds(policy.minProbeMs)}-${seconds(policy.maxProbeMs)}, ` +
					`up to ${policy.maxAttemptsPerRequest} per request`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
