/**
 * Soft cross-extension bridge for yoki-ui ↔ yoki-plan.
 * Uses Symbol.for on globalThis so jiti dual-loads still share one instance.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type AgentWorkMode = "edit" | "plan";

export interface YokiPlanBridge {
	isLoaded(): boolean;
	getMode(): AgentWorkMode;
	/** Toggle plan/edit; returns new mode (or current if refused). */
	toggleMode(ctx: ExtensionContext): Promise<AgentWorkMode>;
	/** Open dual-axis model + thinking selector. */
	openModelUI(ctx: ExtensionContext): Promise<void>;
}

export const YOKI_PLAN_BRIDGE_SYMBOL = Symbol.for("@yoki/yoki-plan:bridge");

type GlobalWithBridge = typeof globalThis & {
	[YOKI_PLAN_BRIDGE_SYMBOL]?: YokiPlanBridge;
};

export function getPlanBridge(): YokiPlanBridge | undefined {
	return (globalThis as GlobalWithBridge)[YOKI_PLAN_BRIDGE_SYMBOL];
}

export function setPlanBridge(bridge: YokiPlanBridge | undefined): void {
	const g = globalThis as GlobalWithBridge;
	if (bridge) {
		g[YOKI_PLAN_BRIDGE_SYMBOL] = bridge;
	} else {
		delete g[YOKI_PLAN_BRIDGE_SYMBOL];
	}
}
