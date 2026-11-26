/**
 * reconcile — mid-session lifecycle reconciliation for ask_user_question.
 *
 * Strips or re-adds the tool to the active set so it is invisible to the LLM
 * when no rendering surface exists, and present when TUI/RPC hasUI or an
 * external host (e.g. Telegram) is registered. Pattern:
 * `getActiveTools` → `includes` → filter/spread, idempotent in both directions.
 *
 * RPC hosts (ctx.mode === "rpc": VSCode pendant, Zed, Paseo) are deliberately
 * NOT stripped: since PR #100 the tool renders there via the select/input
 * dialog walker (rpc-fallback.ts), so hasUI is the honest signal again. The
 * brief period where RPC was stripped (872ef1c) predates that fallback.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ASK_USER_QUESTION_TOOL_NAME } from "./ask-user-question.ts";
import { hasAskUserHosts } from "./host.ts";

/**
 * Strip-or-restore `ask_user_question` to match available rendering surfaces.
 * Idempotent: when the tool is already in the right state it leaves the active
 * set (and sibling tools) untouched.
 */
export function reconcileAskUserQuestionTool(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const active = pi.getActiveTools();
	const hasTool = active.includes(ASK_USER_QUESTION_TOOL_NAME);
	const available = ctx.hasUI || hasAskUserHosts();
	// No surface → strip so the tool never reaches the LLM's tool list;
	// surface available → restore. In-handler guards remain as one-turn
	// backstops if a future Pi change reorders the tool-list snapshot.
	if (!available && hasTool) {
		pi.setActiveTools(active.filter((n) => n !== ASK_USER_QUESTION_TOOL_NAME));
	} else if (available && !hasTool) {
		pi.setActiveTools([...active, ASK_USER_QUESTION_TOOL_NAME]);
	}
}

/**
 * Attach the reconciler to `before_agent_start` so the active set is fixed up
 * before each turn's tool-list snapshot is read. Safe to call once at load.
 */
export function registerAskUserQuestionReconciler(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (_event, ctx) => reconcileAskUserQuestionTool(pi, ctx));
}
