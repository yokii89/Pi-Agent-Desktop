/**
 * Post-plan option labels — shared by TUI select and desktop view.
 * Kept in a leaf module so desktop-view ↔ post-plan cannot form a cycle.
 */

export const POST_PLAN_OPTIONS = [
	"Execute now (same session)",
	"Execute in a new session",
	"Keep exploring in plan mode",
	"Save plan only (no execute)",
] as const;

export type PostPlanChoice = (typeof POST_PLAN_OPTIONS)[number];

export const POST_PLAN_SELECT_TITLE = "Plan ready — what next?";

/** Stable list values for desktop ViewNode lists. */
export const POST_PLAN_OPTION_VALUES = POST_PLAN_OPTIONS.map((_, i) => `opt:${i}` as const);

export function postPlanChoiceFromValue(value: unknown): PostPlanChoice | undefined {
	if (typeof value !== "string") return undefined;
	const idx = POST_PLAN_OPTION_VALUES.indexOf(value as (typeof POST_PLAN_OPTION_VALUES)[number]);
	if (idx < 0) return undefined;
	return POST_PLAN_OPTIONS[idx];
}
