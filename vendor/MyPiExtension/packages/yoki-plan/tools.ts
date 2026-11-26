/**
 * Plan vs edit tool-set math.
 * Preserves unrelated custom tools; only manages write tools + preferred read tools.
 */

/** Built-in write tools always disabled in plan mode. */
export const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);

/** Preferred tools forced on when entering plan mode. */
export const PLAN_MODE_PREFERRED_TOOLS = ["read", "bash", "grep", "find", "ls", "ask_user_question"] as const;

/** Tools this package actively manages (snapshot/restore). */
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_PREFERRED_TOOLS, ...PLAN_MODE_DISABLED_TOOLS]);

export function uniqueToolNames(toolNames: string[]): string[] {
	return [...new Set(toolNames)];
}

/**
 * Build the active tool list for plan mode from a pre-plan snapshot.
 * Keeps non-write tools from the snapshot and force-includes preferred plan tools.
 */
export function getPlanModeTools(
	activeToolNames: string[],
	extraBlocked: readonly string[] = [],
	extraPlan: readonly string[] = [],
): string[] {
	const blocked = new Set<string>([...PLAN_MODE_DISABLED_TOOLS, ...extraBlocked]);
	const preferred = uniqueToolNames([...PLAN_MODE_PREFERRED_TOOLS, ...extraPlan]);
	return uniqueToolNames([...activeToolNames.filter((name) => !blocked.has(name)), ...preferred]);
}

/**
 * Build a normal-mode tool list when no snapshot is available.
 * Ensures built-in write tools are present and keeps unmanaged custom tools.
 */
export function getNormalModeTools(activeToolNames: string[]): string[] {
	return uniqueToolNames([
		"read",
		"bash",
		"edit",
		"write",
		...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
	]);
}

/** True if a tool name is a built-in or configured write tool. */
export function isWriteTool(name: string, extraBlocked: readonly string[] = []): boolean {
	return PLAN_MODE_DISABLED_TOOLS.has(name) || extraBlocked.includes(name);
}
