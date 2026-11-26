/** Custom message type for plan-mode context injection. */
export const PLAN_CONTEXT_CUSTOM_TYPE = "yoki-plan-context";

/** Marker substring used to strip stale plan context from user/custom messages. */
export const PLAN_MODE_MARKER = "[PLAN MODE ACTIVE]";

export const PLAN_MODE_CONTEXT = `${PLAN_MODE_MARKER}
You are in plan mode — a read-only exploration mode for safe code analysis.

Restrictions:
- Built-in edit and write tools are disabled
- Other currently active tools remain available
- Bash is restricted to an allowlist of read-only commands
- Do NOT mutate files or claim work is complete while still exploring

Ask clarifying questions when requirements are ambiguous.

When the exploration plan is ready for the user to review, end your message with a numbered list under a "Plan:" header and the ready marker:

Plan:
1. First step description
2. Second step description
...

[PLAN READY]

Rules:
- Do not claim the plan is ready without including [PLAN READY] (exact token, case-insensitive).
- Do not mutate files in plan mode.
- Execution happens only after the user picks an execute option in the post-plan TUI.
- Keep refining without [PLAN READY] until the plan is solid.`;

/** True if a message content payload mentions plan-mode activation. */
export function contentHasPlanMarker(content: unknown): boolean {
	if (typeof content === "string") {
		return content.includes(PLAN_MODE_MARKER);
	}
	if (Array.isArray(content)) {
		return content.some((block) => {
			if (!block || typeof block !== "object") return false;
			const text = (block as { type?: string; text?: string }).text;
			return (
				(block as { type?: string }).type === "text" && typeof text === "string" && text.includes(PLAN_MODE_MARKER)
			);
		});
	}
	return false;
}

/**
 * Filter messages that should not appear outside plan mode.
 * Drops custom yoki-plan-context entries and any user content carrying the marker.
 */
export function filterPlanContextMessages<T>(messages: readonly T[]): T[] {
	return messages.filter((m) => {
		const msg = m as { role?: string; customType?: string; content?: unknown };
		if (msg.customType === PLAN_CONTEXT_CUSTOM_TYPE) return false;
		if (msg.role === "user" && contentHasPlanMarker(msg.content)) return false;
		return true;
	});
}
