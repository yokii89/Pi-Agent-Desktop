/**
 * @yoki/yoki-plan — plan/edit agent mode for Pi.
 *
 * - /plan toggle, --plan flag, session resume
 * - Tool gates + bash allowlist in plan mode
 * - Dual-axis /model selector
 * - Soft bridge for yoki-ui Shift+Tab + /model intercept
 * - Post-plan TUI: [PLAN READY] + steps → select execute / new session / explore / save
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type AccessModeHandle,
	acquireProcessViewClient,
	releaseProcessViewClient,
	type SlotSupervisor,
} from "@pidesk/view-sdk";
import { isSafeCommand } from "./bash-allowlist.ts";
import type { AgentWorkMode } from "./bridge.ts";
import { setPlanBridge, type YokiPlanBridge } from "./bridge.ts";
import { createPlanModeSupervisor, planModeDetailFor } from "./desktop-view.ts";
import { createPlanModeController, PLAN_ENTRY_CUSTOM_TYPE, type PlanModeState } from "./mode.ts";
import { openModelSelector } from "./model-selector.ts";
import { executePlanInNewSessionCommand, handlePostPlanSettled, savePlanFromLastAssistant } from "./post-plan.ts";
import { filterPlanContextMessages, PLAN_CONTEXT_CUSTOM_TYPE, PLAN_MODE_CONTEXT } from "./prompts.ts";
import { isWriteTool } from "./tools.ts";

export { isSafeCommand } from "./bash-allowlist.ts";
export type { AgentWorkMode, YokiPlanBridge } from "./bridge.ts";
export { getPlanBridge, setPlanBridge, YOKI_PLAN_BRIDGE_SYMBOL } from "./bridge.ts";
export {
	extractPlanSteps,
	hasPlanReady,
	PLAN_READY_MARKER,
	parseReadyPlan,
	planFingerprint,
} from "./extract.ts";
export {
	getNormalModeTools,
	getPlanModeTools,
	isWriteTool,
	PLAN_MODE_DISABLED_TOOLS,
	PLAN_MODE_PREFERRED_TOOLS,
} from "./tools.ts";

export default function (pi: ExtensionAPI): void {
	/**
	 * Desktop access-mode chip. Lifecycle is SDK-built-in
	 * (re-register on closed, backoff, shutdown); one supervisor per process.
	 */
	let desktopSupervisor: SlotSupervisor<AccessModeHandle> | null = null;
	/** 防止 session_shutdown 重复 release 把共享 pipe 引用计数打穿 */
	let desktopClientAcquired = false;
	/** Latest event ctx — desktop activation needs ui/isIdle outside event scope. */
	let lastCtx: ExtensionContext | undefined;

	const controller = createPlanModeController(pi, {
		onModeChange: (mode) => {
			// Live chip (if any) follows controller truth; supervisor also
			// re-syncs via onRegistered after pipe drops / host restarts.
			desktopSupervisor?.handle?.setActive(mode === "plan", planModeDetailFor(mode));
		},
	});

	function applyDesktopAction(action: "activate" | "deactivate"): void {
		if (!lastCtx) return;
		if (!lastCtx.isIdle()) {
			lastCtx.ui.notify("Cannot switch modes while the agent is busy.", "warning");
			return;
		}
		const next: AgentWorkMode = action === "activate" ? "plan" : "edit";
		controller.setMode(lastCtx, next);
	}

	/**
	 * Desktop access-mode chip lifecycle: register once per
	 * process; the SDK supervisor re-registers with bounded backoff when the
	 * pipe drops or the host is slow to greet, and stops on shutdown.
	 */
	function ensureDesktopMode(): void {
		if (desktopSupervisor) {
			void desktopSupervisor.ensure();
			return;
		}
		// acquire/release：与同进程其它扩展共享一条 pipe
		const client = acquireProcessViewClient();
		if (!client) {
			// 非桌面环境（无 env）：/plan + 快捷键仍是路径，不创建 supervisor
			return;
		}
		desktopClientAcquired = true;
		desktopSupervisor = createPlanModeSupervisor({
			client,
			getMode: () => controller.getMode(),
			onAction: applyDesktopAction,
		});
		void desktopSupervisor.ensure();
	}

	function disposeDesktopMode(): void {
		desktopSupervisor?.stop();
		desktopSupervisor = null;
		// 不再 force-dispose 进程 client；仅释放本扩展的引用（且只释放一次）
		if (desktopClientAcquired) {
			desktopClientAcquired = false;
			releaseProcessViewClient();
		}
	}

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	const bridge: YokiPlanBridge = {
		isLoaded: () => true,
		getMode: () => controller.getMode(),
		toggleMode: async (ctx) => controller.toggle(ctx),
		openModelUI: async (ctx) => openModelSelector(pi, ctx),
	};
	setPlanBridge(bridge);

	pi.registerCommand("plan", {
		description: "Toggle plan/edit (/plan on|off|save|new)",
		handler: async (args, ctx) => {
			const raw = (args ?? "").trim().toLowerCase();
			if (raw === "on" || raw === "plan") {
				controller.setMode(ctx, "plan");
				return;
			}
			if (raw === "off" || raw === "edit") {
				controller.setMode(ctx, "edit");
				return;
			}
			if (raw === "save") {
				await savePlanFromLastAssistant(controller, ctx, { requireReady: false });
				return;
			}
			if (raw === "new" || raw === "execute-new") {
				// Command ctx has newSession; agent_settled event ctx does not (Pi deadlock rule).
				await executePlanInNewSessionCommand(controller, ctx);
				return;
			}
			controller.toggle(ctx);
		},
	});

	// Defense-in-depth: block write tools + non-allowlisted bash in plan mode.
	pi.on("tool_call", async (event) => {
		if (controller.getMode() !== "plan") return;

		if (isWriteTool(event.toolName)) {
			return {
				block: true,
				reason: `Plan mode: tool "${event.toolName}" is disabled. Use /plan or Shift+Tab to leave plan mode.`,
			};
		}

		if (event.toolName === "bash") {
			const command = String((event.input as { command?: unknown })?.command ?? "");
			if (!isSafeCommand(command)) {
				return {
					block: true,
					reason:
						"Plan mode: command blocked (not allowlisted). " +
						`Use /plan or Shift+Tab to leave plan mode.\nCommand: ${command}`,
				};
			}
		}
	});

	// Strip stale plan context when in edit mode (plan mode keeps the injected context).
	pi.on("context", async (event) => {
		if (controller.getMode() === "plan") return;
		return {
			messages: filterPlanContextMessages(event.messages),
		};
	});

	// Inject plan instructions before each agent turn in plan mode.
	pi.on("before_agent_start", async () => {
		if (controller.getMode() !== "plan") return;
		return {
			message: {
				customType: PLAN_CONTEXT_CUSTOM_TYPE,
				content: PLAN_MODE_CONTEXT,
				display: false,
			},
		};
	});

	// Post-plan TUI when agent is truly idle (not mid-retry/compact/follow-up).
	pi.on("agent_settled", async (_event, ctx) => {
		lastCtx = ctx;
		await handlePostPlanSettled(pi, controller, ctx);
	});

	pi.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
		// Flag forces plan on startup (also after resume entry load below).
		const flagPlan = pi.getFlag("plan") === true;

		const entries = ctx.sessionManager.getEntries() as Array<{
			type: string;
			customType?: string;
			data?: PlanModeState;
		}>;
		const last = entries.filter((e) => e.type === "custom" && e.customType === PLAN_ENTRY_CUSTOM_TYPE).pop();

		if (last?.data) {
			controller.restore(ctx, {
				mode: flagPlan ? "plan" : last.data.mode,
				toolsBeforePlan: last.data.toolsBeforePlan,
				lastPlanFingerprint: last.data.lastPlanFingerprint,
				lastPlanPath: last.data.lastPlanPath,
			});
		} else if (flagPlan) {
			controller.restore(ctx, { mode: "plan" });
		} else {
			controller.updateStatus(ctx);
		}

		try {
			ensureDesktopMode();
		} catch {
			// Desktop host unavailable — /plan + shortcuts remain the path.
		}
	});

	pi.on("session_shutdown", async () => {
		disposeDesktopMode();
	});
}

/** Test helper: tear down bridge (not used in production). */
export function __resetPlanBridgeForTests(): void {
	setPlanBridge(undefined);
}
